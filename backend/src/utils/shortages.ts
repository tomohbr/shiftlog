import db from '../db';
import { campaignDays } from './requestCampaign';
import { toMinutes, toHHMM } from './venueSchedule';

// 人が足りないところ。会場の枠（必要人数）に対して、入っているスタッフ（管理者・社員は数えない）を数え、
// 足りない枠を出す。一部の時間だけ入る人も1人と数えるので、出るのは full（人数が足りない枠）だけ。partial は今は出さない
export interface ShortageGap { from: string; to: string; short: number }
export interface Shortage {
  date: string; weekday: number; store_id: number | null; store_name: string
  start_time: string; end_time: string; needed: number; have: number
  kind: 'full' | 'partial'; short: number; gaps: ShortageGap[]
  partial_people: { name: string; start_time: string; end_time: string }[]
}

export function computeShortages(companyId: number, from: string, to: string): Shortage[] {
  const days = campaignDays(companyId, from, to);
  const shifts = db.prepare(`
    SELECT s.date, s.store_id, s.start_time, s.end_time, COALESCE(NULLIF(uc.display_name, ''), u.name) AS name
    FROM shifts s JOIN users u ON u.id = s.user_id
    JOIN user_companies uc ON uc.user_id = s.user_id AND uc.company_id = s.company_id
    WHERE s.company_id = ? AND s.date >= ? AND s.date <= ?
      AND uc.role = 'staff' AND u.role NOT IN ('admin', 'super_admin')
  `).all(companyId, from, to) as { date: string; store_id: number | null; start_time: string; end_time: string; name: string }[];
  const storeName = new Map((db.prepare('SELECT id, name FROM stores WHERE company_id = ?').all(companyId) as any[]).map(r => [r.id, r.name]));
  const out: Shortage[] = [];
  for (const d of days) {
    for (const v of d.venues) {
      for (const sl of v.slots) {
        if (!sl.needed) continue;
        const s0 = toMinutes(sl.start_time), e0 = toMinutes(sl.end_time);
        const here = shifts.filter(x => x.date === d.date && (x.store_id ?? null) === (v.store_id ?? null)
          && toMinutes(x.start_time) < e0 && toMinutes(x.end_time) > s0);
        // 一部の時間だけ入る人（例: 18時から）も、その枠に入っている1人として数える。
        // 「16〜18時だけ足りない」ような一部の不足（黄）は出さない（2026-11-06 芝原さん指示）。足りないのは人数そのものが足りない枠だけ
        const short = sl.needed - here.length;
        if (short <= 0) continue;
        out.push({
          date: d.date, weekday: d.weekday, store_id: v.store_id, store_name: v.store_id ? storeName.get(v.store_id) || '' : '',
          start_time: toHHMM(s0), end_time: toHHMM(e0), needed: sl.needed, have: here.length,
          kind: 'full',
          short,
          gaps: [{ from: toHHMM(s0), to: toHHMM(e0), short }],
          // 一部だけ入っている人（「凜空 18:00〜」のように）
          partial_people: here.filter(x => toMinutes(x.start_time) > s0 || toMinutes(x.end_time) < e0)
            .map(x => ({ name: x.name, start_time: String(x.start_time).slice(0, 5), end_time: String(x.end_time).slice(0, 5) })),
        });
      }
    }
  }
  return out;
}

/** 1日分の「まだ人が足りないところ」を会場ごとに。キーは会場ID（会場なしは 0） */
export interface DayOpen {
  parts: Record<string, ('a' | 'b')[]>   // 足りない部（昼 a／夜 b）
  full: Record<string, boolean>          // 丸ごと足りない枠がある
  times: Record<string, string[]>        // 一部の時間だけ足りない時間（例: 16:00〜18:00）
}

/**
 * 希望の画面用: 公開済みの月の日について、会場ごとにまだ人が足りない部を返す（丸ごと足りない枠も、一部の時間だけ足りない枠も）。
 * 公開済みの月で足りないところがない日は空の DayOpen（埋まり）。公開前の月は入れない。どの月も公開前なら null（全部出せる）。
 */
export function openByDate(companyId: number, from: string, to: string): Map<string, DayOpen> | null {
  const pubs = db.prepare('SELECT year, month FROM shift_publications WHERE company_id = ? AND is_published = 1').all(companyId) as { year: number; month: number }[];
  const published = new Set(pubs.map(p => `${p.year}-${String(p.month).padStart(2, '0')}`));
  if (published.size === 0) return null;
  const out = new Map<string, DayOpen>();
  const shorts = computeShortages(companyId, from, to);
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (published.has(d.slice(0, 7))) out.set(d, { parts: {}, full: {}, times: {} });
  }
  for (const s of shorts) {
    const o = out.get(s.date);
    if (!o) continue;
    const k = String(s.store_id ?? 0);
    const part: 'a' | 'b' = s.start_time < '15:00' ? 'a' : 'b';
    const ps = (o.parts[k] ??= []);
    if (!ps.includes(part)) ps.push(part);
    if (s.kind === 'full') o.full[k] = true;
    else for (const g of s.gaps) { const tt = `${g.from}〜${g.to}`; const ts = (o.times[k] ??= []); if (!ts.includes(tt)) ts.push(tt); }
  }
  return out;
}

/**
 * その人が行ける会場（'any' か会場IDの配列。空ならどこでも）だけで見た、足りない部と足りない時間。
 * 行ける会場のどこかに丸ごと足りない枠がある日は、時間（times）は出さない。
 */
export function openFor(o: DayOpen | undefined, venues: 'any' | number[]): { parts: ('a' | 'b')[]; times: string | null } {
  if (!o) return { parts: [], times: null };
  const keys = Object.keys(o.parts).filter(k => venues === 'any' || venues.length === 0 || k === '0' || venues.includes(Number(k)));
  const parts = [...new Set(keys.flatMap(k => o.parts[k]))];
  const anyFull = keys.some(k => o.full[k]);
  const times = anyFull ? [] : [...new Set(keys.flatMap(k => o.times[k] ?? []))];
  return { parts, times: times.length ? times.join('、') : null };
}
