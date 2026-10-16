import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendCampaignLinks, W } from './line';
import {
  CampaignDay, Part, PARTS, PART_LABEL, LONG_DAY, LONG_DAY_LABEL, DAYS_PER_WEEK, DAYS_PER_WEEK_LABEL, TRANSPORTS,
  campaignDays, daysLeft, isAccepting, parseVenues, partTimes,
} from '../utils/requestCampaign';

// 期間をまたぐ希望の募集（マーケットなど）。
//   管理者: 作る（下書き）→「LINEで募集を送る」で受付開始 → 集まり具合を見る → 催促 → 締め切る
//   スタッフ: LINE の本人専用リンク（/l/… → /campaign/:id）から、質問と日ごとの ◎○× を1画面で出す
// 日ごとの希望は既存の shift_requests に入れる（希望から自動作成がそのまま読む）。質問の答えは request_campaign_answers。

const router = Router();

const isAdmin = (req: AuthRequest) => ['admin', 'super_admin'].includes(req.user!.role);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 92;
const WD = '日月火水木金土';

function adminOnly(req: AuthRequest, res: Response): boolean {
  if (isAdmin(req)) return true;
  res.status(403).json({ error: '管理者権限が必要です' });
  return false;
}

interface CampaignRow {
  id: number; company_id: number; title: string; start_date: string; end_date: string;
  deadline: string | null; status: 'draft' | 'open' | 'closed'; sent_at: string | null; created_at: string;
}

function getCampaign(companyId: number, id: unknown): CampaignRow | undefined {
  return db.prepare('SELECT * FROM request_campaigns WHERE id = ? AND company_id = ?').get(Number(id), companyId) as CampaignRow | undefined;
}

const view = (c: CampaignRow) => ({
  id: c.id, title: c.title, start_date: c.start_date, end_date: c.end_date, deadline: c.deadline,
  status: c.status, sent_at: c.sent_at, created_at: c.created_at,
  days_left: daysLeft(c.deadline), accepting: isAccepting(c),
});

// 募集の対象になるスタッフ（自動作成と同じく「スタッフ」の人だけ）
function campaignStaff(companyId: number) {
  return db.prepare(`
    SELECT u.id, u.name, uc.color, (uli.line_user_id IS NOT NULL) AS linked
    FROM users u JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    LEFT JOIN user_line_ids uli ON uli.user_id = u.id
    WHERE u.is_active = 1 AND (uc.role = 'staff' OR u.role = 'staff')
    ORDER BY u.name
  `).all(companyId) as { id: number; name: string; color: string | null; linked: number }[];
}

function stores(companyId: number) {
  return db.prepare('SELECT id, name FROM stores WHERE company_id = ? ORDER BY id').all(companyId) as { id: number; name: string }[];
}

function parseBody(body: any): { title: string; start_date: string; end_date: string; deadline: string | null } | string {
  const title = String(body?.title || '').trim().slice(0, 30);
  const start_date = String(body?.start_date || '');
  const end_date = String(body?.end_date || '');
  const deadline = body?.deadline ? String(body.deadline) : null;
  if (!title) return 'タイトルを入れてください（例: クリスマスマーケット）';
  if (!DATE_RE.test(start_date) || !DATE_RE.test(end_date)) return '期間を入れてください';
  if (start_date > end_date) return '期間の終わりは始まりより後にしてください';
  const n = (Date.parse(end_date) - Date.parse(start_date)) / 86400000 + 1;
  if (n > MAX_DAYS) return `期間は${MAX_DAYS}日以内にしてください`;
  if (deadline && !DATE_RE.test(deadline)) return '締切の日付が正しくありません';
  if (deadline && deadline > end_date) return '締切は期間の終わりより前にしてください';
  return { title, start_date, end_date, deadline };
}

// 答えを画面用に読みやすくする
function answerView(a: any, storeNames: Map<number, string>) {
  if (!a) return null;
  const venues = parseVenues(a.venues);
  const ng = String(a.ng_weekdays || '').split('').filter(x => /[0-6]/.test(x)).map(Number);
  let transport: string[] = [];
  try { transport = a.transport ? JSON.parse(a.transport) : []; } catch { transport = []; }
  return {
    venues_any: !venues,
    venue_ids: venues || [],
    venue_names: venues ? venues.map(id => storeNames.get(id) || '?') : [],
    days_per_week: a.days_per_week || null,
    days_per_week_label: a.days_per_week ? DAYS_PER_WEEK_LABEL[a.days_per_week] || a.days_per_week : null,
    ng_weekdays: ng,
    ng_label: ng.map(d => WD[d]).join('・'),
    transport,
    transport_note: a.transport_note || '',
    other_job: a.other_job || null,
    long_day: a.long_day || null,
    long_day_label: a.long_day ? LONG_DAY_LABEL[a.long_day] || null : null,
    other_job_note: a.other_job_note || '',
    comment: a.comment || '',
    submitted_at: a.submitted_at || null,
  };
}

