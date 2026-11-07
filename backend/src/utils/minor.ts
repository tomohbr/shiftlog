import db from '../db';

// 18歳未満は22時以降働けない。片付けを考えて 21:45 には上がる（2026-11-07 本人指示）
export const MINOR_END = '21:45';

export function isMinor(companyId: number, userId: number): boolean {
  return !!(db.prepare('SELECT is_minor FROM user_companies WHERE user_id = ? AND company_id = ?').get(userId, companyId) as any)?.is_minor;
}

/** 18歳未満なら終わりを 21:45 までに縮める */
export function clampEnd(companyId: number, userId: number, end: string): string {
  return isMinor(companyId, userId) && String(end).slice(0, 5) > MINOR_END ? MINOR_END : end;
}
