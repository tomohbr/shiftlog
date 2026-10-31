import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { requireEventMode } from '../utils/billing';
import { logAudit } from '../utils/audit';
import { recordShiftChange, snapOf } from '../utils/shiftChanges';
import {
  SlotRule, Slot, RequestInfo, Interval, Availability,
  expandRules, plan, judge, toMinutes, toHHMM, datesBetween,
} from '../utils/venueSchedule';
import { campaignPreferences } from '../utils/requestCampaign';

// 会場ごとの必要人数（枠）と、希望からのシフト下書き。
//   /rules         枠のルール（会場 × 曜日 or 日付 × 時間帯 × 人数）
//   /drafts        下書きの作成・確認・手直し・確定
// 下書きは schedule_draft_* にだけあり、確定するまで shifts に入らない（スタッフには見えない）。

const router = Router();

const isAdmin = (req: AuthRequest) => ['admin', 'super_admin'].includes(req.user!.role);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;

function adminOnly(req: AuthRequest, res: Response): boolean {
  if (isAdmin(req)) return true;
  res.status(403).json({ error: '管理者権限が必要です' });
  return false;
}

// 会場がこの会社のものか（null は「会場指定なし」）
function storeOk(companyId: number, storeId: unknown): number | null | false {
  if (storeId === undefined || storeId === null || storeId === '') return null;
  const id = Number(storeId);
  if (!Number.isInteger(id)) return false;
  return db.prepare('SELECT 1 FROM stores WHERE id = ? AND company_id = ?').get(id, companyId) ? id : false;
}

// ---------------------------------------------------------------- 枠のルール

function parseRule(companyId: number, body: any): Omit<SlotRule, 'id'> | string {
  const store_id = storeOk(companyId, body.store_id);
  if (store_id === false) return '会場が見つかりません';
  const date = body.date ? String(body.date) : null;
  const weekdays = date ? null : [...new Set(String(body.weekdays ?? '').replace(/[^0-6]/g, '').split(''))].sort().join('');
  if (date && !DATE_RE.test(date)) return '日付が正しくありません';
  if (!date && !weekdays) return '曜日か日付を指定してください';
  const s = toMinutes(body.start_time), e = toMinutes(body.end_time);
  if (Number.isNaN(s) || Number.isNaN(e)) return '時間を入力してください';
  if (e <= s) return '終了時刻は開始時刻より後にしてください（日をまたぐ枠は未対応）';
  const needed = Number(body.needed);
  if (!Number.isInteger(needed) || needed < 0 || needed > 50) return '人数は0〜50で入力してください';
  const brk = Number(body.break_minutes || 0);
  if (!Number.isInteger(brk) || brk < 0 || brk > 240) return '休憩は0〜240分で入力してください';
  const valid_from = !date && body.valid_from ? String(body.valid_from) : null;
  const valid_to = !date && body.valid_to ? String(body.valid_to) : null;
  if ((valid_from && !DATE_RE.test(valid_from)) || (valid_to && !DATE_RE.test(valid_to))) return '適用期間の日付が正しくありません';
  if (valid_from && valid_to && valid_from > valid_to) return '適用期間の開始日は終了日より前にしてください';
  return {
    store_id, weekdays, date, start_time: toHHMM(s), end_time: toHHMM(e),
    needed, break_minutes: brk, valid_from, valid_to,
  };
}

// GET /api/venue-schedule/rules
router.get('/rules', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const rules = db.prepare(`
    SELECT * FROM venue_slot_rules WHERE company_id = ?
    ORDER BY COALESCE(store_id, 0), (date IS NOT NULL), date, weekdays, start_time
  `).all(req.companyId!);
  res.json({ rules });
});