// ---------------------------------------------------------------- スタッフ

// GET /api/request-campaigns/open  受付中の募集（スタッフの希望シフト画面に案内を出す用）
router.get('/open', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const rows = (db.prepare("SELECT * FROM request_campaigns WHERE company_id = ? AND status = 'open' ORDER BY start_date").all(companyId) as CampaignRow[])
    .filter(isAccepting);
  const mine = db.prepare('SELECT submitted_at FROM request_campaign_answers WHERE campaign_id = ? AND user_id = ?');
  res.json({
    campaigns: rows.map(c => ({ ...view(c), submitted: !!(mine.get(c.id, req.user!.id) as any)?.submitted_at })),
  });
});

// GET /api/request-campaigns/:id/mine  回答画面に必要なものを全部
router.get('/:id/mine', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const c = getCampaign(companyId, req.params.id);
  // 下書きの募集はスタッフには見せない（管理者は確認のために開ける）
  if (!c || (c.status === 'draft' && !isAdmin(req))) {
    res.status(404).json({ error: 'この募集は見つかりません' });
    return;
  }
  const userId = req.user!.id;
  const st = stores(companyId);
  const names = new Map(st.map(s => [s.id, s.name]));
  const days = campaignDays(companyId, c.start_date, c.end_date);
  const answer = db.prepare('SELECT * FROM request_campaign_answers WHERE campaign_id = ? AND user_id = ?').get(c.id, userId);
  const reqs = db.prepare(`
    SELECT date, availability, part FROM shift_requests WHERE company_id = ? AND user_id = ? AND date >= ? AND date <= ?
  `).all(companyId, userId, c.start_date, c.end_date) as any[];
  const dayset = new Set(days.map(d => d.date));
  const entries: Record<string, { availability: string; part: Part | null }> = {};
  for (const r of reqs) if (dayset.has(r.date)) entries[r.date] = { availability: r.availability, part: PARTS.includes(r.part) ? r.part : null };
  res.json({
    campaign: view(c),
    contact: W(companyId),
    me: { name: req.user!.name },
    stores: st,
    days: days.map(d => ({ date: d.date, weekday: d.weekday, long: d.long, venues: d.venues.map(v => ({ store_id: v.store_id, slots: v.slots.map(s => ({ start_time: s.start_time, end_time: s.end_time, part: s.part })) })), times: d.times })),
    answer: answerView(answer, names),
    entries,
    transports: TRANSPORTS,
  });
});

