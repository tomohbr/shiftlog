import db from '../db';
import { jstNow } from './jst';
import { SlotRule, expandRules, weekdayOf } from './venueSchedule';

// 催事の在庫・補充の計算（DB の読み書きはここに寄せる。ルートは入出力の形を整えるだけ）。
// 在庫はすべて inv_moves の合計。loc は 0 = 会社（工房）、それ以外は会場の store_id。

export const COMPANY_LOC = 0;
export type DayType = 'weekday' | 'sat' | 'sun';

export interface InvSettings {
  company_id: number;
  enabled: number;
  store_ids: number[];
  notify_user_ids: number[];
  margin_pct: number;
  special_days: Record<string, DayType>;
  active_from: string | null;
  active_to: string | null;
}

export interface InvItem {
  id: number; name: string; category: string; count_unit: string; use_unit: string; per_count: number;
  half_ok: number; source: string; track_company: number; lead_days: number | null; cap_per_venue: number | null;
  tolerance: number; note: string | null; sort: number; active: number;
}

const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; }
};

export function getSettings(companyId: number): InvSettings | null {
  const r = db.prepare('SELECT * FROM inv_settings WHERE company_id = ?').get(companyId) as any;
  if (!r) return null;
  return {
    ...r,
    store_ids: parseJson<number[]>(r.store_ids, []),
    notify_user_ids: parseJson<number[]>(r.notify_user_ids, []),
    special_days: parseJson<Record<string, DayType>>(r.special_days, {}),
  };
}

export function isEnabled(companyId: number): boolean {
  return !!getSettings(companyId)?.enabled;
}

/** 営業日の日付。夜中に締めても前の日として扱う（5時で日付が変わる） */
export function businessDate(now = jstNow()): string {
  const d = new Date(now.getTime() - 5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 振替休日まで含めた祝日（必要な年だけ。足りなければ設定の special_days で上書きできる）
const HOLIDAYS = new Set([
  '2026-11-03', '2026-11-23', '2027-01-01', '2027-01-11',
]);

export function dayTypeOf(date: string, s: InvSettings | null): DayType {
  const special = s?.special_days?.[date];
  if (special) return special;
  const w = weekdayOf(date);
  if (w === 0 || HOLIDAYS.has(date)) return 'sun';
  if (w === 6) return 'sat';
  return 'weekday';
}

export const DAYTYPE_LABEL: Record<DayType, string> = { weekday: '平日', sat: '土曜', sun: '日曜・祝日' };

// ---------- 品目・メニュー ----------

export function items(companyId: number, includeInactive = false): InvItem[] {
  return db.prepare(`SELECT * FROM inv_items WHERE company_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY sort, id`).all(companyId) as InvItem[];
}

export interface MenuWithParts { id: number; name: string; register_label: string | null; store_ids: number[] | null; price: number | null; sort: number; active: number; parts: { item_id: number; qty: number }[] }

export function menus(companyId: number, includeInactive = false): MenuWithParts[] {
  const rows = db.prepare(`SELECT * FROM inv_menus WHERE company_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY sort, id`).all(companyId) as any[];
  const parts = db.prepare(`
    SELECT p.menu_id, p.item_id, p.qty FROM inv_menu_parts p JOIN inv_menus m ON m.id = p.menu_id WHERE m.company_id = ?
  `).all(companyId) as { menu_id: number; item_id: number; qty: number }[];
  return rows.map(m => ({
    ...m,
    store_ids: m.store_ids ? parseJson<number[] | null>(m.store_ids, null) : null,
    parts: parts.filter(p => p.menu_id === m.id).map(p => ({ item_id: p.item_id, qty: p.qty })),
  }));
}

export const menusForStore = (all: MenuWithParts[], storeId: number) => all.filter(m => !m.store_ids || m.store_ids.includes(storeId));

/** 1つ売ったときに減る数（数え単位）。品目ID → 数 */
export function usagePerMenu(menu: MenuWithParts, itemMap: Map<number, InvItem>): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of menu.parts) {
    const it = itemMap.get(p.item_id);
    if (!it) continue;
    out.set(p.item_id, (out.get(p.item_id) || 0) + p.qty / (it.per_count || 1));
  }
  return out;
}

// ---------- 在庫 ----------

