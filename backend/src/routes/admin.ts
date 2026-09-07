import { Router, Response } from 'express';
import db, { SUPER_ADMIN_EMAIL } from '../db';
import { authenticateToken, requireSuperAdmin, AuthRequest } from '../middleware/auth';
import { sendMailWithResult } from '../utils/mailer';
import { trackingLinks } from '../data/tracking-links';
import { runTrialNotifications } from '../utils/trial-notify';
import { buildDigest, companyProgress, runDailyDigest } from '../utils/daily-digest';

const router = Router();

// すべての管理APIは super_admin 限定
router.use(authenticateToken, requireSuperAdmin);

// GET /api/admin/users - 登録済みユーザー一覧（利用状況付き）
router.get('/users', (_req: AuthRequest, res: Response): void => {
  const users = db.prepare(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      u.is_active,
      u.created_at,
      u.updated_at,
      (SELECT MAX(tr.updated_at) FROM time_records tr WHERE tr.user_id = u.id) AS last_timecard_at,
      (SELECT COUNT(*) FROM user_companies uc WHERE uc.user_id = u.id) AS company_count
    FROM users u
    ORDER BY u.created_at DESC
  `).all() as any[];

  const companyStmt = db.prepare(`
    -- 登録時の流入元を会社ごとに返す。
    SELECT c.id, c.name, c.acq_source, uc.role
    FROM user_companies uc
    JOIN companies c ON uc.company_id = c.id
    WHERE uc.user_id = ?
  `);

  // 「現在使われているか」判定: is_active=1 かつ (直近30日以内に打刻 OR 会社所属あり)
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const result = users.map(u => {
    const companies = companyStmt.all(u.id);
    const lastActivityRaw = u.last_timecard_at || u.updated_at;
    const lastActivityMs = lastActivityRaw ? new Date(lastActivityRaw).getTime() : 0;
    const recentlyActive = lastActivityMs > 0 && (now - lastActivityMs) < THIRTY_DAYS_MS;
    const inUse = u.is_active === 1 && (recentlyActive || u.company_count > 0);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      is_active: u.is_active === 1,
      created_at: u.created_at,
      last_activity: lastActivityRaw,
      recently_active: recentlyActive,
      in_use: inUse,
      company_count: u.company_count,
      companies,
    };
  });

  res.json({ users: result });
});

// GET /api/admin/stats - サマリー統計
router.get('/stats', (_req: AuthRequest, res: Response): void => {
  const totalUsers = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as any).c;
  const activeUsers = (db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_active = 1').get() as any).c;
  const totalCompanies = (db.prepare('SELECT COUNT(*) AS c FROM companies').get() as any).c;
  const adminUsers = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role IN ('admin','super_admin')").get() as any).c;
  res.json({ totalUsers, activeUsers, totalCompanies, adminUsers });
});

// GET /api/admin/companies - 会社別の利用状況詳細
router.get('/companies', (_req: AuthRequest, res: Response): void => {
  const rows = db.prepare(`
    SELECT
      c.id, c.name, c.acq_source, c.company_pin, c.created_at,
      (SELECT COUNT(*) FROM user_companies uc WHERE uc.company_id = c.id) AS user_count,
      (SELECT COUNT(*) FROM stores s WHERE s.company_id = c.id) AS store_count,
      (SELECT COUNT(*) FROM shifts sh WHERE sh.company_id = c.id) AS shift_count,
      (SELECT COUNT(*) FROM time_records tr WHERE tr.company_id = c.id) AS timecard_count,
      (SELECT MAX(tr.updated_at) FROM time_records tr WHERE tr.company_id = c.id) AS last_timecard_at,
      (SELECT MAX(sh.created_at) FROM shifts sh WHERE sh.company_id = c.id) AS last_shift_at,
      (SELECT COUNT(*) FROM shifts sh WHERE sh.company_id = c.id AND sh.date >= date('now','-7 days')) AS shifts_last_7d,
      (SELECT COUNT(*) FROM time_records tr WHERE tr.company_id = c.id AND tr.created_at >= datetime('now','-7 days')) AS clockins_last_7d,
      (SELECT s.plan FROM subscriptions s WHERE s.company_id = c.id) AS plan
    FROM companies c
    ORDER BY c.created_at DESC
  `).all();
  res.json({ companies: rows });
});

// GET /api/admin/activation-funnel - 利用定着ファネル
router.get('/activation-funnel', (_req: AuthRequest, res: Response): void => {
  const total = (db.prepare('SELECT COUNT(*) AS c FROM companies').get() as any).c;
  const withStore = (db.prepare('SELECT COUNT(DISTINCT company_id) AS c FROM stores').get() as any).c;
  const withStaff = (db.prepare('SELECT COUNT(DISTINCT company_id) AS c FROM user_companies WHERE role = \'staff\'').get() as any).c;
  const withShift = (db.prepare('SELECT COUNT(DISTINCT company_id) AS c FROM shifts').get() as any).c;
  const withTimecard = (db.prepare('SELECT COUNT(DISTINCT company_id) AS c FROM time_records').get() as any).c;
  const activeLast7d = (db.prepare("SELECT COUNT(DISTINCT company_id) AS c FROM time_records WHERE created_at >= datetime('now','-7 days')").get() as any).c;
  // 旧会社の未記録値はunknownとして集計し、打刻件数による重複を避ける。
  const sourceRows = db.prepare(`
    SELECT COALESCE(NULLIF(acq_source, ''), 'unknown') AS source, COUNT(*) AS total,
      SUM(EXISTS(SELECT 1 FROM time_records tr WHERE tr.company_id = companies.id)) AS withTimecard
    FROM companies GROUP BY COALESCE(NULLIF(acq_source, ''), 'unknown')
  `).all() as { source: string; total: number; withTimecard: number }[];
  const bySource = Object.fromEntries(sourceRows.map(({ source, total, withTimecard }) => [source, { total, withTimecard }]));
  res.json({
    bySource,
    total,
    withStore,
    withStaff,
    withShift,
    withTimecard,
    activeLast7d,
    dropoff: {
      noStore: total - withStore,
      noStaff: withStore - withStaff,
      noShift: withStaff - withShift,
      noTimecard: withShift - withTimecard,
    },
  });
});

// PATCH /api/admin/users/:id/active - 有効/無効切替
router.patch('/users/:id/active', (req: AuthRequest, res: Response): void => {
  const id = parseInt(req.params.id);
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') {
    res.status(400).json({ error: 'is_active (boolean) が必要です' });
    return;
  }
  db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(is_active ? 1 : 0, id);
  res.json({ ok: true });
});

// POST /api/admin/test-mail - メール送信経路の実測確認（super_admin宛に固定送信、Message-Idを返す）
router.post('/test-mail', async (_req: AuthRequest, res: Response): Promise<void> => {
  const now = new Date().toISOString();
  const result = await sendMailWithResult(
    SUPER_ADMIN_EMAIL,
    `【シフトログ】メール送信テスト ${now}`,
    `これはメール送信経路の動作確認メールです。\n\n送信時刻(UTC): ${now}\n環境: ${process.env.RAILWAY_ENVIRONMENT_NAME || 'local'}\n\nこのメールが届いていれば、本番のメール送信は正常です。`
  );
  res.status(result.ok ? 200 : 502).json(result);
});

// POST /api/admin/run-trial-notify - トライアル通知スケジューラの手動実行（送信済み記録により冪等）
router.post('/run-trial-notify', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    await runTrialNotifications();
    const notices = db.prepare(
      'SELECT company_id, notice_type, sent_at FROM trial_notices ORDER BY sent_at DESC LIMIT 20'
    ).all();
    res.json({ ok: true, recent_notices: notices });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// 配布コードごとの累計と直近7日。未クリックのコードも0件で返す。
router.get('/tracking-clicks', (_req: AuthRequest, res: Response): void => {
  const rows = db.prepare(`
    SELECT code, COUNT(*) AS total,
      SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS last7d
    FROM tracking_clicks GROUP BY code
  `).all() as { code: string; total: number; last7d: number }[];
  const counts = new Map(rows.map(row => [row.code, row]));
  for (const { code } of trackingLinks) {
    if (!counts.has(code)) counts.set(code, { code, total: 0, last7d: 0 });
  }
  res.json({ clicks: [...counts.values()] });
});

// GET /api/admin/progress - 会社ごとの「次のステップ」と停滞日数、最後に見た画面
router.get('/progress', (_req: AuthRequest, res: Response): void => {
  res.json({ companies: companyProgress() });
});

// GET /api/admin/errors - 直近のエラー（クライアント／サーバー）
router.get('/errors', (req: AuthRequest, res: Response): void => {
  const limit = Math.min(200, parseInt(String(req.query.limit || '50')) || 50);
  const errors = db.prepare(`
    SELECT e.id, e.platform, e.app_version, e.path, e.message, e.stack, e.fingerprint, e.created_at,
      e.user_id, e.company_id, u.name AS user_name, c.name AS company_name
    FROM client_errors e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN companies c ON c.id = e.company_id
    ORDER BY e.id DESC LIMIT ?
  `).all(limit);
  const summary = db.prepare(`
    SELECT fingerprint, platform, message, COUNT(*) AS count, MAX(created_at) AS last_at
    FROM client_errors WHERE created_at >= datetime('now', '-7 days')
    GROUP BY fingerprint ORDER BY count DESC LIMIT 20
  `).all();
  res.json({ errors, summary });
});

// GET /api/admin/usage - 直近の画面利用（会社別の最終アクセス・よく見られる画面）
router.get('/usage', (_req: AuthRequest, res: Response): void => {
  const topPaths = db.prepare(`
    SELECT path, COUNT(*) AS views, COUNT(DISTINCT COALESCE(session_id, user_id)) AS sessions
    FROM usage_events WHERE event = 'page_view' AND created_at >= datetime('now', '-7 days') AND path IS NOT NULL
    GROUP BY path ORDER BY views DESC LIMIT 20
  `).all();
  const events = db.prepare(`
    SELECT event, COUNT(*) AS count FROM usage_events
    WHERE event != 'page_view' AND created_at >= datetime('now', '-7 days') GROUP BY event ORDER BY count DESC LIMIT 20
  `).all();
  res.json({ topPaths, events });
});

// GET /api/admin/daily-digest - 日次レポートのプレビュー / POST で即時送信
router.get('/daily-digest', (_req: AuthRequest, res: Response): void => {
  res.json(buildDigest());
});
router.post('/daily-digest', async (_req: AuthRequest, res: Response): Promise<void> => {
  const ok = await runDailyDigest(true);
  res.status(ok ? 200 : 502).json({ ok });
});

export default router;
