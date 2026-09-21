import db, { SUPER_ADMIN_EMAIL } from '../db';
import { companyProgress, SetupStep } from './daily-digest';

// お客様ジャーニー（運営者専用）。
//
// 1社ごとに「どこから入って → いつ各ステップに到達して → どこで止まって → いつから来ていないか」を
// 1枚で追えるようにする。データは次の2系統を突き合わせる。
//   - 業務データ（stores / user_companies / shifts / shift_publications / time_records / subscriptions）
//     … 実際に「やったこと」の確定値
//   - usage_events（画面遷移・操作）… 「見たけどやらなかった」「どこで離れた」を知るための値
//
// 時刻はすべて SQLite の UTC（'YYYY-MM-DD HH:MM:SS'）のまま返し、表示側で JST にする。

const DAY_MS = 86400000;
const ACTIVITY_DAYS = 14;

export type JourneyStatus = 'internal' | 'onboarding' | 'stuck' | 'active' | 'at_risk' | 'churned';

export interface Milestone { key: string; label: string; at: string | null }

export interface CompanyJourney {
  id: number;
  name: string;
  created_at: string;
  internal: boolean;
  admin: { name: string | null; email: string | null };
  plan: string;
  // 登録から30日の Pro 無料体験。null = 体験なし／終了
  trial_days_left: number | null;
  entry: {
    source: string | null; medium: string | null; campaign: string | null;
    landing_path: string | null; referrer: string | null;
    platform: string | null;
    // 登録したセッションで、登録前に見た画面（LP → ログイン画面 …）
    pre_signup_paths: string[];
    first_seen_at: string | null;
  };
  milestones: Milestone[];
  step: SetupStep;
  stuck_days: number;
  status: JourneyStatus;
  status_reason: string;
  last_seen_at: string | null;
  last_path: string | null;
  last_actor: string | null;
  days_since_seen: number | null;
  staff: { total: number; used_7d: number; punched_7d: number };
  counts: { punches_7d: number; punches_total: number; shifts_upcoming: number; sessions_7d: number; api_errors_7d: number; feedback_open: number };
  onboarding: { last_step: string | null; exit: string | null };
  // 直近14日の日別の動き（古い順）。admin=管理者の画面表示、staff=スタッフの画面表示、punch=打刻件数
  activity: { date: string; admin: number; staff: number; punch: number }[];
  next_action: string;
}