/** 置き場所ごとの今の在庫（upTo を渡すとその日までの動きだけ。exceptRef の move は数えない） */
export function stockAt(companyId: number, loc: number, opts: { upTo?: string; exceptRef?: string } = {}): Map<number, number> {
  const rows = db.prepare(`
    SELECT item_id, SUM(qty) AS q FROM inv_moves
    WHERE company_id = ? AND loc = ? ${opts.upTo ? 'AND date <= ?' : ''} ${opts.exceptRef ? 'AND (ref IS NULL OR ref != ?)' : ''}
    GROUP BY item_id
  `).all(...[companyId, loc, ...(opts.upTo ? [opts.upTo] : []), ...(opts.exceptRef ? [opts.exceptRef] : [])]) as { item_id: number; q: number }[];
  return new Map(rows.map(r => [r.item_id, round2(r.q)]));
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** 会場に届いた日（古い順に使う前提で、今の在庫のうち一番古い分が届いた日） */
export function oldestArrival(companyId: number, loc: number, itemId: number, current: number): string | null {
  if (current <= 0) return null;
  const ins = db.prepare(`
    SELECT date, SUM(qty) AS q FROM inv_moves
    WHERE company_id = ? AND loc = ? AND item_id = ? AND qty > 0 AND type IN ('load_in', 'local_buy', 'purchase')
    GROUP BY date ORDER BY date DESC
  `).all(companyId, loc, itemId) as { date: string; q: number }[];
  let left = current;
  for (const r of ins) {
    left -= r.q;
    if (left <= 0) return r.date;
  }
  return ins.length ? ins[ins.length - 1].date : null;
}

function writeMoves(companyId: number, ref: string, rows: { date: string; loc: number; item_id: number; qty: number; type: string; note?: string | null }[], userId: number | null) {
  db.prepare('DELETE FROM inv_moves WHERE company_id = ? AND ref = ?').run(companyId, ref);
  const ins = db.prepare('INSERT INTO inv_moves (company_id, date, loc, item_id, qty, type, ref, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) {
    if (!r.qty) continue;
    ins.run(companyId, r.date, r.loc, r.item_id, round2(r.qty), r.type, ref, r.note ?? null, userId);
  }
}

// ---------- レジ締め（販売数） ----------

export function saveSales(companyId: number, storeId: number, date: string, lines: { menu_id: number; qty: number; amount?: number | null }[], meta: { userId: number | null; source: string; total?: number | null; photo?: string | null; ocrRaw?: string | null }) {
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO inv_sales (company_id, store_id, date, user_id, source, total_amount, photo, ocr_raw)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id, store_id, date) DO UPDATE SET user_id = excluded.user_id, source = excluded.source,
        total_amount = excluded.total_amount, photo = COALESCE(excluded.photo, inv_sales.photo),
        ocr_raw = COALESCE(excluded.ocr_raw, inv_sales.ocr_raw), updated_at = CURRENT_TIMESTAMP
    `).run(companyId, storeId, date, meta.userId, meta.source, meta.total ?? null, meta.photo ?? null, meta.ocrRaw ?? null);
    const sale = db.prepare('SELECT id FROM inv_sales WHERE company_id = ? AND store_id = ? AND date = ?').get(companyId, storeId, date) as { id: number };
    db.prepare('DELETE FROM inv_sales_lines WHERE sales_id = ?').run(sale.id);
    const insLine = db.prepare('INSERT INTO inv_sales_lines (sales_id, menu_id, qty, amount) VALUES (?, ?, ?, ?)');
    for (const l of lines) if (l.qty > 0 || l.amount) insLine.run(sale.id, l.menu_id, l.qty || 0, l.amount ?? null);

    // 売れた数を品目に換算して会場の在庫から引く
    const itemMap = new Map(items(companyId, true).map(i => [i.id, i]));
    const ms = new Map(menus(companyId, true).map(m => [m.id, m]));
    const use = new Map<number, number>();
    for (const l of lines) {
      const m = ms.get(l.menu_id);
      if (!m || !l.qty) continue;
      for (const [itemId, per] of usagePerMenu(m, itemMap)) use.set(itemId, (use.get(itemId) || 0) + per * l.qty);
    }
    writeMoves(companyId, `sales:${sale.id}`, [...use].map(([item_id, q]) => ({ date, loc: storeId, item_id, qty: -q, type: 'sale' })), meta.userId);
    finalizeFrom(companyId, storeId, date);
    return sale.id;
  });
  return tx();
}

export function salesOf(companyId: number, storeId: number, date: string) {
  const s = db.prepare('SELECT id, user_id, source, total_amount, updated_at FROM inv_sales WHERE company_id = ? AND store_id = ? AND date = ?').get(companyId, storeId, date) as any;
  if (!s) return null;
  const lines = db.prepare('SELECT menu_id, qty, amount FROM inv_sales_lines WHERE sales_id = ?').all(s.id);
  return { ...s, lines };
}

// ---------- 数え ----------

export function saveCount(companyId: number, loc: number, date: string, lines: { item_id: number; counted: number }[], userId: number | null) {
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO inv_counts (company_id, loc, date, user_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(company_id, loc, date) DO UPDATE SET user_id = excluded.user_id, updated_at = CURRENT_TIMESTAMP
    `).run(companyId, loc, date, userId);
    const c = db.prepare('SELECT id FROM inv_counts WHERE company_id = ? AND loc = ? AND date = ?').get(companyId, loc, date) as { id: number };
    const up = db.prepare(`
      INSERT INTO inv_count_lines (count_id, item_id, counted) VALUES (?, ?, ?)
      ON CONFLICT(count_id, item_id) DO UPDATE SET counted = excluded.counted
    `);
    for (const l of lines) if (Number.isFinite(l.counted) && l.counted >= 0) up.run(c.id, l.item_id, l.counted);
    finalizeFrom(companyId, loc, date);
    return c.id;
  });
  return tx();
}

