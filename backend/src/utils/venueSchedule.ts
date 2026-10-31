// 会場ごとの枠と希望から、シフトの下書きを組み立てる純粋なロジック（DBには触らない）。
// ルート側（routes/venue-schedule.ts）が DB から材料を集めて渡し、結果を下書きテーブルに書く。

export type Availability = 'preferred' | 'available' | 'unavailable';

export interface SlotRule {
  id: number;
  store_id: number | null;
  weekdays: string | null;   // '12345' のように曜日番号（0=日〜6=土）を並べた文字列
  date: string | null;       // 日付指定の上書き
  start_time: string;
  end_time: string;
  needed: number;
  break_minutes: number;
  valid_from: string | null;
  valid_to: string | null;
}

export interface Slot {
  key: number;               // 呼び出し側で振る番号（下書き保存後は slot_id）
  store_id: number | null;
  date: string;
  start: number;             // 分（0:00 からの経過分）
  end: number;
  needed: number;
}

export interface RequestInfo {
  availability: Availability;
  start: number | null;      // 希望の時間帯（なければ null = 終日OK）
  end: number | null;
  // 期間の募集で長い日に選んだ「昼 a / 夜 b / 通し full」。昼だけの人は夜の枠に、夜だけの人は昼の枠に入れない
  part?: 'a' | 'b' | 'full' | 'all' | null;
}

/** 15時より前に始まる枠を「昼」、それ以外を「夜」とみなす（期間の募集の昼／夜と同じ区切り） */
export const slotPart = (slot: { start: number }): 'a' | 'b' => (slot.start < 15 * 60 ? 'a' : 'b');

export interface Interval { start: number; end: number }

export type Fit = 'preferred' | 'available' | 'unsubmitted';

