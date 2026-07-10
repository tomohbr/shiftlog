import { Router, Request, Response } from 'express';
import db, { SUPER_ADMIN_EMAIL } from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { sendMail } from '../utils/mailer';

const router = Router();

const CATEGORY_LABEL: Record<string, string> = {
  bug: '不具合報告',
  feature: '機能要望',
  question: '質問',
  other: 'その他',
};

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

  const result = db.prepare(
    'INSERT INTO feedbacks (user_id, company_id, category, message, email) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, companyId, safeCategory, message.trim(), email || null);

  // 運営者にメール通知（未読のまま埋もれるのを防ぐ）。送信失敗してもフィードバック自体はDBに保存済みなので握りつぶす。
  const senderName = req.user?.name || '(不明)';
  const senderEmail = email || req.user?.email || '(未記入)';
  const subject = `【シフトログ】新しいフィードバック（${CATEGORY_LABEL[safeCategory]}） - ${senderName}様`;
  const body = `${senderName}様より新しいフィードバックが届きました。\n\n分類: ${CATEGORY_LABEL[safeCategory]}\n連絡先: ${senderEmail}\n\n--- 本文 ---\n${message.trim()}\n---\n\n管理画面で確認・返信: https://shiftlog-production.up.railway.app/feedback-admin\nフィードバックID: ${result.lastInsertRowid}`;
  sendMail(SUPER_ADMIN_EMAIL, subject, body).catch(() => {});

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

// PATCH /api/feedback/:id/status - super_admin のみ
router.patch('/:id/status', authenticateToken, (req: AuthRequest, res: Response): void => {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: '権限がありません' });
    return;
  }

  const { status } = req.body;
  const validStatuses = ['open', 'in_progress', 'closed'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'ステータスが不正です' });
    return;
  }

  const result = db.prepare('UPDATE feedbacks SET status = ? WHERE id = ?')
    .run(status, req.params.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'フィードバックが見つかりません' });
    return;
  }

  res.json({ message: '更新しました' });
});

// DELETE /api/feedback/:id - super_admin のみ
router.delete('/:id', authenticateToken, (req: AuthRequest, res: Response): void => {
  if (req.user?.role !== 'super_admin') {
    res.status(403).json({ error: '権限がありません' });
    return;
  }

  const result = db.prepare('DELETE FROM feedbacks WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'フィードバックが見つかりません' });
    return;
  }

  res.json({ message: '削除しました' });
});

export default router;