// POST /api/venue-schedule/rules
router.post('/rules', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const r = parseRule(companyId, req.body);
  if (typeof r === 'string') { res.status(400).json({ error: r }); return; }
  const result = db.prepare(`
    INSERT INTO venue_slot_rules (company_id, store_id, weekdays, date, start_time, end_time, needed, break_minutes, valid_from, valid_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(companyId, r.store_id, r.weekdays, r.date, r.start_time, r.end_time, r.needed, r.break_minutes, r.valid_from, r.valid_to);
  const rule = db.prepare('SELECT * FROM venue_slot_rules WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ rule });
});

// PUT /api/venue-schedule/rules/:id
router.put('/rules/:id', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const cur = db.prepare('SELECT * FROM venue_slot_rules WHERE id = ? AND company_id = ?').get(req.params.id, companyId) as any;
  if (!cur) { res.status(404).json({ error: '枠が見つかりません' }); return; }
  const r = parseRule(companyId, { ...cur, ...req.body });
  if (typeof r === 'string') { res.status(400).json({ error: r }); return; }
  db.prepare(`
    UPDATE venue_slot_rules SET store_id = ?, weekdays = ?, date = ?, start_time = ?, end_time = ?, needed = ?,
      break_minutes = ?, valid_from = ?, valid_to = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND company_id = ?
  `).run(r.store_id, r.weekdays, r.date, r.start_time, r.end_time, r.needed, r.break_minutes, r.valid_from, r.valid_to, cur.id, companyId);
  res.json({ rule: db.prepare('SELECT * FROM venue_slot_rules WHERE id = ?').get(cur.id) });
});

// DELETE /api/venue-schedule/rules/:id
router.delete('/rules/:id', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  db.prepare('DELETE FROM venue_slot_rules WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId!);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- 下書きの材料

interface Staff { id: number; name: string; color: string | null }

function loadStaff(companyId: number): Staff[] {
  // シフト管理画面と同じく「スタッフ」の人だけ（管理者は割り当て対象にしない）
  return db.prepare(`
    SELECT u.id, u.name, uc.color
    FROM users u JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    WHERE u.is_active = 1 AND (uc.role = 'staff' OR u.role = 'staff')
    ORDER BY u.name
  `).all(companyId) as Staff[];
}

function loadRequests(companyId: number, start: string, end: string): Map<string, RequestInfo & { raw_start: string | null; raw_end: string | null }> {
  const rows = db.prepare(`
    SELECT user_id, date, availability, preferred_start, preferred_end, part FROM shift_requests
    WHERE company_id = ? AND date >= ? AND date <= ?
  `).all(companyId, start, end) as any[];
  const m = new Map<string, RequestInfo & { raw_start: string | null; raw_end: string | null }>();
  for (const r of rows) {
    const s = toMinutes(r.preferred_start), e = toMinutes(r.preferred_end);
    const hasTime = !Number.isNaN(s) && !Number.isNaN(e) && e > s;
    m.set(`${r.user_id}:${r.date}`, {
      availability: (['preferred', 'available', 'unavailable'].includes(r.availability) ? r.availability : 'available') as Availability,
      start: hasTime ? s : null, end: hasTime ? e : null,
      part: r.part === 'a' || r.part === 'b' || r.part === 'full' || r.part === 'all' ? r.part : null,
      raw_start: hasTime ? r.preferred_start : null, raw_end: hasTime ? r.preferred_end : null,
    });
  }
  return m;
}

interface LiveShift { id: number; user_id: number; date: string; store_id: number | null; start: number; end: number; break_minutes: number }

// 管理者（店長など、いつも会場にいる「固定」の人）のシフトは枠の人数に数えない。
// 枠の必要人数は「スタッフ（バイト）が何人ほしいか」で決める
function loadShifts(companyId: number, start: string, end: string): LiveShift[] {
  return (db.prepare(`
    SELECT s.id, s.user_id, s.date, s.store_id, s.start_time, s.end_time, s.break_minutes FROM shifts s
    JOIN users u ON u.id = s.user_id
    JOIN user_companies uc ON uc.user_id = s.user_id AND uc.company_id = s.company_id
    WHERE s.company_id = ? AND s.date >= ? AND s.date <= ?
      AND uc.role = 'staff' AND u.role NOT IN ('admin', 'super_admin')
  `).all(companyId, start, end) as any[]).map(s => ({
    id: s.id, user_id: s.user_id, date: s.date, store_id: s.store_id ?? null,
    start: toMinutes(s.start_time), end: toMinutes(s.end_time), break_minutes: s.break_minutes || 0,
  })).filter(s => !Number.isNaN(s.start) && !Number.isNaN(s.end));
}

// 確定シフトをどの枠の「1人」と数えるか。同じ会場・同じ日で、
//   - 枠をまるごと覆っている枠はすべて（10:00-21:00 の人は 10-18 と 16-21 の両方を埋める）
//   - どれも覆っていなければ、一番長く重なる枠1つだけ（10:00-18:00 の人を 16-21 の枠に数えない）
type SlotRange = { key: number; store_id: number | null; date: string; start: number; end: number };
function matchExisting(shifts: LiveShift[], slots: SlotRange[]): Map<number, LiveShift[]> {
  const m = new Map<number, LiveShift[]>();
  for (const s of slots) m.set(s.key, []);
  for (const sh of shifts) {
    const same = slots.filter(s => s.date === sh.date && (s.store_id ?? null) === (sh.store_id ?? null)
      && sh.start < s.end && s.start < sh.end);
    if (same.length === 0) continue;
    const covered = same.filter(s => sh.start <= s.start && sh.end >= s.end);
    const pick = covered.length > 0 ? covered : [same.reduce((best, s) => {
      const ov = (x: SlotRange) => Math.min(x.end, sh.end) - Math.max(x.start, sh.start);
      return ov(s) > ov(best) ? s : best;
    })];
    for (const s of pick) m.get(s.key)!.push(sh);
  }
  return m;
}

function busyMap(shifts: LiveShift[]): Map<string, Interval[]> {
  const m = new Map<string, Interval[]>();
  for (const s of shifts) {
    const k = `${s.user_id}:${s.date}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push({ start: s.start, end: s.end });
  }
  return m;
}