/** 'HH:MM' / 'HH:MM:SS' → 分。不正なら NaN */
export function toMinutes(t: string | null | undefined): number {
  if (!t) return NaN;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** start_date〜end_date の日付（YYYY-MM-DD）を並べる */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * ルールを期間内の日付に展開して「その日の枠」を作る。
 * 会場ごと・日ごとに、日付指定があればそれだけを使い（needed=0 は休み）、なければ曜日ルールを使う。
 */
export function expandRules(rules: SlotRule[], start: string, end: string): Array<Omit<Slot, 'key'> & { break_minutes: number }> {
  const storeKeys = [...new Set(rules.map(r => r.store_id ?? 0))];
  const out: Array<Omit<Slot, 'key'> & { break_minutes: number }> = [];
  for (const date of datesBetween(start, end)) {
    const dow = String(weekdayOf(date));
    for (const sk of storeKeys) {
      const mine = rules.filter(r => (r.store_id ?? 0) === sk);
      const byDate = mine.filter(r => r.date === date);
      const use = byDate.length > 0
        ? byDate
        : mine.filter(r => !r.date && (r.weekdays || '').includes(dow)
            && (!r.valid_from || r.valid_from <= date) && (!r.valid_to || r.valid_to >= date));
      for (const r of use) {
        if (r.needed <= 0) continue;
        out.push({
          store_id: r.store_id ?? null, date,
          start: toMinutes(r.start_time), end: toMinutes(r.end_time),
          needed: r.needed, break_minutes: r.break_minutes || 0,
        });
      }
    }
  }
  return out;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * その人をその枠に入れられるか。
 *  - unavailable の日は不可
 *  - 希望の時間帯があれば、枠が希望に収まる → OK、一部だけ重なる → partial、重ならない → 不可
 *  - 同じ日に時間が重なる勤務（確定シフト・下書き）があれば不可
 */
export function judge(
  slot: Slot, req: RequestInfo | undefined, busy: Interval[], includeUnsubmitted: boolean,
): { ok: true; fit: Fit; partial: boolean } | { ok: false; reason: string } {
  if (!req) {
    if (!includeUnsubmitted) return { ok: false, reason: '希望未提出' };
  } else if (req.availability === 'unavailable') {
    return { ok: false, reason: '出勤不可' };
  }
  if (req && (req.part === 'a' || req.part === 'b') && req.part !== slotPart(slot)) {
    return { ok: false, reason: req.part === 'a' ? '昼だけの希望' : '夜だけの希望' };
  }
  let partial = false;
  if (req && req.start != null && req.end != null && !Number.isNaN(req.start) && !Number.isNaN(req.end)) {
    const ov = Math.min(slot.end, req.end) - Math.max(slot.start, req.start);
    if (ov <= 0) return { ok: false, reason: `希望時間外（${toHHMM(req.start)}-${toHHMM(req.end)}）` };
    if (req.start > slot.start || req.end < slot.end) partial = true;
  }
  if (busy.some(b => overlaps(b, slot))) return { ok: false, reason: '同じ時間に別の勤務' };
  const fit: Fit = !req ? 'unsubmitted' : req.availability === 'preferred' ? 'preferred' : 'available';
  return { ok: true, fit, partial };
}

export interface PlanInput {
  slots: Slot[];
  staffIds: number[];
  requests: Map<string, RequestInfo>;        // `${userId}:${date}`
  busy: Map<string, Interval[]>;             // `${userId}:${date}` 確定シフト（全会場）
  existingInSlot: Map<number, number[]>;     // slot.key → その枠をすでに埋めている確定シフトの人
  existingMinutes: Map<number, number>;      // 期間内の確定シフトの合計分（偏りの計算に入れる）
  existingDays: Map<number, Set<string>>;
  includeUnsubmitted: boolean;
  // 期間の募集（request_campaigns）の答え。なければ従来どおり
  //   venueOk   … 「入りたい会場」以外の会場には入れない（どこでも・未回答なら true を返す）
  //   weeklyCap … 「週に入りたい日数」の上限（1〜2日→2、3〜4日→4）。自動では上限を超えて入れない
  //               （足りない枠は下書きに「あと○人」と出るので、管理者が本人と話して手で入れる）
  venueOk?: (userId: number, date: string, storeId: number | null) => boolean;
  weeklyCap?: (userId: number, date: string) => number | null;
  // 一緒に入れない2人（同じ会場・時間が重なる枠に同時に入れない）
  apart?: (a: number, b: number) => boolean;
  // 一緒に入れたい相手（紹介した人・された人）。同じ会場・重なる時間にいれば優先する
  buddies?: (userId: number) => number[];
}

/** その日を含む週（月曜はじまり）の月曜の日付 */
export function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface PlanResult {
  assignments: Array<{ slotKey: number; userId: number }>;
}

const PREF_SCORE: Record<Fit, number> = { preferred: 1, available: 0.5, unsubmitted: 0 };

/**
 * 割り当て本体。
 *  1. 候補が少ない枠から順に、1人ずつ「希望の強さ − これまでの負担」が一番高い人を入れる
 *     （負担 = 勤務時間と勤務日数を、全体の平均で割ったもの。希望1段 ≒ 平均の半分の負担差）
 *  2. 埋まらなかった枠は、希望の時間帯と一部だけ重なる人で埋める（partial。画面で注意を出す）
 *  3. 仕上げに、多すぎる人の自動割当を少なすぎる人へ付け替えて均す
 */
export function plan(input: PlanInput): PlanResult {
  const { slots, staffIds, requests, existingInSlot, includeUnsubmitted } = input;
  const len = (s: Slot) => s.end - s.start;

  // 人ごとの状態
  const busy = new Map<string, Interval[]>();
  for (const [k, v] of input.busy) busy.set(k, [...v]);
  const minutes = new Map<number, number>();
  const days = new Map<number, Map<string, number>>(); // 日付 → その日の勤務数
  for (const id of staffIds) {
    minutes.set(id, input.existingMinutes.get(id) || 0);
    const m = new Map<string, number>();
    for (const d of input.existingDays.get(id) || []) m.set(d, 1);
    days.set(id, m);
  }
  const assigned = new Map<number, number[]>(); // slot.key → userIds
  for (const s of slots) assigned.set(s.key, []);

  const remaining = (s: Slot) => s.needed - (existingInSlot.get(s.key)?.length || 0) - assigned.get(s.key)!.length;

  // 平均の負担（偏りの物差し）。需要の合計を、1日でも入れる人数で割る
  const totalDemandMin = slots.reduce((a, s) => a + Math.max(0, s.needed) * len(s), 0)
    + [...input.existingMinutes.values()].reduce((a, b) => a + b, 0);
  const totalDemandDays = slots.reduce((a, s) => a + Math.max(0, s.needed), 0);
  const willing = staffIds.filter(id => slots.some(s => {
    const r = requests.get(`${id}:${s.date}`);
    return r ? r.availability !== 'unavailable' : includeUnsubmitted;
  }));
  const n = Math.max(1, willing.length);
  const avgMin = Math.max(60, totalDemandMin / n);
  const avgDays = Math.max(1, totalDemandDays / n);
  const load = (id: number) => 0.5 * (minutes.get(id)! / avgMin) + 0.5 * (days.get(id)!.size / avgDays);

  const keyOf = (id: number, date: string) => `${id}:${date}`;
  const venueOk = (s: Slot, id: number) => !input.venueOk || input.venueOk(id, s.date, s.store_id);
  // 週の希望日数を超える分（その日に入れたら上限を何日超えるか。同じ日の2枠目は数えない）
  const overCap = (s: Slot, id: number) => {
    const cap = input.weeklyCap?.(id, s.date);
    if (cap == null) return 0;
    const dm = days.get(id)!;
    if (dm.has(s.date)) return 0;
    const wk = weekOf(s.date);
    let n = 0;
    for (const d of dm.keys()) if (weekOf(d) === wk) n++;
    return Math.max(0, n + 1 - cap);
  };
  // 同じ会場で時間が重なる枠に、一緒に入れない相手がもういるか
  const clashes = (s: Slot, id: number) => {
    if (!input.apart) return false;
    for (const o of slots) {
      if (o.date !== s.date || o.store_id !== s.store_id || !(o.start < s.end && s.start < o.end)) continue;
      for (const other of [...assigned.get(o.key)!, ...(existingInSlot.get(o.key) || [])]) {
        if (other !== id && input.apart(id, other)) return true;
      }
    }
    return false;
  };
  // 同じ日に別の会場へは入れない（会場の行き来はしない）
  const otherVenueSameDay = (s: Slot, id: number) => {
    for (const o of slots) {
      if (o.date !== s.date || o.store_id === s.store_id) continue;
      if (assigned.get(o.key)!.includes(id) || (existingInSlot.get(o.key) || []).includes(id)) return true;
    }
    return false;
  };
  const buddyNear = (s: Slot, id: number) => {
    const bs = input.buddies?.(id);
    if (!bs || bs.length === 0) return false;
    return slots.some(o => o.date === s.date && o.store_id === s.store_id && o.start < s.end && s.start < o.end
      && [...assigned.get(o.key)!, ...(existingInSlot.get(o.key) || [])].some(x => bs.includes(x)));
  };
  // 一緒に入れたい相手が、その日ほかの会場にいる（ここに入れると離ればなれになる）
  const buddyElsewhere = (s: Slot, id: number) => {
    const bs = input.buddies?.(id);
    if (!bs || bs.length === 0) return false;
    return slots.some(o => o.date === s.date && o.store_id !== s.store_id
      && [...assigned.get(o.key)!, ...(existingInSlot.get(o.key) || [])].some(x => bs.includes(x)));
  };
  const isIn = (s: Slot, id: number) =>
    assigned.get(s.key)!.includes(id) || (existingInSlot.get(s.key) || []).includes(id);

  const place = (s: Slot, id: number) => {
    assigned.get(s.key)!.push(id);
    const k = keyOf(id, s.date);
    if (!busy.has(k)) busy.set(k, []);
    busy.get(k)!.push({ start: s.start, end: s.end });
    minutes.set(id, minutes.get(id)! + len(s));
    const dm = days.get(id)!;
    dm.set(s.date, (dm.get(s.date) || 0) + 1);
  };
  const unplace = (s: Slot, id: number) => {
    const list = assigned.get(s.key)!;
    list.splice(list.indexOf(id), 1);
    const k = keyOf(id, s.date);
    const b = busy.get(k)!;
    const i = b.findIndex(x => x.start === s.start && x.end === s.end);
    if (i >= 0) b.splice(i, 1);
    minutes.set(id, minutes.get(id)! - len(s));
    const dm = days.get(id)!;
    const c = (dm.get(s.date) || 1) - 1;
    if (c <= 0) dm.delete(s.date); else dm.set(s.date, c);
  };

  const candidatesFor = (s: Slot, allowPartial: boolean) => {
    const out: Array<{ id: number; score: number }> = [];
    for (const id of staffIds) {
      if (isIn(s, id)) continue;
      if (!venueOk(s, id) || overCap(s, id) > 0 || clashes(s, id) || otherVenueSameDay(s, id)) continue;
      const j = judge(s, requests.get(keyOf(id, s.date)), busy.get(keyOf(id, s.date)) || [], includeUnsubmitted);
      if (!j.ok) continue;
      if (j.partial && !allowPartial) continue;
      // 同じ日の2枠目（昼＋夜）は、本人が「1日通し」と答えた日だけ。そのときはむしろ優先する
      const part = requests.get(keyOf(id, s.date))?.part;
      const already = days.get(id)!.has(s.date);
      if (already && (part === 'a' || part === 'b' || part === 'full')) continue;
      const sameDay = already ? (part === 'all' ? -0.3 : 0.3) : 0;
      const withBuddy = buddyNear(s, id) ? 0.6 : buddyElsewhere(s, id) ? -0.6 : 0;
      out.push({ id, score: PREF_SCORE[j.fit] * 0.5 - load(id) - sameDay - (j.partial ? 0.5 : 0) + withBuddy });
    }
    // 同点は日付と人で決まる順（毎回同じ人が先に来ないように）
    out.sort((a, b) => b.score - a.score || ((a.id * 7919 + s.start) % 97) - ((b.id * 7919 + s.start) % 97));
    return out;
  };

  // 1) 候補の少ない枠から（逃すと埋まらない枠を先に押さえる）
  const tightness = new Map<number, number>();
  for (const s of slots) tightness.set(s.key, candidatesFor(s, false).length - remaining(s));
  const order = [...slots].sort((a, b) =>
    tightness.get(a.key)! - tightness.get(b.key)! || a.date.localeCompare(b.date) || a.start - b.start);

  for (const pass of [false, true]) {
    for (const s of order) {
      while (remaining(s) > 0) {
        const c = candidatesFor(s, pass);
        if (c.length === 0) break;
        place(s, c[0].id);
      }
    }
  }

  // 3) 均し: 一番多い人の割当を、条件を満たす少ない人に付け替える。改善がなくなるまで
  for (let iter = 0; iter < 500; iter++) {
    let moved = false;
    const byLoad = [...staffIds].sort((a, b) => minutes.get(b)! - minutes.get(a)!);
    outer:
    for (const from of byLoad) {
      for (const s of slots) {
        if (!assigned.get(s.key)!.includes(from)) continue;
        const fromFit = judge(s, requests.get(keyOf(from, s.date)), [], includeUnsubmitted);
        const fromPref = fromFit.ok ? PREF_SCORE[fromFit.fit] : 0;
        for (const to of [...staffIds].sort((a, b) => minutes.get(a)! - minutes.get(b)!)) {
          if (to === from || isIn(s, to)) continue;
          if (!venueOk(s, to) || overCap(s, to) > 0 || clashes(s, to) || otherVenueSameDay(s, to)) continue;
          if (days.get(to)!.has(s.date) && requests.get(keyOf(to, s.date))?.part !== 'all') continue;
          const gap = minutes.get(from)! - minutes.get(to)!;
          if (gap <= len(s)) break; // ここから先は差が縮まらない
          const j = judge(s, requests.get(keyOf(to, s.date)), busy.get(keyOf(to, s.date)) || [], includeUnsubmitted);
          if (!j.ok || j.partial) continue;
          // 希望（◎）の人を「可」の人に替えるのは、差がかなり大きいときだけ
          if (PREF_SCORE[j.fit] < fromPref && gap < len(s) * 3) continue;
          unplace(s, from);
          place(s, to);
          moved = true;
          break outer;
        }
      }
    }
    if (!moved) break;
  }

  const assignments: PlanResult['assignments'] = [];
  for (const s of slots) for (const id of assigned.get(s.key)!) assignments.push({ slotKey: s.key, userId: id });
  return { assignments };
}
