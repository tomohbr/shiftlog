import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db';
import { JWT_SECRET } from '../middleware/auth';
import { verifyPunchKey } from './liff';
import { getJSTDate, getJSTTime } from '../utils/jst';
import {
  COMPANY_LOC, InvRole, addDays, addMove, buildLoad, businessDate, closingStatus, confirmLoad, countOf, dayTypeOf,
  DAYTYPE_LABEL, forecastMenus, getSettings, invRole, items, menus, menusForStore, nextOpenDay, openDays,
  reorderAlerts, salesOf, saveCount, saveSales, staleItems, stockAt,
} from '../utils/inventory';
import { seedHibariMarket } from '../utils/inventory-seed';
import { readReceipt, receiptOcrAvailable } from '../utils/receipt-ocr';
import { toMinutes } from '../utils/venueSchedule';

// 催事の在庫・補充の API。
// LINE の中の画面（LIFF）からは打刻と同じ鍵（x-inv-key）で、管理画面からはいつものログイン（JWT）で使う。
// 権限: part（バイト）= 会場の残りの数え・買い足し・足りない連絡 / full（社員）= ＋レジ締め・差の確認 /
//       admin = ＋積み込みの確定・会社在庫・入庫・マスタ

const router = Router();

interface InvReq extends Request { inv?: { userId: number; companyId: number; role: InvRole; name: string } }

function auth(req: InvReq, res: Response, next: NextFunction): void {
  let uid = 0; let cid = 0;
  const key = String(req.headers['x-inv-key'] || '');
  if (key) {
    const k = verifyPunchKey(key);
    if (!k) { res.status(401).json({ error: '時間が経ったので、画面を閉じてもう一度開いてください' }); return; }
    uid = k.uid; cid = k.cid;
  } else {
    const token = String(req.headers['authorization'] || '').split(' ')[1];
    if (!token) { res.status(401).json({ error: '認証が必要です' }); return; }
    try { uid = Number((jwt.verify(token, JWT_SECRET) as any).id); } catch { res.status(401).json({ error: 'ログインし直してください' }); return; }
    cid = Number(req.headers['x-company-id']);
  }
  const role = cid ? invRole(cid, uid) : null;
  if (!role) { res.status(403).json({ error: 'このお店のスタッフではありません' }); return; }
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(uid) as { name: string };
  req.inv = { userId: uid, companyId: cid, role, name: u?.name || '' };
  next();
}

const need = (...roles: InvRole[]) => (req: InvReq, res: Response, next: NextFunction): void => {
  if (!roles.includes(req.inv!.role)) { res.status(403).json({ error: 'この操作は担当の人だけができます' }); return; }
  next();
};

function enabled(req: InvReq, res: Response, next: NextFunction): void {
  if (!getSettings(req.inv!.companyId)?.enabled) { res.status(404).json({ error: '在庫の機能はまだ使えるようになっていません' }); return; }
  next();
}

router.use(auth);

const storeName = (companyId: number) => {
  const rows = db.prepare('SELECT id, name FROM stores WHERE company_id = ?').all(companyId) as { id: number; name: string }[];
  const m = new Map(rows.map(r => [r.id, r.name]));
  return (id: number) => (id === COMPANY_LOC ? '会社（工房）' : m.get(id) || `会場${id}`);
};

function checkStore(req: InvReq, res: Response, storeId: number, allowCompany = false): boolean {
  const s = getSettings(req.inv!.companyId);
  if ((allowCompany && storeId === COMPANY_LOC) || s?.store_ids.includes(storeId)) return true;
  res.status(400).json({ error: '会場を選んでください' });
  return false;
}

const validDate = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

