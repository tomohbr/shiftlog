import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/feedback - フィードバック送信（全ユーザー）
router.post('/', authenticateToken, (req: AuthRequest, res: Response): void => {
  const { category, subject, message } = req.body;

  if (!message) {
    res.status(400).json({ error: 'メッセージを入力してください' });
    return;
  }

  const companyId = req.companyId || null;
  const result = db.prepare(
    'INSERT INTO feedback (company_id, user_id, category, subject, message) VALUES (?, ?, ?, ?, ?)'
  ).run(companyId, req.user!.id, category || 'general', subject || null, message);

  const feedback = db.prepare('SELECT * FROM feedback WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ feedback });
});

// GET /api/feedback - フィードバック一覧（管理者のみ）
router.get('/', authenticateToken, (req: AuthRequest, res: Response): void => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const feedbacks = db.prepare(`
    SELECT f.*, u.name as user_name
    FROM feedback f
    JOIN users u ON f.user_id = u.id
    ORDER BY f.created_at DESC
  `).all();

  res.json({ feedbacks });
});

export default router;