// ---------------------------------------------------------------- 下書きの表示用データ

interface DraftSlotRow { id: number; store_id: number | null; date: string; start_time: string; end_time: string; needed: number; break_minutes: number }
interface DraftAsgRow { id: number; slot_id: number; user_id: number; source: string }

function buildView(companyId: number, draftId: number) {
  const draft = db.prepare('SELECT * FROM schedule_drafts WHERE id = ? AND company_id = ?').get(draftId, companyId) as any;
  if (!draft) return null;
  const slots = db.prepare('SELECT * FROM schedule_draft_slots WHERE draft_id = ? ORDER BY date, COALESCE(store_id, 0), start_time').all(draftId) as DraftSlotRow[];
  const asgs = db.prepare('SELECT * FROM schedule_draft_assignments WHERE draft_id = ? ORDER BY id').all(draftId) as DraftAsgRow[];
  const staff = loadStaff(companyId);
  const nameOf = new Map<number, string>();
  for (const u of db.prepare('SELECT u.id, u.name FROM users u JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?').all(companyId) as any[]) nameOf.set(u.id, u.name);
  const requests = loadRequests(companyId, draft.start_date, draft.end_date);
  const shifts = draft.status === 'committed' ? [] : loadShifts(companyId, draft.start_date, draft.end_date);
  const stores = db.prepare('SELECT id, name FROM stores WHERE company_id = ? ORDER BY id').all(companyId) as { id: number; name: string }[];
  const prefs = campaignPreferences(companyId, draft.start_date, draft.end_date);

  const asgBySlot = new Map<number, DraftAsgRow[]>();
  for (const a of asgs) {
    if (!asgBySlot.has(a.slot_id)) asgBySlot.set(a.slot_id, []);
    asgBySlot.get(a.slot_id)!.push(a);
  }

  // 人ごとの集計（確定シフト + 下書き）
  const sum = new Map<number, { draftMin: number; existMin: number; dates: Set<string>; draftCount: number }>();
  const ensure = (id: number) => {
    if (!sum.has(id)) sum.set(id, { draftMin: 0, existMin: 0, dates: new Set(), draftCount: 0 });
    return sum.get(id)!;
  };
  for (const sh of shifts) {
    const x = ensure(sh.user_id);
    x.existMin += sh.end - sh.start - sh.break_minutes;
    x.dates.add(sh.date);
  }

  const existingBySlot = matchExisting(shifts, slots.map(s => ({ key: s.id, store_id: s.store_id, date: s.date, start: toMinutes(s.start_time), end: toMinutes(s.end_time) })));
  let totalNeeded = 0, totalFilled = 0, shortSlots = 0, shortPeople = 0;
  const slotViews = slots.map(s => {
    const range = { store_id: s.store_id, date: s.date, start: toMinutes(s.start_time), end: toMinutes(s.end_time) };
    const existing = existingBySlot.get(s.id) || [];
    const people = [
      ...existing.map(sh => ({
        assignment_id: null as number | null, shift_id: sh.id, user_id: sh.user_id,
        user_name: nameOf.get(sh.user_id) || '?', source: 'existing',
        availability: requests.get(`${sh.user_id}:${s.date}`)?.availability || null, partial: false,
      })),
      ...(asgBySlot.get(s.id) || []).map(a => {
        const req = requests.get(`${a.user_id}:${s.date}`);
        const j = judge(range as Slot, req, [], true);
        const x = ensure(a.user_id);
        const st = (a as any).start_time || null, et = (a as any).end_time || null;
        x.draftMin += toMinutes(et || s.end_time) - toMinutes(st || s.start_time) - (s.break_minutes || 0);
        x.dates.add(s.date);
        x.draftCount++;
        return {
          assignment_id: a.id, shift_id: null as number | null, user_id: a.user_id,
          user_name: nameOf.get(a.user_id) || '?', source: a.source,
          // 枠と違う時間で入る人（NULL なら枠の時間のまま）
          start_time: st, end_time: et,
          availability: req?.availability || null,
          partial: j.ok ? j.partial : false,
          // 手で入れた人が「出勤不可」や「希望時間外」なら画面で警告する
          warning: !j.ok ? j.reason
            : !prefs.venueOk(a.user_id, s.date, s.store_id) ? '希望の会場ではありません'
            : j.partial ? `希望は${req?.raw_start?.slice(0, 5)}-${req?.raw_end?.slice(0, 5)}` : null,
        };
      }),
    ];
    const short = Math.max(0, s.needed - people.length);
    totalNeeded += s.needed;
    totalFilled += Math.min(s.needed, people.length);
    if (short > 0) { shortSlots++; shortPeople += short; }
    return { ...s, people, short, over: Math.max(0, people.length - s.needed) };
  });

  // 二重勤務の検出（下書き同士・確定シフトとの重なり）。手で入れたときに防いでいるが、念のため画面にも出す
  const conflicts: Array<{ user_id: number; user_name: string; date: string }> = [];
  {
    const byUserDate = new Map<string, Interval[]>();
    for (const sh of shifts) {
      const k = `${sh.user_id}:${sh.date}`;
      if (!byUserDate.has(k)) byUserDate.set(k, []);
      byUserDate.get(k)!.push({ start: sh.start, end: sh.end });
    }
    for (const s of slots) for (const a of asgBySlot.get(s.id) || []) {
      const k = `${a.user_id}:${s.date}`;
      const iv = { start: toMinutes(s.start_time), end: toMinutes(s.end_time) };
      const list = byUserDate.get(k) || [];
      if (list.some(b => b.start < iv.end && iv.start < b.end)) conflicts.push({ user_id: a.user_id, user_name: nameOf.get(a.user_id) || '?', date: s.date });
      list.push(iv);
      byUserDate.set(k, list);
    }
  }

  const dates = datesBetween(draft.start_date, draft.end_date);
  const staffViews = staff.map(u => {
    const x = sum.get(u.id) || { draftMin: 0, existMin: 0, dates: new Set<string>(), draftCount: 0 };
    let preferred = 0, available = 0, unavailable = 0;
    for (const d of dates) {
      const r = requests.get(`${u.id}:${d}`);
      if (!r) continue;
      if (r.availability === 'preferred') preferred++;
      else if (r.availability === 'available') available++;
      else unavailable++;
    }
    return {
      id: u.id, name: u.name, color: u.color,
      days: x.dates.size, minutes: x.draftMin + x.existMin,
      draft_minutes: x.draftMin, existing_minutes: x.existMin, draft_count: x.draftCount,
      preferred_days: preferred, available_days: available, unavailable_days: unavailable,
      submitted: preferred + available + unavailable > 0,
    };
  });

  return {
    draft: {
      id: draft.id, start_date: draft.start_date, end_date: draft.end_date, status: draft.status,
      include_unsubmitted: !!draft.include_unsubmitted, created_at: draft.created_at,
      committed_at: draft.committed_at, committed_count: draft.committed_count,
    },
    stores,
    slots: slotViews,
    staff: staffViews,
    conflicts,
    totals: { needed: totalNeeded, filled: totalFilled, short_slots: shortSlots, short_people: shortPeople, draft_count: asgs.length },
  };
}