/** 今日の自分の会場（打刻中の会場 → 今日のシフトの会場 → 最初の会場） */
function myStore(companyId: number, userId: number, storeIds: number[]): number | null {
  const today = getJSTDate();
  const tr = db.prepare(`SELECT store_id FROM time_records WHERE company_id = ? AND user_id = ? AND date = ? ORDER BY id DESC LIMIT 1`).get(companyId, userId, today) as any;
  if (tr?.store_id && storeIds.includes(tr.store_id)) return tr.store_id;
  const sh = db.prepare('SELECT store_id FROM shifts WHERE company_id = ? AND user_id = ? AND date = ? ORDER BY start_time LIMIT 1').get(companyId, userId, today) as any;
  if (sh?.store_id && storeIds.includes(sh.store_id)) return sh.store_id;
  return storeIds[0] ?? null;
}

/** 積み込みの対象日: 今日開く会場で、まだ閉店前・未確定なら今日、そうでなければ次に開く日 */
function loadTargetDate(companyId: number, storeId: number): string | null {
  const today = businessDate();
  const close = openDays(companyId, [storeId], today, today).get(storeId)!.get(today);
  const load = db.prepare('SELECT status FROM inv_loads WHERE company_id = ? AND store_id = ? AND date = ?').get(companyId, storeId, today) as any;
  const nowMin = toMinutes(getJSTTime());
  if (close && load?.status !== 'confirmed' && nowMin >= 5 * 60 && nowMin < close) return today;
  return nextOpenDay(companyId, storeId, today);
}

// GET /api/inventory/me - 画面を開いたときに必要なものをまとめて返す
router.get('/me', (req: InvReq, res: Response): void => {
  const { companyId, userId, role, name } = req.inv!;
  const s = getSettings(companyId);
  if (!s?.enabled) { res.json({ enabled: false, role, name }); return; }
  const nameOf = storeName(companyId);
  res.json({
    enabled: true, role, name,
    date: businessDate(),
    stores: s.store_ids.map(id => ({ id, name: nameOf(id) })),
    my_store: myStore(companyId, userId, s.store_ids),
    ocr: receiptOcrAvailable(),
    items: items(companyId),
    menus: menus(companyId),
  });
});

// GET /api/inventory/count?loc=&date= - 数える画面（前回の数も返す。「昨日と同じ」用）
router.get('/count', enabled, (req: InvReq, res: Response): void => {
  const { companyId, role } = req.inv!;
  const loc = Number(req.query.loc);
  if (loc === COMPANY_LOC && role !== 'admin') { res.status(403).json({ error: '会社の在庫は担当の人だけが数えます' }); return; }
  if (!checkStore(req, res, loc, true)) return;
  const date = validDate(req.query.date) || businessDate();
  const list = items(companyId).filter(i => loc !== COMPANY_LOC || i.track_company);
  const cur = countOf(companyId, loc, date);
  const prev = db.prepare(`
    SELECT c.date, l.item_id, l.counted FROM inv_counts c JOIN inv_count_lines l ON l.count_id = c.id
    WHERE c.company_id = ? AND c.loc = ? AND c.date < ? ORDER BY c.date DESC
  `).all(companyId, loc, date) as { date: string; item_id: number; counted: number }[];
  const prevDate = prev[0]?.date || null;
  const showExpected = role !== 'part';
  const stock = showExpected ? stockAt(companyId, loc) : null;
  res.json({
    loc, date, items: list,
    lines: cur?.lines.map((l: any) => ({ item_id: l.item_id, counted: l.counted, ...(showExpected ? { expected: l.expected } : {}) })) || [],
    saved_at: cur?.updated_at || null,
    finalized: !!cur?.finalized,
    previous: { date: prevDate, lines: prev.filter(p => p.date === prevDate).map(p => ({ item_id: p.item_id, counted: p.counted })) },
    ...(stock ? { book: list.map(i => ({ item_id: i.id, qty: stock.get(i.id) || 0 })) } : {}),
  });
});