const toMs = (s: string | null | undefined) => (s ? new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')).getTime() : 0);
const daysAgo = (s: string | null | undefined) => (s ? Math.floor((Date.now() - toMs(s)) / DAY_MS) : null);
const jstDate = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

function isInternal(adminEmails: string[], name: string): boolean {
  return adminEmails.some(e => e === SUPER_ADMIN_EMAIL || /^appreview\+/.test(e) || /@shiftlog\.app$/.test(e))
    || name === 'シフトログ デモ店舗';
}

function nextAction(j: Omit<CompanyJourney, 'next_action'>): string {
  if (j.internal) return '社内・審査用（集計から除外）';
  if (j.status === 'churned') return `${j.days_since_seen}日来ていない。電話かLINEで「止まった理由」を聞く（${STEP_HINT[j.step]}）`;
  if (j.status === 'at_risk') {
    if (j.step === 'done' && j.staff.punched_7d === 0) return 'スタッフの打刻が止まった。タイムレコーダー端末の置き場所・ログイン状態を確認';
    return `利用が落ちている。${STEP_HINT[j.step]}`;
  }
  if (j.status === 'stuck') return STEP_HINT[j.step];
  if (j.status === 'onboarding') return `立ち上げ中。${STEP_HINT[j.step]}`;
  if (j.plan !== 'pro' && j.trial_days_left !== null && j.trial_days_left <= 7) {
    return `定着・無料体験の残り${j.trial_days_left}日。${j.staff.total > 5 ? `スタッフ${j.staff.total}人で無料枠(5人)を超える → 体験終了前にPro（年払い¥9,800）を案内` : '終了後も5人までは無料で使える旨と、Proで増える機能を案内'}`;
  }
  if (j.staff.total > 0 && j.staff.used_7d < j.staff.total / 2) return `定着。未使用のスタッフが${j.staff.total - j.staff.used_7d}人いる → 招待QRの再共有を案内`;
  if (j.plan !== 'pro' && j.staff.total >= 5) return '定着・無料枠上限。Pro（年払い¥9,800）の提案タイミング';
  return '定着。月1回の声かけで十分';
}

const STEP_HINT: Record<SetupStep, string> = {
  store: '店舗登録で止まっている → 店舗名だけで作れることを伝える',
  staff: 'スタッフ登録で止まっている → 名前だけ一括入力 or 代行入力を申し出る',
  shift: 'シフト作成で止まっている → テンプレ／前月コピーを一緒にやる',
  publish: 'シフトを作ったが未公開 → 「公開」でスタッフに届くことを伝える',
  timecard: '打刻がまだ無い → 店のタブレットでタイムレコーダーを開いてもらう',
  done: '打刻まで到達済み',
};

export function customerJourneys(): CompanyJourney[] {
  const progress = new Map(companyProgress().map(p => [p.id, p]));
  const companies = db.prepare(`
    SELECT c.*, COALESCE(s.plan, 'free') AS plan, s.updated_at AS plan_updated_at, s.trial_ends_at
    FROM companies c LEFT JOIN subscriptions s ON s.company_id = c.id
    ORDER BY c.created_at DESC
  `).all() as any[];

  const adminsStmt = db.prepare(`
    SELECT u.name, u.email FROM user_companies uc JOIN users u ON u.id = uc.user_id
    WHERE uc.company_id = ? AND uc.role IN ('admin', 'owner') ORDER BY uc.id
  `);
  const firstAt = {
    store: db.prepare('SELECT MIN(created_at) AS t FROM stores WHERE company_id = ?'),
    staff: db.prepare("SELECT MIN(created_at) AS t FROM user_companies WHERE company_id = ? AND role = 'staff'"),
    shift: db.prepare('SELECT MIN(created_at) AS t FROM shifts WHERE company_id = ?'),
    publish: db.prepare('SELECT MIN(published_at) AS t FROM shift_publications WHERE company_id = ? AND is_published = 1'),
    punch: db.prepare('SELECT MIN(created_at) AS t FROM time_records WHERE company_id = ?'),
    staffPunch: db.prepare(`
      SELECT MIN(tr.created_at) AS t FROM time_records tr
      JOIN user_companies uc ON uc.user_id = tr.user_id AND uc.company_id = tr.company_id
      WHERE tr.company_id = ? AND uc.role = 'staff'`),
  };
  const staffStmt = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(EXISTS(SELECT 1 FROM usage_events ue WHERE ue.user_id = uc.user_id AND ue.company_id = uc.company_id AND ue.created_at >= datetime('now','-7 days'))
       OR EXISTS(SELECT 1 FROM time_records tr WHERE tr.user_id = uc.user_id AND tr.company_id = uc.company_id AND tr.created_at >= datetime('now','-7 days'))) AS used_7d,
      SUM(EXISTS(SELECT 1 FROM time_records tr WHERE tr.user_id = uc.user_id AND tr.company_id = uc.company_id AND tr.created_at >= datetime('now','-7 days'))) AS punched_7d
    FROM user_companies uc WHERE uc.company_id = ? AND uc.role = 'staff'
  `);
  const countsStmt = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM time_records WHERE company_id = @id AND created_at >= datetime('now','-7 days')) AS punches_7d,
      (SELECT COUNT(*) FROM time_records WHERE company_id = @id) AS punches_total,
      (SELECT COUNT(*) FROM shifts WHERE company_id = @id AND date >= @today) AS shifts_upcoming,
      (SELECT COUNT(DISTINCT session_id) FROM usage_events WHERE company_id = @id AND created_at >= datetime('now','-7 days')) AS sessions_7d,
      (SELECT COUNT(*) FROM usage_events WHERE company_id = @id AND event = 'api_error' AND created_at >= datetime('now','-7 days')) AS api_errors_7d,
      (SELECT COUNT(*) FROM feedbacks WHERE company_id = @id AND status = 'open') AS feedback_open
  `);
  const lastSeenStmt = db.prepare(`
    SELECT ue.created_at, ue.path, u.name AS actor, uc.role
    FROM usage_events ue LEFT JOIN users u ON u.id = ue.user_id
    LEFT JOIN user_companies uc ON uc.user_id = ue.user_id AND uc.company_id = ue.company_id
    WHERE ue.company_id = ? ORDER BY ue.id DESC LIMIT 1
  `);
  const lastPunchStmt = db.prepare('SELECT MAX(updated_at) AS t FROM time_records WHERE company_id = ?');
  // 会社に紐づいた最初のセッション（＝登録したセッション）と、そのセッションの登録前の足取り
  const firstSessionStmt = db.prepare(`
    SELECT session_id, platform, created_at FROM usage_events
    WHERE company_id = ? AND session_id IS NOT NULL ORDER BY id ASC LIMIT 1
  `);
  const sessionPathsStmt = db.prepare(`
    SELECT path, created_at FROM usage_events WHERE session_id = ? AND event = 'page_view' AND company_id IS NULL ORDER BY id ASC LIMIT 20
  `);
  const sessionStartStmt = db.prepare('SELECT MIN(created_at) AS t FROM usage_events WHERE session_id = ?');
  const onboardingStmt = db.prepare(`
    SELECT event, meta FROM usage_events WHERE company_id = ? AND event IN ('onboarding_view', 'onboarding_exit') ORDER BY id DESC LIMIT 20
  `);
  const dailyViews = db.prepare(`
    SELECT date(ue.created_at, '+9 hours') AS d,
      SUM(CASE WHEN COALESCE(uc.role, 'admin') = 'staff' THEN 0 ELSE 1 END) AS admin,
      SUM(CASE WHEN uc.role = 'staff' THEN 1 ELSE 0 END) AS staff
    FROM usage_events ue LEFT JOIN user_companies uc ON uc.user_id = ue.user_id AND uc.company_id = ue.company_id
    WHERE ue.company_id = ? AND ue.event = 'page_view' AND ue.created_at >= datetime('now', '-${ACTIVITY_DAYS} days')
    GROUP BY d
  `);
  const dailyPunch = db.prepare(`
    SELECT date(created_at, '+9 hours') AS d, COUNT(*) AS n FROM time_records
    WHERE company_id = ? AND created_at >= datetime('now', '-${ACTIVITY_DAYS} days') GROUP BY d
  `);

  const today = jstDate(Date.now());
  const days: string[] = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) days.push(jstDate(Date.now() - i * DAY_MS));

  return companies.map(c => {
    const admins = adminsStmt.all(c.id) as { name: string; email: string | null }[];
    const internal = isInternal(admins.map(a => (a.email || '').toLowerCase()), c.name);
    const p = progress.get(c.id)!;

    const at = (k: keyof typeof firstAt) => ((firstAt[k].get(c.id) as any)?.t as string | null) || null;
    const milestones: Milestone[] = [
      { key: 'register', label: '登録', at: c.created_at },
      { key: 'store', label: '店舗作成', at: at('store') },
      { key: 'staff', label: 'スタッフ登録', at: at('staff') },
      { key: 'shift', label: 'シフト作成', at: at('shift') },
      { key: 'publish', label: 'シフト公開', at: at('publish') },
      { key: 'punch', label: '初打刻', at: at('punch') },
      { key: 'staff_punch', label: 'スタッフ本人の打刻', at: at('staffPunch') },
      { key: 'pro', label: 'Pro契約', at: c.plan === 'pro' ? c.plan_updated_at : null },
    ];

    const staff = staffStmt.get(c.id) as any;
    const counts = countsStmt.get({ id: c.id, today }) as any;
    const last = lastSeenStmt.get(c.id) as any;
    const lastPunch = (lastPunchStmt.get(c.id) as any)?.t as string | null;
    // 最終接触 = 画面を見た / 打刻した のうち新しい方
    const lastSeenAt = [last?.created_at, lastPunch].filter(Boolean).sort().pop() || null;
    const daysSinceSeen = daysAgo(lastSeenAt || c.created_at);

    const first = firstSessionStmt.get(c.id) as any;
    const prePaths = first ? (sessionPathsStmt.all(first.session_id) as any[]).map(r => r.path).filter(Boolean) : [];
    const firstSeen = first ? ((sessionStartStmt.get(first.session_id) as any)?.t || first.created_at) : null;

    const ob = onboardingStmt.all(c.id) as { event: string; meta: string | null }[];
    const parseStep = (m: string | null) => { try { return m ? JSON.parse(m).step || null : null; } catch { return null; } };
    const exit = ob.find(e => e.event === 'onboarding_exit');
    const onboarding = {
      last_step: parseStep(ob.find(e => e.event === 'onboarding_view')?.meta ?? null),
      exit: exit ? (() => { try { const m = JSON.parse(exit.meta || '{}'); return `${m.step}で${m.via === 'complete' ? '完了' : 'スキップ'}`; } catch { return null; } })() : null,
    };

    const views = new Map((dailyViews.all(c.id) as any[]).map(r => [r.d, r]));
    const punches = new Map((dailyPunch.all(c.id) as any[]).map(r => [r.d, r.n]));
    const activity = days.map(d => ({ date: d, admin: views.get(d)?.admin || 0, staff: views.get(d)?.staff || 0, punch: punches.get(d) || 0 }));

    const age = daysAgo(c.created_at) ?? 0;
    let status: JourneyStatus; let reason: string;
    if (internal) { status = 'internal'; reason = '社内・審査用'; }
    else if ((daysSinceSeen ?? 0) >= 14) { status = 'churned'; reason = `${daysSinceSeen}日間 画面表示も打刻もない`; }
    else if ((daysSinceSeen ?? 0) >= 7) { status = 'at_risk'; reason = `${daysSinceSeen}日間 動きがない`; }
    else if (p.step === 'done' && counts.punches_7d === 0) { status = 'at_risk'; reason = '管理者は来ているが、直近7日の打刻が0件'; }
    else if (p.step !== 'done' && p.stuck_days >= 2) { status = 'stuck'; reason = `「${STEP_LABEL[p.step]}」の手前で${p.stuck_days}日`; }
    else if (p.step !== 'done' && age < 7) { status = 'onboarding'; reason = `登録${age}日目・次は${STEP_LABEL[p.step]}`; }
    else if (p.step !== 'done') { status = 'stuck'; reason = `「${STEP_LABEL[p.step]}」まで進んでいない`; }
    else { status = 'active'; reason = `直近7日の打刻 ${counts.punches_7d}件`; }

    const base = {
      id: c.id, name: c.name, created_at: c.created_at, internal,
      admin: { name: admins[0]?.name ?? null, email: admins[0]?.email ?? null },
      plan: c.plan,
      trial_days_left: c.trial_ends_at && toMs(c.trial_ends_at) > Date.now() ? Math.ceil((toMs(c.trial_ends_at) - Date.now()) / DAY_MS) : null,
      entry: {
        source: c.acq_source || null, medium: c.acq_medium || null, campaign: c.acq_campaign || null,
        landing_path: c.acq_landing_path || null, referrer: c.acq_referrer || null,
        platform: first?.platform || null, pre_signup_paths: prePaths, first_seen_at: firstSeen,
      },
      milestones, step: p.step, stuck_days: p.stuck_days, status, status_reason: reason,
      last_seen_at: lastSeenAt, last_path: last?.path || null,
      last_actor: last ? `${last.actor || '未ログイン'}${last.role === 'staff' ? '（スタッフ）' : ''}` : null,
      days_since_seen: daysSinceSeen,
      staff: { total: staff?.total || 0, used_7d: staff?.used_7d || 0, punched_7d: staff?.punched_7d || 0 },
      counts, onboarding, activity,
    };
    return { ...base, next_action: nextAction(base) };
  });
}

