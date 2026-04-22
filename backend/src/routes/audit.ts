import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/audit-logs - 所属会社の監査ログを返す（管理者のみ）
// super_admin は company_id 省略時に全件
router.get('/', authenticateToken, (req: AuthRequest, res: Response): void => {
  const isSuper = req.user?.role === 'super_admin';
  const isAdmin = req.user?.role === 'admin' || isSuper;
  if (!isAdmin) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const limit = Math.min(parseInt(String(req.query.limit || '200')) || 200, 500);
  const entity = req.query.entity as string | undefined;
  const action = req.query.action as string | undefined;

  let sql = `
    SELECT l.*, u.name as user_name, u.email as user_email, c.name as company_name
    FROM audit_logs l
    LEFT JOIN users u ON l.user_id = u.id
    LEFT JOIN companies c ON l.company_id = c.id
  `;
  const conds: string[] = [];
  const params: any[] = [];
  if (!isSuper) {
    if (!req.companyId) {
      res.status(400).json({ error: '会社を選択してください' });
      return;
    }
    conds.push('l.company_id = ?');
    params.push(req.companyId);
  } else if (req.companyId) {
    conds.push('l.company_id = ?');
    params.push(req.companyId);
  }
  if (entity) { conds.push('l.entity = ?'); params.push(entity); }
  if (action) { conds.push('l.action = ?'); params.push(action); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY l.created_at DESC LIMIT ?';
  params.push(limit);

  const logs = db.prepare(sql).all(...params);
  res.json({ logs });
});

export default router;
