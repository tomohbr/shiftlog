import db from '../db';
import { buttonsCard, pushToUsers, stockLiffUrl } from '../routes/line';
import { getJSTTime, jstNow } from './jst';
import {
  COMPANY_LOC, InvSettings, addDays, buildLoad, businessDate, closingStatus, getSettings, nextOpenDay, openDays,
  reorderAlerts, staleItems,
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
  const url = stockLiffUrl(companyId, 'tab=load');
  return buttonsCard('積み込みリスト', '次の積み込み（案）', lines, url ? [{ label: '開いて数を確定する', uri: url, primary: true, color: '#06C755' }] : []);
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