export function countOf(companyId: number, loc: number, date: string) {
  const c = db.prepare('SELECT * FROM inv_counts WHERE company_id = ? AND loc = ? AND date = ?').get(companyId, loc, date) as any;
  if (!c) return null;
  const lines = db.prepare('SELECT item_id, counted, expected FROM inv_count_lines WHERE count_id = ?').all(c.id) as { item_id: number; counted: number; expected: number | null }[];
  return { ...c, lines };
}

/**
 * 数えた数を在庫に反映する。会場はレジ締めがそろってから（販売数が入る前に合わせると、売れた分がロスに見える）。
 * その日以降の数えも順に計算し直す（前の日の数えを直すと、次の日の「あるはずの数」が変わるため）。
 */
export function finalizeFrom(companyId: number, loc: number, fromDate: string) {
  const counts = db.prepare('SELECT id, date FROM inv_counts WHERE company_id = ? AND loc = ? AND date >= ? ORDER BY date').all(companyId, loc, fromDate) as { id: number; date: string }[];
  for (const c of counts) {
    const ref = `count:${c.id}`;
    const hasSales = loc === COMPANY_LOC || !!db.prepare('SELECT 1 FROM inv_sales WHERE company_id = ? AND store_id = ? AND date = ?').get(companyId, loc, c.date);
    if (!hasSales) {
      db.prepare('DELETE FROM inv_moves WHERE company_id = ? AND ref = ?').run(companyId, ref);
      db.prepare('UPDATE inv_counts SET finalized = 0 WHERE id = ?').run(c.id);
      continue;
    }
    const expected = stockAt(companyId, loc, { upTo: c.date, exceptRef: ref });
    const lines = db.prepare('SELECT item_id, counted FROM inv_count_lines WHERE count_id = ?').all(c.id) as { item_id: number; counted: number }[];
    const setExp = db.prepare('UPDATE inv_count_lines SET expected = ? WHERE count_id = ? AND item_id = ?');
    for (const l of lines) setExp.run(expected.get(l.item_id) || 0, c.id, l.item_id);
    writeMoves(companyId, ref, lines.map(l => ({ date: c.date, loc, item_id: l.item_id, qty: l.counted - (expected.get(l.item_id) || 0), type: 'adjust' })), null);
    db.prepare('UPDATE inv_counts SET finalized = 1 WHERE id = ?').run(c.id);
  }
}

// ---------- 入庫・買い足し・足りない連絡 ----------

