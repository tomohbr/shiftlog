import db from '../db';
import { SlotRule, expandRules, toHHMM, weekdayOf } from './venueSchedule';

// 期間をまたぐ希望の募集（request_campaigns）の共通ロジック。
// 候補日は保存せず、会場ごとの枠（venue_slot_rules）から毎回出す。
//   - 候補日 = 期間内で、どれかの会場に枠がある日（needed=0 の日付指定＝休み・枠のない日は出さない）
//   - 長い日 = その日に昼と夜の2つ以上の枠がある会場がある日、または15時より前に始まる枠がある日
//     → スタッフは ◎○ を付けたときに「昼／夜／通し」を選べる

// full = 昼でも夜でもどちらか一方（どちらでも）、all = 1日通し（昼も夜も両方入る）
export type Part = 'a' | 'b' | 'full' | 'all';
export const PARTS: Part[] = ['a', 'b', 'full', 'all'];
export const PART_LABEL: Record<Part, string> = { a: '昼', b: '夜', full: 'どちらでも', all: '1日通し' };
// 土日など昼夜に分かれる日に、1日通しで入れるか
export const LONG_DAY = ['yes', 'half', 'depends'] as const;
export const LONG_DAY_LABEL: Record<string, string> = { yes: '通しOK', half: '半日まで', depends: '日による' };
// 一緒に働ける人を紹介できるか（人手が足りないときの声かけ先）
export const REFERRAL = ['yes', 'ask', 'no'] as const;
export const REFERRAL_LABEL: Record<string, string> = { yes: 'できる', ask: '聞いてみる', no: 'いない' };

// 15時より前に始まる枠を「昼」、それ以外を「夜」とみなす
const DAY_SLOT_BEFORE = 15 * 60;
// 昼・夜の時間の基準（その日の枠がはみ出すときは枠に合わせて広げる）
const DAY_FROM = 9 * 60, SPLIT = 16 * 60, NIGHT_TO = 23 * 60;

export interface CampaignSlot { start_time: string; end_time: string; needed: number; part: 'a' | 'b' }
export interface CampaignDay {
  date: string;
  weekday: number;            // 0=日〜6=土
  venues: { store_id: number | null; slots: CampaignSlot[]; needed: number }[];
  long: boolean;
  // 長い日の「昼」「夜」を時間に直したもの（自動作成が preferred_start/end として読む）
  times: Record<'a' | 'b', { start: string; end: string }>;
}

export const DAYS_PER_WEEK = ['1-2', '3-4', '5+'] as const;
export const DAYS_PER_WEEK_LABEL: Record<string, string> = { '1-2': '週1〜2日', '3-4': '週3〜4日', '5+': '週5日以上' };
/** 週の希望日数の上限の目安（自動作成の均しに使う。5日以上は上限なし） */
export const weeklyCapOf = (v: string | null | undefined): number | null => (v === '1-2' ? 2 : v === '3-4' ? 4 : null);

export const TRANSPORTS = ['徒歩・自転車', '車', 'バイク', '電車・バス', '送迎が必要'];

