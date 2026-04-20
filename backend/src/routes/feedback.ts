import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/feedback - フィードバック送信（認証必須だが会社所属は問わない）
router.post('/', authenticateToken, (req: AuthRequest, res: Response): void => {
  const { category, message, email } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'メッセージを入力してください' });
    return;
  }
  if (message.length > 5000) {
    res.status(400).json({ error: 'メッセージは5000文字以内で入力してください' });
    return;
  }

  const validCategories = ['bug', 'feature', 'question', 'other'];
  const safeCategory = validCategories.includes(category) ? category : 'other';

  const userId = req.user?.id || null;
  // companyId は req.companyId があれば使うが、authenticateToken だけだと set されないので null でOK
  const companyId = null;

  db.prepare(
    'INSERT INTO feedbacks (user_id, company_id, category, message, email) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, companyId, safeCategory, message.trim(), email || null);

  res.status(201).json({ message: 'フィードバックを送信しました。ありがとうございました。' });
});

// GET /api/feedback - super_admin のみ閲覧可（管理画面用）
router.get('/', authenticateToken, (req: AuthRequest, res: Response): void => {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: '権限がありません' });
    return;
  }

  const feedbacks = db.prepare(`
    SELECT f.*, u.email as user_email, u.name as user_name, c.name as company_name
    FROM feedbacks f
    LEFT JOIN users u ON f.user_id = u.id
    LEFT JOIN companies c ON f.company_id = c.id
    ORDER BY f.created_at DESC
    LIMIT 500
  `).all();

  res.json({ feedbacks });
});

export default router;