export function addMove(companyId: number, loc: number, date: string, itemId: number, qty: number, type: 'purchase' | 'local_buy', note: string | null, userId: number | null) {
  const r = db.prepare('INSERT INTO inv_moves (company_id, date, loc, item_id, qty, type, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(companyId, date, loc, itemId, round2(qty), type, note, userId);
  db.prepare('UPDATE inv_moves SET ref = ? WHERE id = ?').run(`${type}:${r.lastInsertRowid}`, r.lastInsertRowid);
  if (loc !== COMPANY_LOC) finalizeFrom(companyId, loc, addDays(date, 0));
  else finalizeFrom(companyId, COMPANY_LOC, date);
  return Number(r.lastInsertRowid);
}

// ---------- 会場の営業日 ----------

function slotRules(companyId: number): SlotRule[] {
  return db.prepare('SELECT * FROM venue_slot_rules WHERE company_id = ?').all(companyId) as SlotRule[];
}

/** 会場ごとの「開いている日 → 閉める時刻（分）」。シフトの会場枠から出す（枠の終わり＝閉店） */
export function openDays(companyId: number, storeIds: number[], from: string, to: string): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>(storeIds.map(id => [id, new Map()]));
  for (const s of expandRules(slotRules(companyId), from, to)) {
    if (s.store_id == null || !out.has(s.store_id)) continue;
    const m = out.get(s.store_id)!;
    m.set(s.date, Math.max(m.get(s.date) || 0, s.end));
  }
  return out;
}

/** その日のあとで最初に開く日 */
export function nextOpenDay(companyId: number, storeId: number, after: string): string | null {
  const days = openDays(companyId, [storeId], addDays(after, 1), addDays(after, 14)).get(storeId)!;
  return [...days.keys()].sort()[0] || null;
}

// ---------- 予想 ----------

/** その会場・その日のメニューごとの予想販売数（余裕分を足す前） */
export function forecastMenus(companyId: number, storeId: number, date: string, s: InvSettings | null): Map<number, { qty: number; basis: 'actual' | 'baseline' | 'none' }> {
  const dt = dayTypeOf(date, s);
  const out = new Map<number, { qty: number; basis: 'actual' | 'baseline' | 'none' }>();
  const recent = db.prepare(`
    SELECT s.date, l.menu_id, l.qty FROM inv_sales s JOIN inv_sales_lines l ON l.sales_id = s.id
    WHERE s.company_id = ? AND s.store_id = ? AND s.date < ? ORDER BY s.date DESC
  `).all(companyId, storeId, date) as { date: string; menu_id: number; qty: number }[];
  const sameType = recent.filter(r => dayTypeOf(r.date, s) === dt);
  const datesOfType = [...new Set(sameType.map(r => r.date))].slice(0, 3);
  for (const m of menusForStore(menus(companyId), storeId)) {
    if (datesOfType.length >= 2) {
      const sum = datesOfType.reduce((a, d) => a + (sameType.find(r => r.date === d && r.menu_id === m.id)?.qty || 0), 0);
      out.set(m.id, { qty: sum / datesOfType.length, basis: 'actual' });
      continue;
    }
    const b = db.prepare('SELECT qty FROM inv_baselines WHERE store_id = ? AND menu_id = ? AND daytype = ?').get(storeId, m.id, dt) as { qty: number } | undefined;
    out.set(m.id, b ? { qty: b.qty, basis: 'baseline' } : { qty: 0, basis: 'none' });
  }
  return out;
}

/** その会場・その日に使う見込み（数え単位、余裕分込み） */
export function forecastUsage(companyId: number, storeId: number, date: string, s: InvSettings | null): Map<number, number> {
  const itemMap = new Map(items(companyId).map(i => [i.id, i]));
  const ms = new Map(menus(companyId).map(m => [m.id, m]));
  const margin = 1 + (s?.margin_pct ?? 15) / 100;
  const use = new Map<number, number>();
  for (const [menuId, f] of forecastMenus(companyId, storeId, date, s)) {
    const m = ms.get(menuId);
    if (!m) continue;
    for (const [itemId, per] of usagePerMenu(m, itemMap)) use.set(itemId, (use.get(itemId) || 0) + per * f.qty * margin);
  }
  return use;
}

// ---------- 積み込みリスト ----------

