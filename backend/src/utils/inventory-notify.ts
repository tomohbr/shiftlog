import db from '../db';
import { buttonsCard, pushToUsers, stockLiffUrl } from '../routes/line';
import { getJSTTime, jstNow } from './jst';
import {
  COMPANY_LOC, InvSettings, addDays, buildLoad, businessDate, closingStatus, getSettings, nextOpenDay, openDays,
  perCountSuggestions, reorderAlerts, staleItems,
} from './inventory';
import { toMinutes, weekdayOf } from './venueSchedule';

// 催事の在庫の LINE 通知（担当者だけに送る。5分ごとに見て、同じ通知は二度送らない）
//  1. 閉店から30分たっても締め（残りの数え・レジ締め）がそろっていない会場
//  2. その日の締めがそろったら（遅くとも閉店90分後）、次に開く日の積み込みリスト
//  3. 火曜・金曜の朝8時に「会社の在庫を数える日」
// LINE の無料枠（月200通）を使うので、1回の通知は1通にまとめる。

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${'日月火水木金土'[weekdayOf(d)]}）`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function recipients(companyId: number, s: InvSettings): number[] {
  if (s.notify_user_ids.length) return s.notify_user_ids;
  return (db.prepare(`
    SELECT u.id FROM users u JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    WHERE u.is_active = 1 AND (uc.role = 'admin' OR u.role IN ('admin', 'super_admin'))
  `).all(companyId) as { id: number }[]).map(r => r.id);
}

function once(companyId: number, key: string): boolean {
  const r = db.prepare('INSERT OR IGNORE INTO inv_notices (company_id, key) VALUES (?, ?)').run(companyId, key);
  return r.changes > 0;
}

const storeNames = (companyId: number) =>
  new Map((db.prepare('SELECT id, name FROM stores WHERE company_id = ?').all(companyId) as { id: number; name: string }[]).map(r => [r.id, r.name]));

/** 積み込みリストのカードを作る（届ける日が無い会場は飛ばす） */
export function loadCard(companyId: number, s: InvSettings, today: string) {
  const names = storeNames(companyId);
  const lines: string[] = [];
  for (const id of s.store_ids) {
    const date = nextOpenDay(companyId, id, today);
    if (!date) continue;
    const plan = buildLoad(companyId, id, date);
    const take = plan.lines.filter(l => l.suggested > 0);
    lines.push(`■ ${names.get(id)}　${md(date)}`);
    lines.push(take.length ? take.map(l => `${l.name} ${fmt(l.suggested)}${l.count_unit}${l.capped ? '（上限）' : ''}`).join('、') : '積むものはありません');
    const st = closingStatus(companyId, id, today);
    if (st.diffs.length) lines.push(`差: ${st.diffs.map(d => `${d.name} ${d.diff > 0 ? '+' : ''}${fmt(d.diff)}${d.count_unit}`).join('、')}`);
    const stale = staleItems(companyId, id, today);
    if (stale.length) lines.push(`古い分: ${stale.map(x => `${x.name}（${x.days}日前）`).join('、')}`);
  }
  if (!lines.length) return null;
  const re = reorderAlerts(companyId, today);
  if (re.length) lines.push(`■ 発注の目安: ${re.map(r => `${r.name} 残り${fmt(r.total)}${r.count_unit}（約${fmt(r.days_left)}日分）`).join('、')}`);
  const pc = perCountSuggestions(companyId, today);
  if (pc.length) lines.push(`■ 実績では: ${pc.map(p => `${p.name} 1${p.count_unit}＝${fmt(p.suggested)}${p.use_unit}（今は${fmt(p.current)}）`).join('、')}。画面から直せます`);
  const url = stockLiffUrl(companyId, 'tab=load');
  return buttonsCard('積み込みリスト', '次の積み込み（案）', lines, url ? [{ label: '開いて数を確定する', uri: url, primary: true, color: '#06C755' }] : []);
}

/**
 * 会場の「残りの数え」が入ったら、担当者に知らせる（その日・その会場で最初に保存したときだけ。11/7 芝原「在庫確認ができたか自分のLINEに」）。
 * 入れた人と、記録上の数との差（あれば）を1通にまとめる。
 */
export async function notifyCounted(companyId: number, storeId: number, date: string, byName: string): Promise<void> {
  const s = getSettings(companyId);
  if (!s?.enabled || !s.store_ids.includes(storeId)) return;
  const to = recipients(companyId, s);
  if (!to.length || !once(companyId, `counted:${date}:${storeId}`)) return;
  const st = closingStatus(companyId, storeId, date);
  const lines = [`${md(date)} ${getJSTTime().slice(0, 5)}　${byName || 'スタッフ'}さんが入れました。`];
  lines.push(st.sales_done ? 'レジ締めも済んでいます。' : 'レジ締めはまだです。');
  const small = st.diffs.filter(d => d.review !== 'hold');
  if (small.length) lines.push(`記録との差（反映済み）: ${small.map(d => `${d.name} ${d.diff > 0 ? '+' : ''}${fmt(d.diff)}${d.count_unit}`).join('、')}`);
  const url = stockLiffUrl(companyId);
  // 確認待ちがあれば同じ1通に載せて、確定のボタンを付ける（もう一度は送らない）
  if (st.holds && st.count_id && once(companyId, `holds:${date}:${storeId}`)) {
    lines.push(...holdLines(st));
    await pushToUsers(companyId, to, buttonsCard('在庫の確認待ち', `${storeNames(companyId).get(storeId)}：残りの数えが届きました（確認待ち${st.holds}件）`, lines, holdButtons(st.count_id, url)));
    return;
  }
  await pushToUsers(companyId, to, buttonsCard('在庫確認が届きました', `${storeNames(companyId).get(storeId)}：残りの数えが届きました`, lines, url ? [{ label: '在庫の画面を開く', uri: url }] : []));
}

type St = ReturnType<typeof closingStatus>;
const holdLines = (st: St) => [
  '■ 差が大きいので、まだ在庫に反映していません',
  ...st.diffs.filter(d => d.review === 'hold').map(d => `${d.name}：数えた ${fmt(d.counted)}${d.count_unit}／あるはず ${fmt(d.expected)}（${d.diff > 0 ? '+' : ''}${fmt(d.diff)}）`),
  '本当に減っていたら「この数で確定」、打ち間違いなら「記録の数のまま」。数え直してもらう場合は、保存し直せば自動でもう一度比べます。',
];
const holdButtons = (countId: number, url: string | null) => [
  { label: 'この数で確定', data: `inv=hok&c=${countId}`, primary: true },
  { label: '記録の数のまま', data: `inv=hkeep&c=${countId}` },
  ...(url ? [{ label: '画面で1つずつ見る', uri: url }] : []),
];

/** レジ締めが後から入って確認待ちが出たとき（数えたときの通知にまだ載っていなければ）1通だけ送る */
export async function notifyHolds(companyId: number, storeId: number, date: string): Promise<void> {
  const s = getSettings(companyId);
  if (!s?.enabled || !s.store_ids.includes(storeId)) return;
  const st = closingStatus(companyId, storeId, date);
  if (!st.holds || !st.count_id) return;
  const to = recipients(companyId, s);
  if (!to.length || !once(companyId, `holds:${date}:${storeId}`)) return;
  await pushToUsers(companyId, to, buttonsCard('在庫の確認待ち', `${storeNames(companyId).get(storeId)}：確認待ちが${st.holds}件あります`, [`${md(date)}　数えた人: ${st.counted_by || '—'}さん`, ...holdLines(st)], holdButtons(st.count_id, stockLiffUrl(companyId))));
}

export async function runInventoryNotifier(): Promise<void> {
  const companies = db.prepare('SELECT company_id FROM inv_settings WHERE enabled = 1').all() as { company_id: number }[];
  for (const { company_id: cid } of companies) {
    const s = getSettings(cid);
    if (!s?.store_ids.length) continue;
    const today = businessDate();
    if ((s.active_from && today < s.active_from) || (s.active_to && today > s.active_to)) continue;
    const to = recipients(cid, s);
    if (!to.length) continue;
    let nowMin = toMinutes(getJSTTime());
    if (nowMin < 5 * 60) nowMin += 24 * 60; // 夜中は前の営業日の続き
    const names = storeNames(cid);
    const open = openDays(cid, s.store_ids, today, today);
    const closes = s.store_ids.map(id => ({ id, close: open.get(id)!.get(today) })).filter((x): x is { id: number; close: number } => !!x.close);

    // 1. 締めの抜け
    for (const { id, close } of closes) {
      if (nowMin < close + 30) continue;
      const st = closingStatus(cid, id, today);
      if (st.complete) continue;
      if (!once(cid, `missing:${today}:${id}`)) continue;
      const missing = [!st.counted && '残りの数え', !st.sales_done && 'レジ締め'].filter(Boolean).join('と');
      const url = stockLiffUrl(cid);
      await pushToUsers(cid, to, buttonsCard('締めがまだです', `${names.get(id)}：${missing}がまだです`, [`${md(today)}の閉店から30分たちました。`], url ? [{ label: '在庫の画面を開く', uri: url }] : []));
    }

    // 2. 積み込みリスト
    const allDone = closes.length > 0 && closes.every(c => closingStatus(cid, c.id, today).complete);
    const lastClose = closes.length ? Math.max(...closes.map(c => c.close)) : 20 * 60;
    if ((allDone || nowMin >= lastClose + 90) && once(cid, `load:${today}`)) {
      const card = loadCard(cid, s, today);
      if (card) await pushToUsers(cid, to, card);
    }

    // 3. 会社在庫を数える日（火・金の朝）
    const wd = weekdayOf(jstNow().toISOString().slice(0, 10));
    if ((wd === 2 || wd === 5) && nowMin >= 8 * 60 && nowMin < 12 * 60) {
      const d = jstNow().toISOString().slice(0, 10);
      const anyOpenSoon = [...openDays(cid, s.store_ids, d, addDays(d, 3)).values()].some(m => m.size > 0);
      if (anyOpenSoon && once(cid, `ccount:${d}`)) {
        const url = stockLiffUrl(cid, 'tab=company');
        const done = db.prepare('SELECT 1 FROM inv_counts WHERE company_id = ? AND loc = ? AND date = ?').get(cid, COMPANY_LOC, d);
        if (!done) await pushToUsers(cid, to, buttonsCard('会社在庫を数える日', '今日は会社の在庫を数える日です', ['記録上の数が並んでいるので、実際の数を入れてください。'], url ? [{ label: '数える', uri: url, primary: true, color: '#06C755' }] : []));
      }
    }
  }
}

export function startInventoryNotifier(): void {
  const tick = () => { runInventoryNotifier().catch(e => console.error('[inventory-notify]', e)); };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 5 * 60 * 1000);
}