function getDraft(companyId: number, id: unknown) {
  return db.prepare('SELECT * FROM schedule_drafts WHERE id = ? AND company_id = ?').get(Number(id), companyId) as any;
}

// ---------------------------------------------------------------- 下書きの作成

// POST /api/venue-schedule/drafts  { start_date, end_date, include_unsubmitted? }
router.post('/drafts', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const { start_date, end_date } = req.body || {};
  const includeUnsubmitted = !!req.body?.include_unsubmitted;
  if (!DATE_RE.test(start_date || '') || !DATE_RE.test(end_date || '') || start_date > end_date) {
    res.status(400).json({ error: '期間を正しく指定してください' });
    return;
  }
  if (datesBetween(start_date, end_date).length > MAX_DAYS) {
    res.status(400).json({ error: `期間は${MAX_DAYS}日以内にしてください` });
    return;
  }

  const rules = db.prepare('SELECT * FROM venue_slot_rules WHERE company_id = ?').all(companyId) as SlotRule[];
  // 消された会場のルールは使わない
  const storeIds = new Set((db.prepare('SELECT id FROM stores WHERE company_id = ?').all(companyId) as any[]).map(s => s.id));
  const usable = rules.filter(r => r.store_id == null || storeIds.has(r.store_id));
  const expanded = expandRules(usable, start_date, end_date);
  if (expanded.length === 0) {
    res.status(400).json({ error: 'この期間に当てはまる枠がありません。先に会場ごとの必要人数を登録してください' });
    return;
  }

  const staff = loadStaff(companyId);
  const requests = loadRequests(companyId, start_date, end_date);
  const shifts = loadShifts(companyId, start_date, end_date);

  const slots: Slot[] = expanded.map((e, i) => ({ key: i, store_id: e.store_id, date: e.date, start: e.start, end: e.end, needed: e.needed }));
  const existingInSlot = new Map<number, number[]>();
  for (const [k, list] of matchExisting(shifts, slots)) existingInSlot.set(k, list.map(sh => sh.user_id));
  const existingMinutes = new Map<number, number>();
  const existingDays = new Map<number, Set<string>>();
  for (const sh of shifts) {
    existingMinutes.set(sh.user_id, (existingMinutes.get(sh.user_id) || 0) + (sh.end - sh.start));
    if (!existingDays.has(sh.user_id)) existingDays.set(sh.user_id, new Set());
    existingDays.get(sh.user_id)!.add(sh.date);
  }

  // 期間の募集で答えた「入りたい会場」「週の日数」を使う（答えていない人は従来どおり）
  const prefs = campaignPreferences(companyId, start_date, end_date);
  const result = plan({
    slots, staffIds: staff.map(s => s.id), requests, busy: busyMap(shifts),
    existingInSlot, existingMinutes, existingDays, includeUnsubmitted,
    venueOk: prefs.venueOk, weeklyCap: prefs.weeklyCap, apart: loadApart(companyId),
  });

  let draftId = 0;
  const txn = db.transaction(() => {
    // 同じ期間にかかる作りかけの下書きは破棄する（下書きは常に1つ＝迷わない）
    db.prepare(`
      UPDATE schedule_drafts SET status = 'discarded', updated_at = CURRENT_TIMESTAMP
      WHERE company_id = ? AND status = 'draft' AND NOT (end_date < ? OR start_date > ?)
    `).run(companyId, start_date, end_date);
    draftId = Number(db.prepare(`
      INSERT INTO schedule_drafts (company_id, start_date, end_date, include_unsubmitted, created_by) VALUES (?, ?, ?, ?, ?)
    `).run(companyId, start_date, end_date, includeUnsubmitted ? 1 : 0, req.user!.id).lastInsertRowid);
    const insSlot = db.prepare(`
      INSERT INTO schedule_draft_slots (draft_id, store_id, date, start_time, end_time, needed, break_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insAsg = db.prepare('INSERT INTO schedule_draft_assignments (draft_id, slot_id, user_id, source) VALUES (?, ?, ?, ?)');
    const slotIdByKey = new Map<number, number>();
    expanded.forEach((e, i) => {
      slotIdByKey.set(i, Number(insSlot.run(draftId, e.store_id, e.date, toHHMM(e.start), toHHMM(e.end), e.needed, e.break_minutes).lastInsertRowid));
    });
    for (const a of result.assignments) insAsg.run(draftId, slotIdByKey.get(a.slotKey), a.userId, 'auto');
  });
  txn();

  logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'schedule_draft', entityId: draftId, summary: `${start_date}〜${end_date} のシフト下書きを自動作成（${result.assignments.length} 件）` });
  res.status(201).json(buildView(companyId, draftId));
});

// 一緒に入れない2人。自動作成はこの2人を同じ会場・重なる時間に入れない
function loadApart(companyId: number): (a: number, b: number) => boolean {
  const set = new Set((db.prepare('SELECT user_a, user_b FROM staff_apart_pairs WHERE company_id = ?').all(companyId) as any[])
    .flatMap(r => [`${r.user_a}:${r.user_b}`, `${r.user_b}:${r.user_a}`]));
  return (a, b) => set.has(`${a}:${b}`);
}

// GET /api/venue-schedule/apart  一緒に入れない2人の一覧
router.get('/apart', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const pairs = db.prepare(`
    SELECT p.id, p.user_a, p.user_b, a.name AS name_a, b.name AS name_b FROM staff_apart_pairs p
    JOIN users a ON a.id = p.user_a JOIN users b ON b.id = p.user_b WHERE p.company_id = ? ORDER BY p.id
  `).all(req.companyId!);
  res.json({ pairs });
});

// POST /api/venue-schedule/apart  { user_a, user_b }
router.post('/apart', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const [a, b] = [Number(req.body?.user_a), Number(req.body?.user_b)].sort((x, y) => x - y);
  const inCompany = db.prepare('SELECT 1 FROM user_companies WHERE user_id = ? AND company_id = ?');
  if (!a || !b || a === b || !inCompany.get(a, companyId) || !inCompany.get(b, companyId)) { res.status(400).json({ error: '2人を選んでください' }); return; }
  db.prepare('INSERT OR IGNORE INTO staff_apart_pairs (company_id, user_a, user_b) VALUES (?, ?, ?)').run(companyId, a, b);
  res.status(201).json({ ok: true });
});

// DELETE /api/venue-schedule/apart/:id
router.delete('/apart/:id', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  db.prepare('DELETE FROM staff_apart_pairs WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId!);
  res.json({ ok: true });
});

// GET /api/venue-schedule/drafts  作りかけの下書き一覧（新しい順）
router.get('/drafts', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const drafts = db.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM schedule_draft_assignments a WHERE a.draft_id = d.id) AS assignment_count
    FROM schedule_drafts d WHERE d.company_id = ? AND d.status IN ('draft', 'committed')
    ORDER BY d.id DESC LIMIT 20
  `).all(req.companyId!);
  res.json({ drafts });
});

// GET /api/venue-schedule/drafts/:id
router.get('/drafts/:id', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const view = buildView(req.companyId!, Number(req.params.id));
  if (!view) { res.status(404).json({ error: '下書きが見つかりません' }); return; }
  res.json(view);
});