export interface LoadLine { item_id: number; name: string; count_unit: string; category: string; need: number; stock: number; request: number; suggested: number; qty: number; capped: boolean }

/** 届ける日・会場の積み込み数の案。確定済みならその数も返す */
export function buildLoad(companyId: number, storeId: number, date: string) {
  const s = getSettings(companyId);
  const its = items(companyId);
  const use = forecastUsage(companyId, storeId, date, s);
  const stock = stockAt(companyId, storeId);
  const reqs = db.prepare(`SELECT item_id, SUM(qty) AS q FROM inv_requests WHERE company_id = ? AND store_id = ? AND status = 'open' GROUP BY item_id`).all(companyId, storeId) as { item_id: number; q: number }[];
  const reqMap = new Map(reqs.map(r => [r.item_id, r.q]));
  const load = db.prepare('SELECT * FROM inv_loads WHERE company_id = ? AND store_id = ? AND date = ?').get(companyId, storeId, date) as any;
  const saved = load ? new Map((db.prepare('SELECT item_id, suggested, qty FROM inv_load_lines WHERE load_id = ?').all(load.id) as any[]).map(l => [l.item_id, l])) : new Map();

  const lines: LoadLine[] = [];
  for (const it of its) {
    const need = round2(use.get(it.id) || 0);
    const have = stock.get(it.id) || 0;
    const request = reqMap.get(it.id) || 0;
    if (!need && !request && !saved.has(it.id)) continue;
    let suggested = Math.max(0, Math.ceil(need - have - 1e-9)) + Math.ceil(request);
    let capped = false;
    if (it.cap_per_venue != null && have + suggested > it.cap_per_venue) {
      suggested = Math.max(0, Math.floor(it.cap_per_venue - have));
      capped = true;
    }
    const sv = saved.get(it.id);
    lines.push({
      item_id: it.id, name: it.name, count_unit: it.count_unit, category: it.category,
      need, stock: have, request, suggested, qty: load?.status === 'confirmed' && sv ? sv.qty : suggested, capped,
    });
  }
  return { store_id: storeId, date, status: (load?.status as string) || 'draft', confirmed_at: load?.confirmed_at || null, lines };
}

/** 積み込みを確定: 会社から会場へ移動。足りない連絡は済みにする */
export function confirmLoad(companyId: number, storeId: number, date: string, lines: { item_id: number; qty: number }[], userId: number | null) {
  const tx = db.transaction(() => {
    const plan = buildLoad(companyId, storeId, date);
    db.prepare(`
      INSERT INTO inv_loads (company_id, store_id, date, status, confirmed_by, confirmed_at) VALUES (?, ?, ?, 'confirmed', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(company_id, store_id, date) DO UPDATE SET status = 'confirmed', confirmed_by = excluded.confirmed_by, confirmed_at = CURRENT_TIMESTAMP
    `).run(companyId, storeId, date, userId);
    const load = db.prepare('SELECT id FROM inv_loads WHERE company_id = ? AND store_id = ? AND date = ?').get(companyId, storeId, date) as { id: number };
    db.prepare('DELETE FROM inv_load_lines WHERE load_id = ?').run(load.id);
    const ins = db.prepare('INSERT INTO inv_load_lines (load_id, item_id, suggested, qty) VALUES (?, ?, ?, ?)');
    const sugg = new Map(plan.lines.map(l => [l.item_id, l.suggested]));
    const moves: { date: string; loc: number; item_id: number; qty: number; type: string }[] = [];
    for (const l of lines) {
      const q = Math.max(0, Number(l.qty) || 0);
      ins.run(load.id, l.item_id, sugg.get(l.item_id) || 0, q);
      if (!q) continue;
      moves.push({ date, loc: COMPANY_LOC, item_id: l.item_id, qty: -q, type: 'load_out' });
      moves.push({ date, loc: storeId, item_id: l.item_id, qty: q, type: 'load_in' });
    }
    writeMoves(companyId, `load:${load.id}`, moves, userId);
    db.prepare(`UPDATE inv_requests SET status = 'done', load_id = ? WHERE company_id = ? AND store_id = ? AND status = 'open'`).run(load.id, companyId, storeId);
    finalizeFrom(companyId, storeId, date);
    finalizeFrom(companyId, COMPANY_LOC, date);
    return load.id;
  });
  return tx();
}