// POST /api/inventory/count { loc, date, lines: [{ item_id, counted }] }
router.post('/count', enabled, (req: InvReq, res: Response): void => {
  const { companyId, userId, role } = req.inv!;
  const loc = Number(req.body?.loc);
  if (loc === COMPANY_LOC && role !== 'admin') { res.status(403).json({ error: '会社の在庫は担当の人だけが数えます' }); return; }
  if (!checkStore(req, res, loc, true)) return;
  const date = validDate(req.body?.date) || businessDate();
  const known = new Set(items(companyId).map(i => i.id));
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : [])
    .map((l: any) => ({ item_id: Number(l.item_id), counted: Number(l.counted) }))
    .filter((l: any) => known.has(l.item_id) && Number.isFinite(l.counted) && l.counted >= 0);
  if (!lines.length) { res.status(400).json({ error: '数が1つも入っていません' }); return; }
  saveCount(companyId, loc, date, lines, userId);
  res.json({ ok: true, status: loc === COMPANY_LOC ? null : closingStatus(companyId, loc, date) });
});

// GET /api/inventory/sales?store_id=&date= - レジ締めの画面
router.get('/sales', enabled, need('admin', 'full'), (req: InvReq, res: Response): void => {
  const { companyId } = req.inv!;
  const storeId = Number(req.query.store_id);
  if (!checkStore(req, res, storeId)) return;
  const date = validDate(req.query.date) || businessDate();
  res.json({ store_id: storeId, date, menus: menusForStore(menus(companyId), storeId), sales: salesOf(companyId, storeId, date), ocr: receiptOcrAvailable() });
});

// POST /api/inventory/sales/read { store_id, image, media_type } - 締めレシートの写真を読む（保存はしない）
router.post('/sales/read', enabled, need('admin', 'full'), async (req: InvReq, res: Response): Promise<void> => {
  const { companyId } = req.inv!;
  if (!receiptOcrAvailable()) { res.status(400).json({ error: '写真の読み取りはまだ使えません。数を手で入れてください' }); return; }
  const storeId = Number(req.body?.store_id);
  if (!checkStore(req, res, storeId)) return;
  const image = String(req.body?.image || '').replace(/^data:[^,]+,/, '');
  const mt = ['image/jpeg', 'image/png', 'image/webp'].includes(req.body?.media_type) ? req.body.media_type : 'image/jpeg';
  if (image.length < 1000) { res.status(400).json({ error: '写真がありません' }); return; }
  try {
    const result = await readReceipt(image, mt, menusForStore(menus(companyId), storeId));
    res.json(result);
  } catch (e: any) {
    console.error('[inventory] レシート読み取り失敗', e?.status || '', String(e?.message || e).slice(0, 200));
    res.status(502).json({ error: 'レシートを読み取れませんでした。撮り直すか、数を手で入れてください' });
  }
});

// POST /api/inventory/sales { store_id, date, lines: [{ menu_id, qty, amount? }], total_amount?, source?, photo? }
router.post('/sales', enabled, need('admin', 'full'), (req: InvReq, res: Response): void => {
  const { companyId, userId } = req.inv!;
  const storeId = Number(req.body?.store_id);
  if (!checkStore(req, res, storeId)) return;
  const date = validDate(req.body?.date) || businessDate();
  const known = new Set(menusForStore(menus(companyId), storeId).map(m => m.id));
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : [])
    .map((l: any) => ({ menu_id: Number(l.menu_id), qty: Math.max(0, Number(l.qty) || 0), amount: l.amount == null || l.amount === '' ? null : Number(l.amount) }))
    .filter((l: any) => known.has(l.menu_id));
  const photo = typeof req.body?.photo === 'string' && req.body.photo.length < 3_000_000 ? req.body.photo : null;
  saveSales(companyId, storeId, date, lines, {
    userId, source: req.body?.source === 'photo' ? 'photo' : 'manual',
    total: req.body?.total_amount == null || req.body.total_amount === '' ? null : Number(req.body.total_amount),
    photo, ocrRaw: req.body?.ocr_raw ? JSON.stringify(req.body.ocr_raw).slice(0, 20000) : null,
  });
  res.json({ ok: true, status: closingStatus(companyId, storeId, date) });
});