// PUT /api/venue-schedule/drafts/:id/assignments/:aid/time  { start_time, end_time }  その人だけ時間をずらす（null で枠の時間に戻す）
router.put('/drafts/:id/assignments/:aid/time', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const draft = getDraft(companyId, req.params.id);
  if (!draft || draft.status !== 'draft') { res.status(404).json({ error: '下書きが見つかりません' }); return; }
  const a = db.prepare(`
    SELECT a.id, s.start_time, s.end_time FROM schedule_draft_assignments a JOIN schedule_draft_slots s ON s.id = a.slot_id
    WHERE a.id = ? AND a.draft_id = ?
  `).get(req.params.aid, draft.id) as any;
  if (!a) { res.status(404).json({ error: '割り当てが見つかりません' }); return; }
  const t = (v: unknown) => (v == null || v === '' ? null : /^\d{2}:\d{2}$/.test(String(v)) ? String(v) : undefined);
  const st = t(req.body?.start_time), et = t(req.body?.end_time);
  if (st === undefined || et === undefined) { res.status(400).json({ error: '時刻は HH:MM で入れてください' }); return; }
  const s = toMinutes(st || a.start_time), e = toMinutes(et || a.end_time);
  if (!(s < e) || s < toMinutes(a.start_time) || e > toMinutes(a.end_time)) { res.status(400).json({ error: '枠の時間の中で、終わりを始まりより後にしてください' }); return; }
  db.prepare('UPDATE schedule_draft_assignments SET start_time = ?, end_time = ? WHERE id = ?').run(st, et, a.id);
  res.json(buildView(companyId, draft.id));
});

