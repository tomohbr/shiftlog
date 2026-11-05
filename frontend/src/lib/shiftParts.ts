import type { Shift } from '../api/client'

// 土日・祝日など「昼の部」「夜の部」に分かれる日のシフトを、スタッフに分かりやすく見せる。
// backend/src/utils/shiftParts.ts と同じ決まり:
//   - 同じ人・同じ日・同じ会場で、終わりと始まりがつながったシフトは1つにまとめる
//   - 13時より前に始まる → 昼の部（17時より後まで続くなら 1日通し）
//   - その日その会場に昼の部がある日で、15時以降に始まる → 夜の部
//   - 平日の夕方だけの日などは名前を付けない

export type PartKind = 'day' | 'night' | 'all'
export const PART_NAME: Record<PartKind, string> = { day: '昼の部', night: '夜の部', all: '1日通し' }
export const PART_SHORT: Record<PartKind, string> = { day: '昼', night: '夜', all: '通し' }

export type MergedShift = Shift & {
  part?: PartKind | null
  // まとめる前のシフト（1日通しなら 昼の部 と 夜の部 の2つ）
  pieces?: { id: number; start_time: string; end_time: string }[]
}

const toMin = (t?: string) => { const [h, m] = String(t || '').slice(0, 5).split(':').map(Number); return h * 60 + (m || 0) }
const hm = (t?: string) => String(t || '').slice(0, 5)

export function partOf(start: string, end: string, dayHasDaytime: boolean): PartKind | null {
  const s = toMin(start), e = toMin(end)
  if (s < 13 * 60) return e > 17 * 60 ? 'all' : 'day'
  if (dayHasDaytime && s >= 15 * 60) return 'night'
  return null
}

/** つながったシフトをまとめ、部の名前を付ける。部の判定はその日その会場の全員のシフトから */
export function mergeShifts(shifts: Shift[]): MergedShift[] {
  const daytime = new Set<string>()
  for (const s of shifts) if (toMin(s.start_time) < 13 * 60) daytime.add(`${s.date}|${s.store_id ?? 0}`)
  const sorted = [...shifts].sort((a, b) =>
    a.user_id - b.user_id || a.date.localeCompare(b.date) || (a.store_id ?? 0) - (b.store_id ?? 0) || hm(a.start_time).localeCompare(hm(b.start_time)))
  const out: MergedShift[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && last.user_id === s.user_id && last.date === s.date && (last.store_id ?? null) === (s.store_id ?? null) && hm(last.end_time) === hm(s.start_time)) {
      last.end_time = s.end_time
      last.pieces!.push({ id: s.id, start_time: s.start_time, end_time: s.end_time })
      continue
    }
    out.push({ ...s, pieces: [{ id: s.id, start_time: s.start_time, end_time: s.end_time }] })
  }
  for (const m of out) m.part = partOf(m.start_time, m.end_time, daytime.has(`${m.date}|${m.store_id ?? 0}`))
  return out
}

/** 「1日通し（10:30–16:00 と 16:00–21:00）」のような説明。部がなければ空 */
export function partDetail(s: MergedShift): string {
  if (!s.part) return ''
  if ((s.pieces?.length || 0) > 1) return `${PART_NAME[s.part]}（昼の部と夜の部）`
  return PART_NAME[s.part]
}