const STEP_LABEL: Record<SetupStep, string> = {
  store: '店舗作成', staff: 'スタッフ登録', shift: 'シフト作成', publish: 'シフト公開', timecard: '初打刻', done: '運用',
};

// ---------------------------------------------------------------------------
// 1社のタイムライン（セッション単位の足取り＋業務上の出来事）
// ---------------------------------------------------------------------------

export interface TimelineSession {
  kind: 'session';
  at: string; end: string; minutes: number;
  actor: string; role: string | null; platform: string;
  paths: string[];
  actions: { event: string; path: string | null; meta: any; at: string }[];
}
export interface TimelineFact { kind: 'fact'; at: string; label: string; detail?: string; tone?: 'good' | 'bad' | 'info' }

export function companyTimeline(companyId: number, limitDays = 60): (TimelineSession | TimelineFact)[] {
  const since = `datetime('now', '-${Math.max(1, Math.min(365, limitDays))} days')`;
  const sessionIds = (db.prepare(`
    SELECT DISTINCT session_id FROM usage_events WHERE company_id = ? AND session_id IS NOT NULL AND created_at >= ${since}
  `).all(companyId) as { session_id: string }[]).map(r => r.session_id);

  const evStmt = db.prepare(`
    SELECT ue.event, ue.path, ue.meta, ue.platform, ue.created_at, ue.user_id, u.name AS actor, uc.role
    FROM usage_events ue LEFT JOIN users u ON u.id = ue.user_id
    LEFT JOIN user_companies uc ON uc.user_id = ue.user_id AND uc.company_id = ?
    WHERE ue.session_id = ? ORDER BY ue.id ASC LIMIT 500
  `);
  const items: (TimelineSession | TimelineFact)[] = [];
  for (const sid of sessionIds) {
    const evs = evStmt.all(companyId, sid) as any[];
    if (!evs.length) continue;
    const paths: string[] = [];
    for (const e of evs) if (e.event === 'page_view' && e.path && paths[paths.length - 1] !== e.path) paths.push(e.path);
    const who = evs.find(e => e.actor) || evs[0];
    const start = evs[0].created_at, end = evs[evs.length - 1].created_at;
    items.push({
      kind: 'session', at: start, end,
      minutes: Math.max(0, Math.round((toMs(end) - toMs(start)) / 60000)),
      actor: who.actor || '未ログイン', role: who.role || null, platform: evs[0].platform,
      paths,
      actions: evs.filter(e => e.event !== 'page_view').map(e => {
        let meta: any = null; try { meta = e.meta ? JSON.parse(e.meta) : null; } catch { meta = e.meta; }
        return { event: e.event, path: e.path, meta, at: e.created_at };
      }),
    });
  }

  const facts = (sql: string, map: (r: any) => TimelineFact) => (db.prepare(sql).all(companyId) as any[]).forEach(r => items.push(map(r)));
  facts(`SELECT created_at, name FROM companies WHERE id = ?`, r => ({ kind: 'fact', at: r.created_at, label: '会社を登録', detail: r.name, tone: 'good' }));
  facts(`SELECT created_at, name FROM stores WHERE company_id = ?`, r => ({ kind: 'fact', at: r.created_at, label: '店舗を作成', detail: r.name, tone: 'good' }));
  facts(`SELECT MIN(uc.created_at) AS created_at, COUNT(*) AS n, GROUP_CONCAT(u.name, '・') AS names
         FROM user_companies uc JOIN users u ON u.id = uc.user_id WHERE uc.company_id = ? AND uc.role = 'staff'
         GROUP BY date(uc.created_at, '+9 hours')`,
    r => ({ kind: 'fact', at: r.created_at, label: `スタッフを${r.n}人登録`, detail: String(r.names || '').slice(0, 80), tone: 'good' }));
  facts(`SELECT MIN(created_at) AS created_at, COUNT(*) AS n, MIN(date) AS d1, MAX(date) AS d2 FROM shifts
         WHERE company_id = ? GROUP BY date(created_at, '+9 hours')`,
    r => ({ kind: 'fact', at: r.created_at, label: `シフトを${r.n}件作成`, detail: `${r.d1}〜${r.d2}分`, tone: 'good' }));
  facts(`SELECT published_at AS created_at, year, month FROM shift_publications WHERE company_id = ? AND is_published = 1 AND published_at IS NOT NULL`,
    r => ({ kind: 'fact', at: r.created_at, label: `${r.year}年${r.month}月のシフトを公開`, tone: 'good' }));
  facts(`SELECT MIN(tr.created_at) AS created_at, COUNT(*) AS n, COUNT(DISTINCT tr.user_id) AS people FROM time_records tr
         WHERE tr.company_id = ? GROUP BY tr.date`,
    r => ({ kind: 'fact', at: r.created_at, label: `打刻 ${r.n}件`, detail: `${r.people}人`, tone: 'info' }));
  facts(`SELECT created_at, category, message FROM feedbacks WHERE company_id = ?`,
    r => ({ kind: 'fact', at: r.created_at, label: `フィードバック（${r.category}）`, detail: String(r.message).slice(0, 140), tone: 'bad' }));
  facts(`SELECT created_at, platform, message FROM client_errors WHERE company_id = ?`,
    r => ({ kind: 'fact', at: r.created_at, label: `エラー（${r.platform}）`, detail: String(r.message).slice(0, 140), tone: 'bad' }));
  facts(`SELECT updated_at AS created_at, plan, platform FROM subscriptions WHERE company_id = ? AND plan = 'pro'`,
    r => ({ kind: 'fact', at: r.created_at, label: 'Pro 契約', detail: r.platform, tone: 'good' }));

  const cutoff = Date.now() - limitDays * DAY_MS;
  return items.filter(i => toMs(i.at) >= cutoff || i.kind === 'fact').sort((a, b) => toMs(b.at) - toMs(a.at));
}