// ---------- 締めの状況・差・発注の目安 ----------

export function closingStatus(companyId: number, storeId: number, date: string) {
  const count = countOf(companyId, storeId, date);
  const sales = salesOf(companyId, storeId, date);
  const itemMap = new Map(items(companyId, true).map(i => [i.id, i]));
  type Diff = { item_id: number; name: string; count_unit: string; counted: number; expected: number; diff: number };
  const diffs: Diff[] = count?.finalized
    ? count.lines
        .map((l: any) => ({ item_id: l.item_id, name: itemMap.get(l.item_id)?.name || '', count_unit: itemMap.get(l.item_id)?.count_unit || '', counted: l.counted, expected: round2(l.expected ?? 0), diff: round2(l.counted - (l.expected ?? 0)) }))
        // 半分で数える品目（開封済み＝0.5袋）は 0.5 未満のずれを差にしない
        .filter((d: any) => { const it = itemMap.get(d.item_id); return Math.abs(d.diff) > Math.max(0.01, it?.tolerance || 0, it?.half_ok ? 0.5 : 0); })
    : [];
  return {
    store_id: storeId, date,
    counted: !!count, counted_at: count?.updated_at || null,
    sales_done: !!sales, sales_at: sales?.updated_at || null,
    complete: !!count && !!sales,
    diffs,
  };
}

/** 何日も前に届いた分が残っている品目（食品だけ） */
export function staleItems(companyId: number, storeId: number, date: string, days = 3) {
  const stock = stockAt(companyId, storeId);
  const out: { name: string; since: string; days: number }[] = [];
  for (const it of items(companyId)) {
    if (it.category !== 'food') continue;
    const have = stock.get(it.id) || 0;
    const since = oldestArrival(companyId, storeId, it.id, have);
    if (!since) continue;
    const age = Math.round((Date.parse(date) - Date.parse(since)) / 86400000);
    if (age >= days) out.push({ name: it.name, since, days: age });
  }
  return out;
}

/** 仕入れ品の発注の目安: 会社＋会場の合計が、届くまでの日数＋3日分を切ったら */
export function reorderAlerts(companyId: number, today: string) {
  const s = getSettings(companyId);
  const stores = s?.store_ids || [];
  const its = items(companyId).filter(i => i.source === 'purchase');
  if (!its.length) return [];
  const total = new Map<number, number>();
  for (const loc of [COMPANY_LOC, ...stores]) for (const [k, v] of stockAt(companyId, loc)) total.set(k, (total.get(k) || 0) + v);
  // この先7日の使う見込み（開いている日だけ）
  const daily = new Map<number, number>();
  const open = openDays(companyId, stores, today, addDays(today, 6));
  for (const st of stores) for (const d of open.get(st)!.keys()) for (const [k, v] of forecastUsage(companyId, st, d, s)) daily.set(k, (daily.get(k) || 0) + v / 7);
  const out: { item_id: number; name: string; count_unit: string; total: number; per_day: number; days_left: number; lead_days: number }[] = [];
  for (const it of its) {
    const perDay = daily.get(it.id) || 0;
    if (perDay <= 0) continue;
    const have = total.get(it.id) || 0;
    const daysLeft = have / perDay;
    const lead = it.lead_days ?? 3;
    if (daysLeft < lead + 3) out.push({ item_id: it.id, name: it.name, count_unit: it.count_unit, total: round2(have), per_day: round2(perDay), days_left: Math.max(0, Math.floor(daysLeft * 10) / 10), lead_days: lead });
  }
  return out;
}

// ---------- 権限 ----------

export type InvRole = 'admin' | 'full' | 'part';

export function invRole(companyId: number, userId: number): InvRole | null {
  const r = db.prepare(`
    SELECT uc.role AS company_role, uc.employment_type, u.role AS user_role FROM user_companies uc
    JOIN users u ON u.id = uc.user_id AND u.is_active = 1
    WHERE uc.user_id = ? AND uc.company_id = ?
  `).get(userId, companyId) as any;
  if (!r) return null;
  if (r.company_role === 'admin' || ['admin', 'super_admin'].includes(r.user_role)) return 'admin';
  if (r.employment_type === 'full_time') return 'full';
  return 'part';
}