// GET /api/venue-schedule/drafts/:id/slots/:slotId/candidates  その枠に入れられる人・入れられない人と理由
router.get('/drafts/:id/slots/:slotId/candidates', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const draft = getDraft(companyId, req.params.id);
  if (!draft) { res.status(404).json({ error: '下書きが見つかりません' }); return; }
  const slot = db.prepare('SELECT * FROM schedule_draft_slots WHERE id = ? AND draft_id = ?').get(req.params.slotId, draft.id) as DraftSlotRow | undefined;
  if (!slot) { res.status(404).json({ error: '枠が見つかりません' }); return; }
  const view = buildView(companyId, draft.id)!;
  const requests = loadRequests(companyId, slot.date, slot.date);
  const shifts = loadShifts(companyId, slot.date, slot.date);
  const busy = busyMapWithDraft(draft.id, slot.date, shifts);
  const range: Slot = { key: slot.id, store_id: slot.store_id, date: slot.date, start: toMinutes(slot.start_time), end: toMinutes(slot.end_time), needed: slot.needed };
  const inSlot = new Set(view.slots.find(s => s.id === slot.id)!.people.map(p => p.user_id));
  const prefs = campaignPreferences(companyId, slot.date, slot.date);
  const candidates = view.staff.map(u => {
    const req = requests.get(`${u.id}:${slot.date}`);
    const j = judge(range, req, busy.get(`${u.id}:${slot.date}`) || [], true);
    return {
      user_id: u.id, name: u.name, color: u.color, days: u.days, minutes: u.minutes,
      availability: req?.availability || null,
      preferred_time: req?.raw_start ? `${req.raw_start.slice(0, 5)}-${req.raw_end!.slice(0, 5)}` : null,
      in_slot: inSlot.has(u.id),
      ok: j.ok, partial: j.ok ? j.partial : false,
      reason: j.ok ? (req ? (prefs.venueOk(u.id, slot.date, slot.store_id) ? null : '希望の会場ではない') : '希望未提出') : j.reason,
    };
  });
  res.json({ slot, candidates });
});