// GET /api/inventory/status?date= - 会場ごとの締めの状況（バイトには差を見せない）
router.get('/status', enabled, (req: InvReq, res: Response): void => {
  const { companyId, role } = req.inv!;
  const s = getSettings(companyId)!;
  const date = validDate(req.query.date) || businessDate();
  const nameOf = storeName(companyId);
  const open = openDays(companyId, s.store_ids, date, date);
  res.json({
    date,
    stores: s.store_ids.map(id => {
      const st = closingStatus(companyId, id, date);
      return { ...st, name: nameOf(id), open_today: open.get(id)!.has(date), diffs: role === 'part' ? [] : st.diffs };
    }),
  });
});

// POST /api/inventory/local-buy { store_id, item_id, qty, note } - 会場の近くで買い足した
router.post('/local-buy', enabled, (req: InvReq, res: Response): void => {
  const { companyId, userId } = req.inv!;
  const storeId = Number(req.body?.store_id);
  if (!checkStore(req, res, storeId)) return;
  const itemId = Number(req.body?.item_id); const qty = Number(req.body?.qty);
  if (!items(companyId).some(i => i.id === itemId) || !(qty > 0)) { res.status(400).json({ error: '品目と数を入れてください' }); return; }
  addMove(companyId, storeId, businessDate(), itemId, qty, 'local_buy', String(req.body?.note || '').slice(0, 200) || null, userId);
  res.json({ ok: true });
});

// 足りない連絡
router.get('/requests', enabled, (req: InvReq, res: Response): void => {
  const { companyId } = req.inv!;
  const nameOf = storeName(companyId);
  const rows = db.prepare(`
    SELECT r.*, i.name AS item_name, i.count_unit, u.name AS user_name FROM inv_requests r
    JOIN inv_items i ON i.id = r.item_id LEFT JOIN users u ON u.id = r.user_id
    WHERE r.company_id = ? AND (r.status = 'open' OR r.created_at >= datetime('now', '-3 days')) ORDER BY r.id DESC
  `).all(companyId) as any[];
  res.json(rows.map(r => ({ ...r, store_name: nameOf(r.store_id) })));
});