export function campaignDays(companyId: number, start: string, end: string): CampaignDay[] {
  const rules = db.prepare('SELECT * FROM venue_slot_rules WHERE company_id = ?').all(companyId) as SlotRule[];
  // 消された会場のルールは使わない
  const storeIds = new Set((db.prepare('SELECT id FROM stores WHERE company_id = ?').all(companyId) as any[]).map(s => s.id));
  const usable = rules.filter(r => r.store_id == null || storeIds.has(r.store_id));
  const expanded = expandRules(usable, start, end);

  const byDate = new Map<string, typeof expanded>();
  for (const e of expanded) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }
  const days: CampaignDay[] = [];
  for (const [date, list] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const venueMap = new Map<number | null, CampaignDay['venues'][number]>();
    for (const e of [...list].sort((a, b) => a.start - b.start)) {
      const k = e.store_id ?? null;
      if (!venueMap.has(k)) venueMap.set(k, { store_id: k, slots: [], needed: 0 });
      const v = venueMap.get(k)!;
      v.slots.push({ start_time: toHHMM(e.start), end_time: toHHMM(e.end), needed: e.needed, part: e.start < DAY_SLOT_BEFORE ? 'a' : 'b' });
      v.needed += e.needed;
    }
    const venues = [...venueMap.values()].sort((a, b) => (a.store_id ?? 0) - (b.store_id ?? 0));
    const long = venues.some(v => v.slots.length >= 2) || list.some(e => e.start < DAY_SLOT_BEFORE);
    const daySlots = list.filter(e => e.start < DAY_SLOT_BEFORE);
    const nightSlots = list.filter(e => e.start >= DAY_SLOT_BEFORE);
    const dayEnd = Math.max(SPLIT, ...daySlots.map(e => e.end));
    const nightStart = Math.min(SPLIT, ...nightSlots.map(e => e.start));
    days.push({
      date, weekday: weekdayOf(date), venues, long,
      times: {
        a: { start: toHHMM(Math.min(DAY_FROM, ...daySlots.map(e => e.start))), end: toHHMM(dayEnd) },
        b: { start: toHHMM(nightStart), end: toHHMM(Math.max(NIGHT_TO, ...nightSlots.map(e => e.end))) },
      },
    });
  }
  return days;
}

export const jstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 締切まであと何日か（当日 = 0、過ぎたら負） */
export function daysLeft(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  return Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${jstToday()}T00:00:00Z`)) / 86400000);
}

/** スタッフが今この募集に答えられるか（受付中で、締切日を過ぎていない） */
export function isAccepting(c: { status: string; deadline: string | null }): boolean {
  if (c.status !== 'open') return false;
  return !c.deadline || jstToday() <= c.deadline;
}

/** 答えの「入りたい会場」。null = どこでも（または未回答） */
export function parseVenues(v: string | null | undefined): number[] | null {
  if (!v || v === 'any') return null;
  const ids = v.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
  return ids.length ? ids : null;
}

/**
 * 自動作成用: 期間にかかる募集の答えから、人ごとの「入りたい会場」と「週の日数の上限」を集める。
 * 同じ日に複数の募集がかかるときは新しい募集の答えを使う。
 */
export function campaignPreferences(companyId: number, start: string, end: string) {
  const rows = db.prepare(`
    SELECT a.user_id, a.venues, a.days_per_week, c.id AS campaign_id, c.start_date, c.end_date
    FROM request_campaign_answers a JOIN request_campaigns c ON c.id = a.campaign_id
    WHERE c.company_id = ? AND c.status IN ('open', 'closed') AND a.submitted_at IS NOT NULL
      AND NOT (c.end_date < ? OR c.start_date > ?)
    ORDER BY c.id DESC
  `).all(companyId, start, end) as any[];
  const byUser = new Map<number, Array<{ from: string; to: string; venues: Set<number> | null; cap: number | null }>>();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    const v = parseVenues(r.venues);
    byUser.get(r.user_id)!.push({ from: r.start_date, to: r.end_date, venues: v ? new Set(v) : null, cap: weeklyCapOf(r.days_per_week) });
  }
  const find = (userId: number, date: string) => byUser.get(userId)?.find(x => x.from <= date && date <= x.to);
  return {
    /** その日・その会場に入れてよいか（答えがない・どこでも・会場なしの枠なら true） */
    venueOk: (userId: number, date: string, storeId: number | null) => {
      const p = find(userId, date);
      return !p || !p.venues || storeId == null || p.venues.has(storeId);
    },
    /** その日の週の日数の上限（なければ null） */
    weeklyCap: (userId: number, date: string) => find(userId, date)?.cap ?? null,
    has: (userId: number) => byUser.has(userId),
  };
}

/** 長い日の昼夜通しを preferred_start/end に直す（通し・短い日は時間なし） */
export function partTimes(day: CampaignDay | undefined, part: Part | null): { start: string | null; end: string | null } {
  if (!day || !day.long || !part || part === 'full' || part === 'all') return { start: null, end: null };
  return day.times[part];
}