// PUT /api/request-campaigns/:id/mine  { answer, entries: [{ date, availability, part? }] }
// 候補日のうち entries に無い日は「希望なし」として消す（提出し直しで ◎ を消せるように）
router.put('/:id/mine', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const c = getCampaign(companyId, req.params.id);
  if (!c || c.status === 'draft') { res.status(404).json({ error: 'この募集は見つかりません' }); return; }
  if (!isAccepting(c)) { res.status(409).json({ error: `締め切りました。変更したいときは${W(companyId)}に連絡してください` }); return; }

  const a = req.body?.answer || {};
  const storeIds = new Set(stores(companyId).map(s => s.id));
  let venues: string;
  if (a.venues === 'any' || storeIds.size === 0) venues = 'any';
  else {
    const ids = (Array.isArray(a.venues) ? a.venues : []).map(Number).filter((n: number) => storeIds.has(n));
    if (ids.length === 0) { res.status(400).json({ error: '入りたい会場を選んでください（どこでもよければ「どこでも」）' }); return; }
    venues = [...new Set(ids)].sort((x: any, y: any) => x - y).join(',');
  }
  const dpw = DAYS_PER_WEEK.includes(a.days_per_week) ? a.days_per_week : null;
  if (!dpw) { res.status(400).json({ error: '週に入りたい日数を選んでください' }); return; }
  const ng = [...new Set((Array.isArray(a.ng_weekdays) ? a.ng_weekdays : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6))].sort().join('');
  const transport = (Array.isArray(a.transport) ? a.transport : []).map(String).filter((t: string) => TRANSPORTS.includes(t));
  const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n) || null;
  const otherJob = a.other_job === 'yes' ? 'yes' : a.other_job === 'none' ? 'none' : null;
  const longDay = (LONG_DAY as readonly string[]).includes(a.long_day) ? a.long_day : null;

  const days = campaignDays(companyId, c.start_date, c.end_date);
  const dayOf = new Map<string, CampaignDay>(days.map(d => [d.date, d]));
  const raw = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const entries: { date: string; availability: string; part: Part | null }[] = [];
  for (const e of raw) {
    const date = String(e?.date || '');
    if (!dayOf.has(date)) continue; // 候補日以外は受け取らない
    const availability = ['preferred', 'available', 'unavailable'].includes(e.availability) ? e.availability : null;
    if (!availability) continue;
    const day = dayOf.get(date)!;
    let part: Part | null = availability !== 'unavailable' && day.long ? (PARTS.includes(e.part) ? e.part : 'full') : null;
    if (part === 'all' && longDay === 'half') part = 'full';
    entries.push({ date, availability, part });
  }

  const upsert = db.prepare(`
    INSERT INTO shift_requests (company_id, user_id, date, availability, preferred_start, preferred_end, part)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, user_id, date) DO UPDATE SET
      availability = excluded.availability,
      preferred_start = excluded.preferred_start,
      preferred_end = excluded.preferred_end,
      part = excluded.part
  `);
  const del = db.prepare('DELETE FROM shift_requests WHERE company_id = ? AND user_id = ? AND date = ?');
  db.transaction(() => {
    const given = new Set(entries.map(e => e.date));
    for (const d of days) if (!given.has(d.date)) del.run(companyId, userId, d.date);
    for (const e of entries) {
      // 昼／夜は時間にも直して入れる（自動作成は preferred_start/end を見る）。通し・短い日は時間なし
      const t = partTimes(dayOf.get(e.date), e.part);
      upsert.run(companyId, userId, e.date, e.availability, t.start, t.end, e.part);
    }
    db.prepare(`
      INSERT INTO request_campaign_answers (campaign_id, company_id, user_id, venues, days_per_week, ng_weekdays, transport, transport_note, other_job, other_job_note, long_day, comment, submitted_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(campaign_id, user_id) DO UPDATE SET
        venues = excluded.venues, days_per_week = excluded.days_per_week, ng_weekdays = excluded.ng_weekdays,
        transport = excluded.transport, transport_note = excluded.transport_note,
        other_job = excluded.other_job, other_job_note = excluded.other_job_note, long_day = excluded.long_day, comment = excluded.comment,
        submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    `).run(c.id, companyId, userId, venues, dpw, ng, JSON.stringify(transport), clip(a.transport_note, 100),
      otherJob, otherJob === 'yes' ? clip(a.other_job_note, 100) : null, longDay, clip(a.comment, 300));
  })();

  res.json({ message: '希望を提出しました', count: entries.length });
});

// ---------------------------------------------------------------- 管理者

