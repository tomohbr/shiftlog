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
