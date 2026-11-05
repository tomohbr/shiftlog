import db from '../db';

// 土日・祝日など「昼の部」「夜の部」に分かれる日のシフトを、スタッフに分かりやすく見せるための共通処理。
//   - 同じ人・同じ日・同じ会場で、終わりと始まりがつながったシフト（10:30–16:00 と 16:00–21:00）は 1つにまとめて「1日通し」
//   - 13時より前に始まる → 昼の部（17時より後まで続くなら 1日通し）
//   - その日その会場に昼の部がある日で、15時以降に始まる → 夜の部
//   - 平日の夕方だけの日などは名前を付けない（時間だけ）
// フロントの frontend/src/lib/shiftParts.ts と同じ決まり。

export type PartKind = 'day' | 'night' | 'all';
export const PART_NAME: Record<PartKind, string> = { day: '昼の部', night: '夜の部', all: '1日通し' };

const toMin = (t: string) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };
const DAY_START_BEFORE = 13 * 60;
const DAY_END_BY = 17 * 60;
const NIGHT_FROM = 15 * 60;

export function partOf(start: string, end: string, dayHasDaytime: boolean): PartKind | null {
  const s = toMin(start), e = toMin(end);
  if (s < DAY_START_BEFORE) return e > DAY_END_BY ? 'all' : 'day';
  if (dayHasDaytime && s >= NIGHT_FROM) return 'night';
  return null;
}

/** その日その会場に、昼の部（13時より前に始まるシフト）があるか */
export function dayHasDaytime(companyId: number, date: string, storeId: number | null): boolean {
  return !!db.prepare(`
    SELECT 1 FROM shifts WHERE company_id = ? AND date = ? AND COALESCE(store_id, 0) = COALESCE(?, 0) AND start_time < '13:00' LIMIT 1
  `).get(companyId, date, storeId ?? null);
}

export interface ShiftPiece { id: number; date: string; start_time: string; end_time: string; store_id: number | null; store_name?: string | null; user_id?: number }
export interface ShiftBlock<T extends ShiftPiece = ShiftPiece> {
  ids: number[];
  date: string;
  start_time: string;
  end_time: string;
  store_id: number | null;
  store_name: string | null;
  pieces: T[];
  part: PartKind | null;
}

/** つながったシフトを1つにまとめる（同じ人・同じ日・同じ会場のみ）。入力の並びは問わない */
export function mergeBlocks<T extends ShiftPiece>(companyId: number, shifts: T[]): ShiftBlock<T>[] {
  const sorted = [...shifts].sort((a, b) =>
    (a.user_id ?? 0) - (b.user_id ?? 0) || a.date.localeCompare(b.date) || (a.store_id ?? 0) - (b.store_id ?? 0) || String(a.start_time).localeCompare(String(b.start_time)));
  const out: ShiftBlock<T>[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    const p = last?.pieces[last.pieces.length - 1];
    if (last && p && p.user_id === s.user_id && last.date === s.date && (last.store_id ?? null) === (s.store_id ?? null)
      && String(p.end_time).slice(0, 5) === String(s.start_time).slice(0, 5)) {
      last.pieces.push(s);
      last.ids.push(s.id);
      last.end_time = s.end_time;
      continue;
    }
    out.push({ ids: [s.id], date: s.date, start_time: s.start_time, end_time: s.end_time, store_id: s.store_id ?? null, store_name: s.store_name ?? null, pieces: [s], part: null });
  }
  const cache = new Map<string, boolean>();
  for (const b of out) {
    const k = `${b.date}|${b.store_id ?? 0}`;
    if (!cache.has(k)) cache.set(k, dayHasDaytime(companyId, b.date, b.store_id));
    b.part = partOf(b.start_time, b.end_time, cache.get(k)!);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.start_time).localeCompare(String(b.start_time)));
}

/** 1つのシフトの部の名前（昼の部・夜の部・1日通し・なし） */
export function partNameOf(companyId: number, s: { date: string; start_time: string; end_time: string; store_id: number | null }): string {
  const k = partOf(s.start_time, s.end_time, dayHasDaytime(companyId, s.date, s.store_id ?? null));
  return k ? PART_NAME[k] : '';
}