// ---------------------------------------------------------------------------
// 登録前のファネル（LP に来た人がどこで離れたか）
// ---------------------------------------------------------------------------

export function signupFunnel(days = 30) {
  const since = `datetime('now', '-${Math.max(1, Math.min(365, days))} days')`;
  // セッション単位で「どこまで来たか」を1行にする
  const rows = db.prepare(`
    SELECT session_id,
      MAX(platform) AS platform,
      MAX(CASE WHEN event = 'page_view' AND path = '/' THEN 1 ELSE 0 END) AS lp,
      MAX(CASE WHEN event = 'cta_click' THEN 1 ELSE 0 END) AS cta,
      MAX(CASE WHEN event = 'page_view' AND path = '/login' THEN 1 ELSE 0 END) AS login,
      MAX(CASE WHEN event = 'register_start' THEN 1 ELSE 0 END) AS reg_start,
      MAX(CASE WHEN event = 'register_complete' THEN 1 ELSE 0 END) AS reg_done,
      MAX(CASE WHEN company_id IS NOT NULL THEN 1 ELSE 0 END) AS known
    FROM usage_events WHERE session_id IS NOT NULL AND created_at >= ${since}
    GROUP BY session_id
  `).all() as any[];
  // 既存ユーザーのログインは除外して「新規の見込み客」だけ数える
  const prospects = rows.filter(r => r.reg_done || !r.known);
  const sum = (k: string) => prospects.filter(r => r[k]).length;
  const steps = [
    { key: 'visit', label: '訪問（セッション）', n: prospects.length },
    { key: 'lp', label: 'LPを表示', n: sum('lp') },
    { key: 'login', label: '登録/ログイン画面', n: sum('login') },
    { key: 'reg_start', label: '登録フォームを開いた', n: sum('reg_start') },
    { key: 'reg_done', label: '登録完了', n: sum('reg_done') },
  ];
  // LP のボタンを経由せず /login に直接来る人もいるので、ボタンは段に入れず別枠で数える
  // 登録しなかったセッションの「最後に見た画面」
  const exits = db.prepare(`
    SELECT last_path AS path, COUNT(*) AS n FROM (
      SELECT session_id, (SELECT path FROM usage_events x WHERE x.session_id = ue.session_id AND x.event = 'page_view' ORDER BY x.id DESC LIMIT 1) AS last_path
      FROM usage_events ue WHERE session_id IS NOT NULL AND created_at >= ${since}
      GROUP BY session_id
      HAVING MAX(company_id) IS NULL AND MAX(CASE WHEN event = 'register_complete' THEN 1 ELSE 0 END) = 0
    ) GROUP BY last_path ORDER BY n DESC LIMIT 8
  `).all();
  const ctas = db.prepare(`
    SELECT json_extract(meta, '$.label') AS label, json_extract(meta, '$.location') AS location, COUNT(*) AS n
    FROM usage_events WHERE event = 'cta_click' AND created_at >= ${since} GROUP BY label, location ORDER BY n DESC LIMIT 8
  `).all();
  const sources = db.prepare(`
    SELECT COALESCE(NULLIF(acq_source, ''), '不明') AS source, COUNT(*) AS n FROM companies
    WHERE created_at >= ${since} GROUP BY source ORDER BY n DESC
  `).all();
  const clicks = db.prepare(`SELECT code, COUNT(*) AS n FROM tracking_clicks WHERE created_at >= ${since} GROUP BY code ORDER BY n DESC`).all();
  return { days, steps, exits, ctas, sources, clicks };
}
