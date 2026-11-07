import db from '../db';

// 「一緒にしない組み合わせ」。同じ会場で時間が重なるシフトに、この2人を同時に入れない。
// スタッフ本人には絶対に見せない（理由も名前も出さない）。止めるときの文言は当たり障りのないものにする。
db.exec(`
  CREATE TABLE IF NOT EXISTS shift_pair_blocks (
    company_id INTEGER NOT NULL,
    user_a INTEGER NOT NULL,
    user_b INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (company_id, user_a, user_b)
  );
`);

export function blockedPartners(companyId: number, userId: number): number[] {
  return (db.prepare('SELECT user_b AS p FROM shift_pair_blocks WHERE company_id = ? AND user_a = ? UNION SELECT user_a FROM shift_pair_blocks WHERE company_id = ? AND user_b = ?')
    .all(companyId, userId, companyId, userId) as { p: number }[]).map(r => r.p);
}

const hm = (t: string) => String(t || '').slice(0, 5);

/** userId をこの枠に入れると、一緒にしない相手と同じ会場・重なる時間になるか */
export function pairConflict(companyId: number, userId: number, date: string, storeId: number | null | undefined, start: string, end: string, excludeShiftId?: number): boolean {
  const partners = blockedPartners(companyId, userId);
  if (!partners.length) return false;
  const rows = db.prepare(`
    SELECT id, start_time, end_time FROM shifts
    WHERE company_id = ? AND date = ? AND COALESCE(store_id, 0) = COALESCE(?, 0)
      AND user_id IN (${partners.map(() => '?').join(',')}) AND status != 'cancelled'
  `).all(companyId, date, storeId ?? null, ...partners) as { id: number; start_time: string; end_time: string }[];
  return rows.some(r => r.id !== excludeShiftId && hm(r.start_time) < hm(end) && hm(start) < hm(r.end_time));
}

export const PAIR_BLOCK_MSG = 'この時間には入れられない設定になっています';

export function listPairBlocks(companyId: number) {
  return db.prepare('SELECT user_a, user_b, created_at FROM shift_pair_blocks WHERE company_id = ?').all(companyId);
}
export function setPairBlocks(companyId: number, pairs: [number, number][]) {
  db.transaction(() => {
    db.prepare('DELETE FROM shift_pair_blocks WHERE company_id = ?').run(companyId);
    const ins = db.prepare('INSERT OR IGNORE INTO shift_pair_blocks (company_id, user_a, user_b) VALUES (?, ?, ?)');
    for (const [a, b] of pairs) if (a && b && a !== b) ins.run(companyId, Math.min(a, b), Math.max(a, b));
  })();
}
