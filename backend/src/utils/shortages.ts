import db from '../db';
import { campaignDays } from './requestCampaign';
import { toMinutes, toHHMM } from './venueSchedule';

// 人が足りないところ。会場の枠（必要人数）に対して、入っているスタッフ（管理者・社員は数えない）を分単位で重ね、
// 足りない時間帯を出す。full = 枠に丸ごと足りない、partial = 一部の時間だけ（例: 18時からの人しかいない）
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
        // 境目ごとに人数を数えて、足りない区間をつなげる
        const cuts = [...new Set([s0, e0, ...here.flatMap(x => [toMinutes(x.start_time), toMinutes(x.end_time)])])]
          .filter(t => t >= s0 && t <= e0).sort((a, b) => a - b);
        const gaps: { from: string; to: string; short: number }[] = [];
        for (let i = 0; i < cuts.length - 1; i++) {
          const a = cuts[i], b = cuts[i + 1];
          const n = here.filter(x => toMinutes(x.start_time) <= a && toMinutes(x.end_time) >= b).length;
          const short = sl.needed - n;
          if (short <= 0) continue;
          const last = gaps[gaps.length - 1];
          if (last && last.to === toHHMM(a) && last.short === short) last.to = toHHMM(b);
          else gaps.push({ from: toHHMM(a), to: toHHMM(b), short });
        }
        if (!gaps.length) continue;
        const wholeSlot = gaps.length === 1 && gaps[0].from === toHHMM(s0) && gaps[0].to === toHHMM(e0);
        out.push({
          date: d.date, weekday: d.weekday, store_id: v.store_id, store_name: v.store_id ? storeName.get(v.store_id) || '' : '',
          start_time: toHHMM(s0), end_time: toHHMM(e0), needed: sl.needed, have: here.length,
          kind: wholeSlot ? 'full' : 'partial',
          short: Math.max(...gaps.map(g => g.short)),
          gaps,
          // 一部だけ入っている人（「凜空 18:00〜」のように）
          partial_people: here.filter(x => toMinutes(x.start_time) > s0 || toMinutes(x.end_time) < e0)
            .map(x => ({ name: x.name, start_time: String(x.start_time).slice(0, 5), end_time: String(x.end_time).slice(0, 5) })),
        });
      }
    }
  }
  return out;
}

/**
 * 希望の画面用: 公開済みの月の日について、まだ人が足りない部（昼 a／夜 b。丸ごと足りない枠も、一部の時間だけ足りない枠も）を返す。
 * 公開済みの月で足りない部がない日は「埋まり」（希望を新しく出せない）。公開前の月は null（全部出せる）。
 */
export function openPartsByDate(companyId: number, from: string, to: string): Map<string, ('a' | 'b')[]> | null {
  const pubs = db.prepare('SELECT year, month FROM shift_publications WHERE company_id = ? AND is_published = 1').all(companyId) as { year: number; month: number }[];
  const published = new Set(pubs.map(p => `${p.year}-${String(p.month).padStart(2, '0')}`));
  if (published.size === 0) return null;
  const out = new Map<string, ('a' | 'b')[]>();
  // 丸ごと足りない枠（赤）に加えて、一部の時間だけ足りない枠（黄。例: 16〜18時だけ空き）も選べるようにする
  const shorts = computeShortages(companyId, from, to);
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!published.has(d.slice(0, 7))) continue;
    const parts = new Set<'a' | 'b'>();
    for (const s of shorts) if (s.date === d) parts.add(s.start_time < '15:00' ? 'a' : 'b');
    out.set(d, [...parts]);
  }
  return out;
}