router.post('/requests', enabled, (req: InvReq, res: Response): void => {
  const { companyId, userId } = req.inv!;
  const storeId = Number(req.body?.store_id);
  if (!checkStore(req, res, storeId)) return;
  const itemId = Number(req.body?.item_id); const qty = Number(req.body?.qty);
  if (!items(companyId).some(i => i.id === itemId) || !(qty > 0)) { res.status(400).json({ error: '品目と数を入れてください' }); return; }
  db.prepare('INSERT INTO inv_requests (company_id, store_id, item_id, qty, note, user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(companyId, storeId, itemId, qty, String(req.body?.note || '').slice(0, 200) || null, userId);
  res.json({ ok: true });
});

router.delete('/requests/:id', enabled, (req: InvReq, res: Response): void => {
  const { companyId, userId, role } = req.inv!;
  const r = db.prepare(`SELECT * FROM inv_requests WHERE id = ? AND company_id = ? AND status = 'open'`).get(Number(req.params.id), companyId) as any;
  if (!r || (role !== 'admin' && r.user_id !== userId)) { res.status(404).json({ error: '取り消せる連絡がありません' }); return; }
  db.prepare('DELETE FROM inv_requests WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

// GET /api/inventory/load?store_id=&date= - 積み込みリスト（担当者）
router.get('/load', enabled, need('admin'), (req: InvReq, res: Response): void => {
  const { companyId } = req.inv!;
  const s = getSettings(companyId)!;
  const nameOf = storeName(companyId);
  const companyStock = stockAt(companyId, COMPANY_LOC);
  const its = new Map(items(companyId).map(i => [i.id, i]));
  const storeIds = req.query.store_id ? [Number(req.query.store_id)] : s.store_ids;
  const out = [];
  for (const id of storeIds) {
    if (!s.store_ids.includes(id)) continue;
    const date = validDate(req.query.date) || loadTargetDate(companyId, id);
    if (!date) { out.push({ store_id: id, name: nameOf(id), date: null, lines: [], status: 'none' }); continue; }
    const plan = buildLoad(companyId, id, date);
    const fm = forecastMenus(companyId, id, date, s);
    const ms = new Map(menus(companyId).map(m => [m.id, m.name]));
    out.push({
      ...plan, name: nameOf(id),
      daytype: DAYTYPE_LABEL[dayTypeOf(date, s)],
      forecast: [...fm].map(([mid, f]) => ({ menu_id: mid, name: ms.get(mid), qty: Math.round(f.qty), basis: f.basis })),
      stale: staleItems(companyId, id, businessDate()),
      lines: plan.lines.map(l => ({ ...l, company_stock: its.get(l.item_id)?.track_company ? companyStock.get(l.item_id) || 0 : null })),
    });
  }
  res.json({ margin_pct: s.margin_pct, loads: out, reorder: reorderAlerts(companyId, businessDate()) });
});

// POST /api/inventory/load/confirm { store_id, date, lines: [{ item_id, qty }] }
router.post('/load/confirm', enabled, need('admin'), (req: InvReq, res: Response): void => {
  const { companyId, userId } = req.inv!;
  const storeId = Number(req.body?.store_id);
  if (!checkStore(req, res, storeId)) return;
  const date = validDate(req.body?.date);
  if (!date) { res.status(400).json({ error: '届ける日がありません' }); return; }
  const known = new Set(items(companyId).map(i => i.id));
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : [])
    .map((l: any) => ({ item_id: Number(l.item_id), qty: Number(l.qty) }))
    .filter((l: any) => known.has(l.item_id) && Number.isFinite(l.qty) && l.qty >= 0);
  confirmLoad(companyId, storeId, date, lines, userId);
  res.json({ ok: true, load: buildLoad(companyId, storeId, date) });
});

// POST /api/inventory/purchase { item_id, qty, note, date? } - 会社に入庫（仕入れが届いた）
router.post('/purchase', enabled, need('admin'), (req: InvReq, res: Response): void => {
  const { companyId, userId } = req.inv!;
  const itemId = Number(req.body?.item_id); const qty = Number(req.body?.qty);
  if (!items(companyId).some(i => i.id === itemId) || !(qty > 0)) { res.status(400).json({ error: '品目と数を入れてください' }); return; }
  addMove(companyId, COMPANY_LOC, validDate(req.body?.date) || businessDate(), itemId, qty, 'purchase', String(req.body?.note || '').slice(0, 200) || null, userId);
  res.json({ ok: true });
});

// GET /api/inventory/stock - 置き場所ごとの今の在庫（社員以上）
router.get('/stock', enabled, need('admin', 'full'), (req: InvReq, res: Response): void => {
  const { companyId } = req.inv!;
  const s = getSettings(companyId)!;
  const nameOf = storeName(companyId);
  const locs = [COMPANY_LOC, ...s.store_ids];
  res.json({
    locs: locs.map(l => ({ id: l, name: nameOf(l) })),
    items: items(companyId),
    stock: Object.fromEntries(locs.map(l => [l, Object.fromEntries(stockAt(companyId, l))])),
    reorder: reorderAlerts(companyId, businessDate()),
  });
});

// GET /api/inventory/history?days=14 - 締めの記録（売上・差）
router.get('/history', enabled, need('admin', 'full'), (req: InvReq, res: Response): void => {
  const { companyId } = req.inv!;
  const s = getSettings(companyId)!;
  const nameOf = storeName(companyId);
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  const to = businessDate(); const from = addDays(to, -days + 1);
  const rows = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    for (const id of s.store_ids) {
      const st = closingStatus(companyId, id, d);
      const sale = salesOf(companyId, id, d);
      if (!st.counted && !sale) continue;
      rows.push({ ...st, name: nameOf(id), total_amount: sale?.total_amount ?? null, lines: sale?.lines || [] });
    }
  }
  res.json(rows);
});

// ---------- マスタ・設定（担当者） ----------

router.get('/master', need('admin'), (req: InvReq, res: Response): void => {
  const { companyId } = req.inv!;
  const stores = db.prepare('SELECT id, name FROM stores WHERE company_id = ? ORDER BY id').all(companyId);
  const users = db.prepare(`
    SELECT u.id, u.name, CASE WHEN uli.id IS NULL THEN 0 ELSE 1 END AS line_linked FROM users u
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    LEFT JOIN user_line_ids uli ON uli.user_id = u.id
    WHERE u.is_active = 1 AND (uc.role = 'admin' OR uc.employment_type = 'full_time' OR u.role IN ('admin', 'super_admin'))
    ORDER BY u.name
  `).all(companyId);
  res.json({
    settings: getSettings(companyId),
    stores, users,
    items: items(companyId, true),
    menus: menus(companyId, true),
    baselines: db.prepare('SELECT store_id, menu_id, daytype, qty FROM inv_baselines WHERE company_id = ?').all(companyId),
  });
});

router.post('/seed', need('admin'), (req: InvReq, res: Response): void => {
  try { res.json(seedHibariMarket(req.inv!.companyId)); } catch (e: any) { res.status(400).json({ error: e.message }); }
});

router.put('/settings', need('admin'), (req: InvReq, res: Response): void => {
  const { companyId } = req.inv!;
  const b = req.body || {};
  const ids = (v: unknown) => JSON.stringify((Array.isArray(v) ? v : []).map(Number).filter(n => n > 0));
  const special: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.special_days || {})) if (validDate(k) && ['weekday', 'sat', 'sun'].includes(String(v))) special[k] = String(v);
  db.prepare(`
    INSERT INTO inv_settings (company_id, enabled, store_ids, notify_user_ids, margin_pct, special_days, active_from, active_to, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(company_id) DO UPDATE SET enabled = excluded.enabled, store_ids = excluded.store_ids, notify_user_ids = excluded.notify_user_ids,
      margin_pct = excluded.margin_pct, special_days = excluded.special_days, active_from = excluded.active_from, active_to = excluded.active_to,
      updated_at = CURRENT_TIMESTAMP
  `).run(companyId, b.enabled ? 1 : 0, ids(b.store_ids), ids(b.notify_user_ids), Math.max(0, Math.min(100, Number(b.margin_pct) || 0)),
    JSON.stringify(special), validDate(b.active_from), validDate(b.active_to));
  res.json({ ok: true, settings: getSettings(companyId) });
});

