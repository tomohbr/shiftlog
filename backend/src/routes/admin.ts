import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireSuperAdmin, AuthRequest } from '../middleware/auth';

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
    SELECT c.id, c.name, uc.role
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
      c.id, c.name, c.company_pin, c.created_at,
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
  res.json({
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

export default router;
