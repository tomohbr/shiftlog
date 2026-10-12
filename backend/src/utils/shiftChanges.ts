import db from '../db';

// 公開済みのシフトへの変更を記録し、管理者が確認してから本人にまとめて知らせるための仕組み。
// 1件直すたびに送ると通知が連発するので、記録だけしておき「本人に知らせる」で送る。
// 同じシフトを何度か直した場合は、最初の状態 → 最後の状態だけを伝える。

db.exec(`
  CREATE TABLE IF NOT EXISTS shift_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    shift_id INTEGER NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notified_at DATETIME
  );
  CREATE INDEX IF NOT EXISTS idx_shift_changes_pending ON shift_changes(company_id, notified_at);
`);

export interface ShiftSnap { date: string; start_time: string; end_time: string; store_id: number | null; store_name: string | null }

export function snapOf(shiftId: number | bigint): ShiftSnap | null {
  return (db.prepare(`
    SELECT s.date, s.start_time, s.end_time, s.store_id, st.name AS store_name
    FROM shifts s LEFT JOIN stores st ON st.id = s.store_id WHERE s.id = ?
  `).get(shiftId) as ShiftSnap | undefined) || null;
}

function isPublished(companyId: number, date: string): boolean {
  return !!db.prepare('SELECT 1 FROM shift_publications WHERE company_id = ? AND year = ? AND month = ? AND is_published = 1')
    .get(companyId, Number(date.slice(0, 4)), Number(date.slice(5, 7)));
}

/** 変更を記録する（どちらかの日付が公開済みの月のときだけ。下書き中の月は記録しない） */
export function recordShiftChange(companyId: number, userId: number, shiftId: number, before: ShiftSnap | null, after: ShiftSnap | null): void {
  const dates = [before?.date, after?.date].filter(Boolean) as string[];
  if (!dates.some(d => isPublished(companyId, d))) return;
  db.prepare('INSERT INTO shift_changes (company_id, user_id, shift_id, before_json, after_json) VALUES (?, ?, ?, ?, ?)')
    .run(companyId, userId, shiftId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);
}

export interface PendingChange { ids: number[]; shift_id: number; before: ShiftSnap | null; after: ShiftSnap | null }
export interface PendingByUser { user_id: number; name: string; linked: boolean; changes: PendingChange[] }

const same = (a: ShiftSnap | null, b: ShiftSnap | null) =>
  JSON.stringify(a && { ...a, store_name: null }) === JSON.stringify(b && { ...b, store_name: null });

/** まだ知らせていない変更（人ごと・シフトごとにまとめる。結果的に元に戻ったものは除く） */
export function pendingChanges(companyId: number): PendingByUser[] {
  const rows = db.prepare(`
    SELECT c.*, u.name, (uli.line_user_id IS NOT NULL) AS linked FROM shift_changes c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN user_line_ids uli ON uli.user_id = c.user_id
    WHERE c.company_id = ? AND c.notified_at IS NULL ORDER BY c.id
  `).all(companyId) as any[];
  const byUser = new Map<number, PendingByUser & { _m: Map<number, PendingChange> }>();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user_id: r.user_id, name: r.name, linked: !!r.linked, changes: [], _m: new Map() });
    const u = byUser.get(r.user_id)!;
    const cur = u._m.get(r.shift_id);
    const after = r.after_json ? JSON.parse(r.after_json) : null;
    if (cur) { cur.ids.push(r.id); cur.after = after; }
    else u._m.set(r.shift_id, { ids: [r.id], shift_id: r.shift_id, before: r.before_json ? JSON.parse(r.before_json) : null, after });
  }
  const out: PendingByUser[] = [];
  for (const u of byUser.values()) {
    const all = [...u._m.values()];
    const changes = all.filter(c => !same(c.before, c.after))
      .sort((a, b) => ((a.after || a.before)!.date).localeCompare((b.after || b.before)!.date));
    // 元に戻っただけのものは、知らせずに済んだ扱いにする
    const noops = all.filter(c => same(c.before, c.after)).flatMap(c => c.ids);
    if (noops.length) markNotified(noops);
    if (changes.length) out.push({ user_id: u.user_id, name: u.name, linked: u.linked, changes });
  }
  return out;
}

export function markNotified(ids: number[]): void {
  if (!ids.length) return;
  const stmt = db.prepare("UPDATE shift_changes SET notified_at = datetime('now') WHERE id = ?");
  db.transaction((list: number[]) => { for (const id of list) stmt.run(id); })(ids);
}