const ITEM_FIELDS = ['name', 'category', 'count_unit', 'use_unit', 'per_count', 'half_ok', 'source', 'track_company', 'lead_days', 'cap_per_venue', 'tolerance', 'note', 'sort', 'active'] as const;

function itemValues(b: any) {
  const num = (v: unknown, d: number | null) => (v === '' || v == null ? d : Number(v));
  return [
    String(b.name || '').trim(), b.category === 'container' ? 'container' : 'food', String(b.count_unit || '個'), String(b.use_unit || b.count_unit || '個'),
    Math.max(0.0001, Number(b.per_count) || 1), b.half_ok ? 1 : 0, b.source === 'purchase' ? 'purchase' : 'kobo', b.track_company ? 1 : 0,
    num(b.lead_days, null), num(b.cap_per_venue, null), Math.max(0, Number(b.tolerance) || 0), b.note ? String(b.note) : null, Number(b.sort) || 0, b.active === 0 || b.active === false ? 0 : 1,
  ];
}

router.post('/items', need('admin'), (req: InvReq, res: Response): void => {
  const v = itemValues(req.body || {});
  if (!v[0]) { res.status(400).json({ error: '名前を入れてください' }); return; }
  const r = db.prepare(`INSERT INTO inv_items (company_id, ${ITEM_FIELDS.join(', ')}) VALUES (?, ${ITEM_FIELDS.map(() => '?').join(', ')})`).run(req.inv!.companyId, ...v);
  res.json({ id: Number(r.lastInsertRowid) });
});

