import db, { SUPER_ADMIN_EMAIL } from '../db';
import { isMailConfigured, sendMail } from './mailer';
import { shouldNotify } from './ops-alerts';

// 運営者向けの日次ダイジェスト（毎朝 9:00 JST に 1 通）。
//
// 「昨日誰が登録して、どこまで進んで、どこで止まっているか」「未対応のフィードバック」
// 「エラー」を1通にまとめる。管理画面を開かなくても Gmail で状況が分かる状態にするのが目的。

const APP_URL = process.env.APP_URL || 'https://shiftlog-production.up.railway.app';
const DIGEST_HOUR_JST = 9;
const STUCK_DAYS = 2;

export type SetupStep = 'store' | 'staff' | 'shift' | 'publish' | 'timecard' | 'done';

const STEP_LABEL: Record<SetupStep, string> = {
  store: '店舗を作っていない',
  staff: 'スタッフを登録していない',
  shift: 'シフトを作っていない',
  publish: 'シフトを公開していない',
  timecard: '打刻がまだ無い',
  done: '打刻まで到達',
};

export interface CompanyProgress {
  id: number;
  name: string;
  created_at: string;
  acq_source: string | null;
  step: SetupStep;
  stuck_days: number;
  last_seen_at: string | null;
  last_path: string | null;
}

