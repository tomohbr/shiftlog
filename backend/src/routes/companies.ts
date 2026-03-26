import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/companies - 自分が管理する会社一覧
router.get('/', authenticateToken, (req: AuthRequest, res: Response): void => {
  const companies = db.prepare(`
    SELECT c.*, uc.role as my_role
    FROM user_companies uc
    JOIN companies c ON uc.company_id = c.id
    WHERE uc.user_id = ?
    ORDER BY c.name ASC
  `).all(req.user!.id);

  res.json({ companies });
});

// GET /api/companies/:id
router.get('/:id', authenticateToken, (req: AuthRequest, res: Response): void => {
  const companyId = parseInt(req.params.id);

  // Check user has access
  const access = db.prepare(
    'SELECT * FROM user_companies WHERE user_id = ? AND company_id = ?'
  ).get(req.user!.id, companyId);

  if (!access) {
    res.status(403).json({ error: 'この会社へのアクセス権限がありません' });
    return;
  }

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) {
    res.status(404).json({ error: '会社が見つかりません' });
    return;
  }

  // Get staff count
  const staffCount = db.prepare(
    'SELECT COUNT(*) as count FROM user_companies WHERE company_id = ?'
  ).get(companyId) as any;

  res.json({ company, staffCount: staffCount.count });
});

// POST /api/companies - 新しい会社を作成（admin only）
router.post('/', authenticateToken, requireAdmin, (req: AuthRequest, res: Response): void => {
  const { name, company_pin, address, phone } = req.body;

  if (!name) {
    res.status(400).json({ error: '会社名を入力してください' });
    return;
  }

  const result = db.prepare(
    'INSERT INTO companies (name, company_pin, address, phone) VALUES (?, ?, ?, ?)'
  ).run(name, company_pin || null, address || null, phone || null);

  // Link the admin to this new company
  db.prepare(
    'INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)'
  ).run(req.user!.id, result.lastInsertRowid, 'admin');

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ company });
});

// PUT /api/companies/:id
router.put('/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response): void => {
  const companyId = parseInt(req.params.id);
  const { name, company_pin, address, phone } = req.body;

  const access = db.prepare(
    'SELECT * FROM user_companies WHERE user_id = ? AND company_id = ? AND role = ?'
  ).get(req.user!.id, companyId, 'admin');

  if (!access) {
    res.status(403).json({ error: 'この会社の管理権限がありません' });
    return;
  }

  db.prepare(
    'UPDATE companies SET name = ?, company_pin = ?, address = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(name, company_pin || null, address || null, phone || null, companyId);

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  res.json({ company });
});

// DELETE /api/companies/:id
router.delete('/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response): void => {
  const companyId = parseInt(req.params.id);

  const access = db.prepare(
    'SELECT * FROM user_companies WHERE user_id = ? AND company_id = ? AND role = ?'
  ).get(req.user!.id, companyId, 'admin');

  if (!access) {
    res.status(403).json({ error: 'この会社の管理権限がありません' });
    return;
  }

  // Delete all related data
  db.prepare('DELETE FROM time_records WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM shifts WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM shift_publications WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM stores WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM user_companies WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM companies WHERE id = ?').run(companyId);

  res.json({ message: '会社を削除しました' });
});

export default router;