router.put('/items/:id', need('admin'), (req: InvReq, res: Response): void => {
  const v = itemValues(req.body || {});
  if (!v[0]) { res.status(400).json({ error: '名前を入れてください' }); return; }
  const r = db.prepare(`UPDATE inv_items SET ${ITEM_FIELDS.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`).run(...v, Number(req.params.id), req.inv!.companyId);
  if (!r.changes) { res.status(404).json({ error: '品目がありません' }); return; }
  res.json({ ok: true });
});

function saveMenu(companyId: number, id: number | null, b: any): number {
  const storeIds = Array.isArray(b.store_ids) && b.store_ids.length ? JSON.stringify(b.store_ids.map(Number)) : null;
  const vals = [String(b.name || '').trim(), b.register_label ? String(b.register_label) : null, storeIds, b.price === '' || b.price == null ? null : Number(b.price), Number(b.sort) || 0, b.active === 0 || b.active === false ? 0 : 1];
  let menuId = id;
  if (id) db.prepare('UPDATE inv_menus SET name = ?, register_label = ?, store_ids = ?, price = ?, sort = ?, active = ? WHERE id = ? AND company_id = ?').run(...vals, id, companyId);
  else menuId = Number(db.prepare('INSERT INTO inv_menus (company_id, name, register_label, store_ids, price, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?)').run(companyId, ...vals).lastInsertRowid);
  const own = new Set(items(companyId, true).map(i => i.id));
  db.prepare('DELETE FROM inv_menu_parts WHERE menu_id = ?').run(menuId);
  const ins = db.prepare('INSERT INTO inv_menu_parts (menu_id, item_id, qty) VALUES (?, ?, ?)');
  for (const p of Array.isArray(b.parts) ? b.parts : []) if (own.has(Number(p.item_id)) && Number(p.qty) > 0) ins.run(menuId, Number(p.item_id), Number(p.qty));
  return menuId!;
}

router.post('/menus', need('admin'), (req: InvReq, res: Response): void => {
  if (!String(req.body?.name || '').trim()) { res.status(400).json({ error: '名前を入れてください' }); return; }
  res.json({ id: db.transaction(() => saveMenu(req.inv!.companyId, null, req.body))() });
});

router.put('/menus/:id', need('admin'), (req: InvReq, res: Response): void => {
  const own = db.prepare('SELECT 1 FROM inv_menus WHERE id = ? AND company_id = ?').get(Number(req.params.id), req.inv!.companyId);
  if (!own) { res.status(404).json({ error: 'メニューがありません' }); return; }
  db.transaction(() => saveMenu(req.inv!.companyId, Number(req.params.id), req.body))();
  res.json({ ok: true });
});

// PUT /api/inventory/baselines { rows: [{ store_id, menu_id, daytype, qty }] }
router.put('/baselines', need('admin'), (req: InvReq, res: Response): void => {
  const { companyId } = req.inv!;
  const own = new Set(menus(companyId, true).map(m => m.id));
  const up = db.prepare(`
    INSERT INTO inv_baselines (company_id, store_id, menu_id, daytype, qty) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(store_id, menu_id, daytype) DO UPDATE SET qty = excluded.qty
  `);
  db.transaction(() => {
    for (const r of Array.isArray(req.body?.rows) ? req.body.rows : []) {
      if (!own.has(Number(r.menu_id)) || !['weekday', 'sat', 'sun'].includes(r.daytype)) continue;
      up.run(companyId, Number(r.store_id), Number(r.menu_id), r.daytype, Math.max(0, Number(r.qty) || 0));
    }
  })();
  res.json({ ok: true });
});

export default router;