// 確定シフト + この下書きの割当（同じ日）を人ごとの埋まっている時間にする
function busyMapWithDraft(draftId: number, date: string, shifts: LiveShift[], exceptAssignmentId?: number) {
  const m = busyMap(shifts.filter(s => s.date === date));
  const rows = db.prepare(`
    SELECT a.id, a.user_id, s.start_time, s.end_time FROM schedule_draft_assignments a
    JOIN schedule_draft_slots s ON s.id = a.slot_id
    WHERE a.draft_id = ? AND s.date = ?
  `).all(draftId, date) as any[];
  for (const r of rows) {
    if (r.id === exceptAssignmentId) continue;
    const k = `${r.user_id}:${date}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push({ start: toMinutes(r.start_time), end: toMinutes(r.end_time) });
  }
  return m;
}

// ---------------------------------------------------------------- 手直し

// POST /api/venue-schedule/drafts/:id/assign  { slot_id, user_id, replace_assignment_id? }
// 足す・差し替える。出勤不可の日と、同じ時間の二重勤務は入れられない。
router.post('/drafts/:id/assign', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const draft = getDraft(companyId, req.params.id);
  if (!draft || draft.status !== 'draft') { res.status(404).json({ error: '編集できる下書きが見つかりません' }); return; }
  const { slot_id, user_id, replace_assignment_id } = req.body || {};
  const slot = db.prepare('SELECT * FROM schedule_draft_slots WHERE id = ? AND draft_id = ?').get(slot_id, draft.id) as DraftSlotRow | undefined;
  if (!slot) { res.status(404).json({ error: '枠が見つかりません' }); return; }
  const staff = loadStaff(companyId);
  if (!staff.some(s => s.id === Number(user_id))) { res.status(404).json({ error: 'スタッフが見つかりません' }); return; }
  let replaceId: number | undefined;
  if (replace_assignment_id) {
    const old = db.prepare('SELECT * FROM schedule_draft_assignments WHERE id = ? AND draft_id = ? AND slot_id = ?').get(replace_assignment_id, draft.id, slot.id) as any;
    if (!old) { res.status(404).json({ error: '差し替える割当が見つかりません' }); return; }
    replaceId = old.id;
  }
  const uid = Number(user_id);
  const range: Slot = { key: slot.id, store_id: slot.store_id, date: slot.date, start: toMinutes(slot.start_time), end: toMinutes(slot.end_time), needed: slot.needed };
  const shifts = loadShifts(companyId, slot.date, slot.date);
  if ((matchExisting(shifts, [range]).get(range.key) || []).some(sh => sh.user_id === uid)) { res.status(409).json({ error: 'この人はこの枠にすでに確定シフトで入っています' }); return; }
  const busy = busyMapWithDraft(draft.id, slot.date, shifts, replaceId);
  const reqInfo = loadRequests(companyId, slot.date, slot.date).get(`${uid}:${slot.date}`);
  const j = judge(range, reqInfo, busy.get(`${uid}:${slot.date}`) || [], true);
  if (!j.ok && (j.reason === '出勤不可' || j.reason === '同じ時間に別の勤務')) {
    res.status(409).json({ error: j.reason === '出勤不可' ? 'この日は出勤不可の希望が出ています' : '同じ時間に別の勤務が入っています（二重勤務になります）' });
    return;
  }
  // 希望時間外は入れられるが、画面で警告が出る（本人と話がついている場合があるため）
  db.transaction(() => {
    if (replaceId) db.prepare('DELETE FROM schedule_draft_assignments WHERE id = ?').run(replaceId);
    db.prepare('INSERT INTO schedule_draft_assignments (draft_id, slot_id, user_id, source) VALUES (?, ?, ?, ?)').run(draft.id, slot.id, uid, 'manual');
    db.prepare('UPDATE schedule_drafts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(draft.id);
  })();
  res.json(buildView(companyId, draft.id));
});

// DELETE /api/venue-schedule/drafts/:id/assignments/:aid  外す
router.delete('/drafts/:id/assignments/:aid', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const draft = getDraft(companyId, req.params.id);
  if (!draft || draft.status !== 'draft') { res.status(404).json({ error: '編集できる下書きが見つかりません' }); return; }
  db.prepare('DELETE FROM schedule_draft_assignments WHERE id = ? AND draft_id = ?').run(req.params.aid, draft.id);
  db.prepare('UPDATE schedule_drafts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(draft.id);
  res.json(buildView(companyId, draft.id));
});

// DELETE /api/venue-schedule/drafts/:id  下書きを捨てる
router.delete('/drafts/:id', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const draft = getDraft(companyId, req.params.id);
  if (!draft || draft.status !== 'draft') { res.status(404).json({ error: '下書きが見つかりません' }); return; }
  db.prepare("UPDATE schedule_drafts SET status = 'discarded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(draft.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- 確定

// POST /api/venue-schedule/drafts/:id/commit  下書きを shifts に入れる（会場付き）。
// 確定の瞬間にもう一度、確定シフトとの重なりを確かめる（下書き中に手でシフトを入れた場合に備える）。
router.post('/drafts/:id/commit', authenticateToken, requireCompany, requireEventMode, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const draft = getDraft(companyId, req.params.id);
  if (!draft || draft.status !== 'draft') { res.status(404).json({ error: '確定できる下書きが見つかりません' }); return; }

  const rows = db.prepare(`
    SELECT a.id, a.user_id, s.store_id, s.date, COALESCE(a.start_time, s.start_time) AS start_time, COALESCE(a.end_time, s.end_time) AS end_time, s.break_minutes, u.name AS user_name
    FROM schedule_draft_assignments a
    JOIN schedule_draft_slots s ON s.id = a.slot_id
    JOIN users u ON u.id = a.user_id
    WHERE a.draft_id = ? ORDER BY s.date, s.start_time
  `).all(draft.id) as any[];

  let created = 0;
  const skipped: Array<{ user_name: string; date: string; start_time: string; end_time: string; reason: string }> = [];
  const ins = db.prepare(`
    INSERT INTO shifts (company_id, user_id, date, start_time, end_time, break_minutes, notes, status, store_id)
    VALUES (?, ?, ?, ?, ?, ?, NULL, 'confirmed', ?)
  `);
  db.transaction(() => {
    // 時刻の書式（HH:MM / HH:MM:SS）の違いで取りこぼさないよう、分に直して比べる
    const busy = busyMap(loadShifts(companyId, draft.start_date, draft.end_date));
    for (const r of rows) {
      // store が消されていたら会場なしで入れる
      const storeId = r.store_id != null && db.prepare('SELECT 1 FROM stores WHERE id = ? AND company_id = ?').get(r.store_id, companyId) ? r.store_id : null;
      const iv = { start: toMinutes(r.start_time), end: toMinutes(r.end_time) };
      const k = `${r.user_id}:${r.date}`;
      if ((busy.get(k) || []).some(b => b.start < iv.end && iv.start < b.end)) {
        skipped.push({ user_name: r.user_name, date: r.date, start_time: r.start_time, end_time: r.end_time, reason: '同じ時間に別のシフトあり' });
        continue;
      }
      const id = Number(ins.run(companyId, r.user_id, r.date, r.start_time, r.end_time, r.break_minutes || 0, storeId).lastInsertRowid);
      // 公開済みの月に足した分は「まだ知らせていない変更」に載せる（シフト管理から本人に知らせる）
      recordShiftChange(companyId, r.user_id, id, null, snapOf(id));
      if (!busy.has(k)) busy.set(k, []);
      busy.get(k)!.push(iv);
      created++;
    }
    db.prepare(`
      UPDATE schedule_drafts SET status = 'committed', committed_at = CURRENT_TIMESTAMP, committed_count = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(created, draft.id);
  })();

  logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'shift', summary: `下書き（${draft.start_date}〜${draft.end_date}）を確定してシフト ${created} 件を作成（スキップ ${skipped.length}）` });
  res.json({ created, skipped });
});

export default router;