/** 会社ごとの「次にやるべきステップ」と、その手前で止まっている日数 */
export function companyProgress(): CompanyProgress[] {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.created_at, c.acq_source,
      (SELECT COUNT(*) FROM stores s WHERE s.company_id = c.id) AS stores,
      (SELECT COUNT(*) FROM user_companies uc WHERE uc.company_id = c.id AND uc.role = 'staff') AS staff,
      (SELECT COUNT(*) FROM shifts sh WHERE sh.company_id = c.id) AS shifts,
      (SELECT COUNT(*) FROM shift_publications p WHERE p.company_id = c.id AND p.is_published = 1) AS published,
      (SELECT COUNT(*) FROM time_records tr WHERE tr.company_id = c.id) AS timecards,
      (SELECT MAX(created_at) FROM usage_events ue WHERE ue.company_id = c.id) AS last_seen_at,
      (SELECT path FROM usage_events ue WHERE ue.company_id = c.id AND ue.event = 'page_view' ORDER BY id DESC LIMIT 1) AS last_path,
      COALESCE((SELECT MAX(created_at) FROM stores s WHERE s.company_id = c.id), c.created_at) AS store_at,
      COALESCE((SELECT MAX(uc.created_at) FROM user_companies uc WHERE uc.company_id = c.id AND uc.role = 'staff'), c.created_at) AS staff_at,
      COALESCE((SELECT MAX(created_at) FROM shifts sh WHERE sh.company_id = c.id), c.created_at) AS shift_at,
      COALESCE((SELECT MAX(published_at) FROM shift_publications p WHERE p.company_id = c.id AND p.is_published = 1), c.created_at) AS publish_at
    FROM companies c
    ORDER BY c.created_at DESC
  `).all() as any[];

  const days = (iso: string) => Math.floor((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 86400000);

  return rows.map(r => {
    let step: SetupStep; let since: string;
    if (r.stores === 0) { step = 'store'; since = r.created_at; }
    else if (r.staff === 0) { step = 'staff'; since = r.store_at; }
    else if (r.shifts === 0) { step = 'shift'; since = r.staff_at; }
    else if (r.published === 0) { step = 'publish'; since = r.shift_at; }
    else if (r.timecards === 0) { step = 'timecard'; since = r.publish_at; }
    else { step = 'done'; since = r.created_at; }
    return {
      id: r.id, name: r.name, created_at: r.created_at, acq_source: r.acq_source,
      step, stuck_days: step === 'done' ? 0 : Math.max(0, days(since)),
      last_seen_at: r.last_seen_at, last_path: r.last_path,
    };
  });
}

export function buildDigest(): { subject: string; text: string } {
  const since24h = "datetime('now', '-1 day')";
  const newCompanies = db.prepare(`
    SELECT c.name, c.acq_source, u.name AS admin_name FROM companies c
    LEFT JOIN user_companies uc ON uc.company_id = c.id AND uc.role = 'admin'
    LEFT JOIN users u ON u.id = uc.user_id
    WHERE c.created_at >= ${since24h} GROUP BY c.id ORDER BY c.created_at DESC
  `).all() as { name: string; acq_source: string | null; admin_name: string | null }[];

  const progress = companyProgress();
  const stuck = progress.filter(p => p.step !== 'done' && p.stuck_days >= STUCK_DAYS).slice(0, 15);
  const stepCounts = progress.reduce<Record<string, number>>((acc, p) => { acc[p.step] = (acc[p.step] || 0) + 1; return acc; }, {});

  const activeCompanies = (db.prepare(`SELECT COUNT(DISTINCT company_id) AS c FROM usage_events WHERE company_id IS NOT NULL AND created_at >= ${since24h}`).get() as any).c;
  const pageViews = (db.prepare(`SELECT COUNT(*) AS c FROM usage_events WHERE event = 'page_view' AND created_at >= ${since24h}`).get() as any).c;
  const topPaths = db.prepare(`SELECT path, COUNT(*) AS c FROM usage_events WHERE event = 'page_view' AND created_at >= ${since24h} AND path IS NOT NULL GROUP BY path ORDER BY c DESC LIMIT 5`).all() as { path: string; c: number }[];
  const clicks = db.prepare(`SELECT code, COUNT(*) AS c FROM tracking_clicks WHERE created_at >= ${since24h} GROUP BY code ORDER BY c DESC`).all() as { code: string; c: number }[];

  const openFeedback = db.prepare(`SELECT f.category, f.message, u.name FROM feedbacks f LEFT JOIN users u ON u.id = f.user_id WHERE f.status = 'open' ORDER BY f.created_at DESC LIMIT 5`).all() as { category: string; message: string; name: string | null }[];
  const openFeedbackCount = (db.prepare("SELECT COUNT(*) AS c FROM feedbacks WHERE status = 'open'").get() as any).c;

  const errors = db.prepare(`SELECT fingerprint, platform, message, COUNT(*) AS c FROM client_errors WHERE created_at >= ${since24h} GROUP BY fingerprint ORDER BY c DESC LIMIT 5`).all() as { fingerprint: string; platform: string; message: string; c: number }[];
  const errorCount = (db.prepare(`SELECT COUNT(*) AS c FROM client_errors WHERE created_at >= ${since24h}`).get() as any).c;

  const upgrades = db.prepare(`SELECT c.name, s.platform FROM subscriptions s JOIN companies c ON c.id = s.company_id WHERE s.plan = 'pro' AND s.updated_at >= ${since24h}`).all() as { name: string; platform: string }[];
  const proTotal = (db.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE plan = 'pro' AND status != 'canceled'").get() as any).c;

  const jstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`シフトログ 日次レポート（${jstDate} 9:00 JST）`, '');

  lines.push(`■ 新規登録（24時間）: ${newCompanies.length}件`);
  for (const c of newCompanies) lines.push(`  ・${c.name}（${c.admin_name || '-'}）流入元: ${c.acq_source || '不明'}`);
  lines.push('');

  lines.push(`■ 有料契約: 累計 ${proTotal}件${upgrades.length ? `（24時間で +${upgrades.length}: ${upgrades.map(u => `${u.name}/${u.platform}`).join(', ')}）` : ''}`);
  lines.push('');

  lines.push(`■ どこまで進んだか（全 ${progress.length} 社）`);
  for (const step of ['store', 'staff', 'shift', 'publish', 'timecard', 'done'] as SetupStep[]) {
    if (stepCounts[step]) lines.push(`  ${STEP_LABEL[step]}: ${stepCounts[step]}社`);
  }
  lines.push('');

  lines.push(`■ 止まっている会社（${STUCK_DAYS}日以上同じステップ）: ${stuck.length}件`);
  for (const p of stuck) {
    lines.push(`  ・${p.name}: ${STEP_LABEL[p.step]}（${p.stuck_days}日）最後に見た画面: ${p.last_path || '-'}${p.last_seen_at ? ` @${p.last_seen_at.slice(5, 16)}` : ''}`);
  }
  if (!stuck.length) lines.push('  （なし）');
  lines.push('');

  lines.push(`■ 利用（24時間）: ${activeCompanies}社が利用、画面表示 ${pageViews}回`);
  for (const p of topPaths) lines.push(`  ${p.path}: ${p.c}`);
  if (clicks.length) lines.push(`  流入リンク: ${clicks.map(c => `${c.code}=${c.c}`).join(', ')}`);
  lines.push('');

  lines.push(`■ 未対応のフィードバック: ${openFeedbackCount}件`);
  for (const f of openFeedback) lines.push(`  ・[${f.category}] ${f.name || '-'}: ${f.message.replace(/\s+/g, ' ').slice(0, 80)}`);
  lines.push('');

  lines.push(`■ エラー（24時間）: ${errorCount}件`);
  for (const e of errors) lines.push(`  ・${e.platform} ×${e.c}: ${e.message.slice(0, 90)}`);
  lines.push('');

  lines.push(`管理画面: ${APP_URL}/admin-hub`);
  return { subject: `【シフトログ】日次レポート ${jstDate}：登録${newCompanies.length}件・停滞${stuck.length}社・FB未対応${openFeedbackCount}件・エラー${errorCount}件`, text: lines.join('\n') };
}

export async function runDailyDigest(force = false): Promise<boolean> {
  if (!isMailConfigured()) return false;
  const jstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (!force && !shouldNotify(`digest:${jstDate}`)) return false;
  const { subject, text } = buildDigest();
  const ok = await sendMail(SUPER_ADMIN_EMAIL, subject, text);
  console.log(`[daily-digest] ${ok ? '送信' : '送信失敗'} ${jstDate}`);
  return ok;
}

/** 毎時チェックし、JST 9時台に一度だけ送る */
export function startDailyDigest(): void {
  const tick = () => {
    const jstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
    if (jstHour === DIGEST_HOUR_JST) runDailyDigest().catch(e => console.error('[daily-digest]', e));
  };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 30 * 60 * 1000);
}