// GET /api/request-campaigns  募集の一覧（新しい順）
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const staffCount = campaignStaff(companyId).length;
  const rows = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM request_campaign_answers a WHERE a.campaign_id = c.id AND a.submitted_at IS NOT NULL) AS answered
    FROM request_campaigns c WHERE c.company_id = ? ORDER BY c.start_date DESC, c.id DESC
  `).all(companyId) as (CampaignRow & { answered: number })[];
  res.json({ campaigns: rows.map(c => ({ ...view(c), answered: c.answered, staff_count: staffCount })) });
});

// GET /api/request-campaigns/preview-days?start_date=&end_date=  作る前に「候補日が何日あるか」を見せる
router.get('/preview-days', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const s = String(req.query.start_date || ''), e = String(req.query.end_date || '');
  if (!DATE_RE.test(s) || !DATE_RE.test(e) || s > e) { res.json({ count: 0, long: 0 }); return; }
  const days = campaignDays(req.companyId!, s, e);
  res.json({ count: days.length, long: days.filter(d => d.long).length, first: days[0]?.date || null, last: days[days.length - 1]?.date || null });
});

// POST /api/request-campaigns  { title, start_date, end_date, deadline }  下書きで作る（まだ誰にも送らない）
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const b = parseBody(req.body);
  if (typeof b === 'string') { res.status(400).json({ error: b }); return; }
  const id = Number(db.prepare(`
    INSERT INTO request_campaigns (company_id, title, start_date, end_date, deadline, status, created_by) VALUES (?, ?, ?, ?, ?, 'draft', ?)
  `).run(companyId, b.title, b.start_date, b.end_date, b.deadline, req.user!.id).lastInsertRowid);
  logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'request_campaign', entityId: id, summary: `希望の募集「${b.title}」（${b.start_date}〜${b.end_date}）を作成` });
  res.status(201).json({ campaign: view(getCampaign(companyId, id)!) });
});

// PUT /api/request-campaigns/:id  タイトル・期間・締切を直す
router.put('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const c = getCampaign(companyId, req.params.id);
  if (!c) { res.status(404).json({ error: '募集が見つかりません' }); return; }
  const b = parseBody({ ...c, ...req.body });
  if (typeof b === 'string') { res.status(400).json({ error: b }); return; }
  db.prepare('UPDATE request_campaigns SET title = ?, start_date = ?, end_date = ?, deadline = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(b.title, b.start_date, b.end_date, b.deadline, c.id);
  res.json({ campaign: view(getCampaign(companyId, c.id)!) });
});

// DELETE /api/request-campaigns/:id  下書きだけ消せる（送った募集は答えが残るので消さない）
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const c = getCampaign(req.companyId!, req.params.id);
  if (!c) { res.status(404).json({ error: '募集が見つかりません' }); return; }
  if (c.status !== 'draft') { res.status(409).json({ error: '送った募集は消せません（締め切ってください）' }); return; }
  db.prepare('DELETE FROM request_campaigns WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// POST /api/request-campaigns/:id/send  受付を始めて、LINE 連携済みのスタッフに本人専用リンクのカードを1人1通送る
router.post('/:id/send', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const c = getCampaign(companyId, req.params.id);
  if (!c) { res.status(404).json({ error: '募集が見つかりません' }); return; }
  if (c.status !== 'draft') { res.status(409).json({ error: 'この募集はもう送っています（未回答の人には「催促」を使ってください）' }); return; }
  if (campaignDays(companyId, c.start_date, c.end_date).length === 0) {
    res.status(400).json({ error: 'この期間に会場の営業枠がありません。先に「希望から自動作成」で会場ごとの必要人数を登録してください' });
    return;
  }
  db.prepare("UPDATE request_campaigns SET status = 'open', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(c.id);
  const staff = campaignStaff(companyId);
  const result = await sendCampaignLinks(companyId, c, 'open', staff.filter(s => s.linked).map(s => s.id));
  logAudit({ userId: req.user!.id, companyId, action: 'update', entity: 'request_campaign', entityId: c.id, summary: `希望の募集「${c.title}」を開始（LINE ${result.sent}/${result.targets}人に送信）` });
  res.json({ ...result, not_linked: staff.filter(s => !s.linked).map(s => s.name), campaign: view(getCampaign(companyId, c.id)!) });
});

// POST /api/request-campaigns/:id/remind  まだ答えていない人（LINE 連携済み）にだけ送る
router.post('/:id/remind', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const c = getCampaign(companyId, req.params.id);
  if (!c || c.status !== 'open') { res.status(409).json({ error: 'この募集は受付中ではありません' }); return; }
  const answered = new Set((db.prepare('SELECT user_id FROM request_campaign_answers WHERE campaign_id = ? AND submitted_at IS NOT NULL').all(c.id) as any[]).map(r => r.user_id));
  const pending = campaignStaff(companyId).filter(s => !answered.has(s.id));
  const linked = pending.filter(s => s.linked).map(s => s.id);
  const result = linked.length ? await sendCampaignLinks(companyId, c, 'remind', linked) : { sent: 0, targets: 0, failed: [] as string[] };
  res.json({ ...result, unanswered: pending.length, not_linked: pending.filter(s => !s.linked).map(s => s.name) });
});

// POST /api/request-campaigns/:id/close  締め切る / reopen で受付に戻す
router.post('/:id/:action(close|reopen)', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const c = getCampaign(companyId, req.params.id);
  if (!c || c.status === 'draft') { res.status(404).json({ error: '募集が見つかりません' }); return; }
  const status = req.params.action === 'close' ? 'closed' : 'open';
  db.prepare('UPDATE request_campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, c.id);
  res.json({ campaign: view(getCampaign(companyId, c.id)!) });
});

// GET /api/request-campaigns/:id/summary  集まり具合（回答状況・人ごとの答え・日×会場の人数と足りない日）
router.get('/:id/summary', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!adminOnly(req, res)) return;
  const companyId = req.companyId!;
  const c = getCampaign(companyId, req.params.id);
  if (!c) { res.status(404).json({ error: '募集が見つかりません' }); return; }
  const st = stores(companyId);
  const names = new Map(st.map(s => [s.id, s.name]));
  const staff = campaignStaff(companyId);
  const days = campaignDays(companyId, c.start_date, c.end_date);
  const answers = new Map((db.prepare('SELECT * FROM request_campaign_answers WHERE campaign_id = ?').all(c.id) as any[]).map(a => [a.user_id, a]));
  const reqRows = db.prepare(`
    SELECT user_id, date, availability, part FROM shift_requests WHERE company_id = ? AND date >= ? AND date <= ?
  `).all(companyId, c.start_date, c.end_date) as any[];
  const staffIds = new Set(staff.map(s => s.id));
  const reqs = new Map<string, { availability: string; part: Part | null }>();
  for (const r of reqRows) if (staffIds.has(r.user_id)) reqs.set(`${r.user_id}:${r.date}`, { availability: r.availability, part: PARTS.includes(r.part) ? r.part : null });

  const venueSet = new Map<number, Set<number> | null>();
  for (const s of staff) {
    const v = parseVenues(answers.get(s.id)?.venues);
    venueSet.set(s.id, v ? new Set(v) : null);
  }
  const nameOf = new Map(staff.map(s => [s.id, s.name]));

  const dayViews = days.map(d => {
    const venues = d.venues.map(v => {
      // その会場に入れる人 = ◎○ で、入りたい会場にこの会場が入っている（またはどこでも・未回答）人
      const people = staff.flatMap(s => {
        const r = reqs.get(`${s.id}:${d.date}`);
        if (!r || r.availability === 'unavailable') return [];
        const vs = venueSet.get(s.id);
        if (vs && v.store_id != null && !vs.has(v.store_id)) return [];
        return [{ user_id: s.id, name: nameOf.get(s.id)!, availability: r.availability, part: r.part, part_label: r.part ? PART_LABEL[r.part] : null }];
      }).sort((a, b) => (a.availability === b.availability ? 0 : a.availability === 'preferred' ? -1 : 1));
      // 枠ごとに足りるか（昼の枠は 昼・どちらでも・1日通し・指定なし の人、夜も同じ）
      const slots = v.slots.map(s => {
        const can = people.filter(p => !p.part || p.part === 'full' || p.part === 'all' || p.part === s.part).length;
        return { ...s, candidates: can, short: Math.max(0, s.needed - can) };
      });
      // 「どちらでも」の人は昼か夜の片方にしか入れないので、昼夜ある日は1日で埋められる回数でも確かめる
      const longVenue = v.slots.some(s => s.part === 'a') && v.slots.some(s => s.part === 'b');
      const capacity = people.reduce((a, p) => a + (longVenue && p.part === 'all' ? 2 : 1), 0);
      const short = Math.max(slots.reduce((a, s) => a + s.short, 0), longVenue ? v.slots.reduce((a, s) => a + s.needed, 0) - capacity : 0);
      return {
        store_id: v.store_id, needed: v.needed, slots, people,
        preferred: people.filter(p => p.availability === 'preferred').length,
        available: people.filter(p => p.availability === 'available').length,
        short,
      };
    });
    return { date: d.date, weekday: d.weekday, long: d.long, venues, short: venues.some(v => v.short > 0) };
  });

  const dates = new Set(days.map(d => d.date));
  const staffViews = staff.map(s => {
    let preferred = 0, available = 0, unavailable = 0;
    for (const d of dates) {
      const r = reqs.get(`${s.id}:${d}`);
      if (!r) continue;
      if (r.availability === 'preferred') preferred++;
      else if (r.availability === 'available') available++;
      else unavailable++;
    }
    const a = answers.get(s.id);
    return {
      id: s.id, name: s.name, color: s.color, linked: !!s.linked,
      answered: !!a?.submitted_at,
      answer: answerView(a, names),
      counts: { preferred, available, unavailable, blank: dates.size - preferred - available - unavailable },
    };
  });

  const line = db.prepare('SELECT channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any;
  res.json({
    campaign: view(c),
    line_configured: !!line?.channel_access_token,
    contact: W(companyId),
    stores: st,
    days: dayViews,
    staff: staffViews,
    totals: {
      staff: staff.length,
      answered: staffViews.filter(s => s.answered).length,
      days: days.length,
      short_days: dayViews.filter(d => d.short).length,
    },
  });
});

export default router;
