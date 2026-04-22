import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';

const router = Router();

// GET /api/swaps - 自分に関連する交代リクエスト一覧
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';

  let sql = `
    SELECT sw.*, s.date, s.start_time, s.end_time,
      ru.name as requester_name, tu.name as target_user_name,
      rs.name as responder_name
    FROM shift_swaps sw
    JOIN shifts s ON sw.shift_id = s.id
    JOIN users ru ON sw.requester_id = ru.id
    LEFT JOIN users tu ON sw.target_user_id = tu.id
    LEFT JOIN users rs ON sw.responder_id = rs.id
    WHERE sw.company_id = ?
  `;
  const params: any[] = [companyId];
  if (!isAdmin) {
    // スタッフは自分が依頼者 or ターゲット or 全員宛（target_user_id IS NULL）のみ
    sql += ' AND (sw.requester_id = ? OR sw.target_user_id = ? OR sw.target_user_id IS NULL)';
    params.push(userId, userId);
  }
  sql += ' ORDER BY sw.created_at DESC LIMIT 200';

  const swaps = db.prepare(sql).all(...params);
  res.json({ swaps });
});

// POST /api/swaps - 交代リクエスト作成
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const { shift_id, target_user_id, reason } = req.body;

  if (!shift_id) {
    res.status(400).json({ error: 'shift_id が必要です' });
    return;
  }

  const shift = db.prepare('SELECT * FROM shifts WHERE id = ? AND company_id = ?').get(shift_id, companyId) as any;
  if (!shift) {
    res.status(404).json({ error: 'シフトが見つかりません' });
    return;
  }
  if (shift.user_id !== userId && req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: '自分のシフトのみ交代リクエスト可能です' });
    return;
  }

  const result = db.prepare(
    'INSERT INTO shift_swaps (company_id, requester_id, shift_id, target_user_id, reason) VALUES (?, ?, ?, ?, ?)'
  ).run(companyId, userId, shift_id, target_user_id || null, reason || null);

  logAudit({ userId, companyId, action: 'create', entity: 'shift_swap', entityId: Number(result.lastInsertRowid), summary: `シフト #${shift_id} の交代を依頼` });
  res.status(201).json({ id: result.lastInsertRowid });
});

// POST /api/swaps/:id/accept - 他のスタッフが交代を承諾
router.post('/:id/accept', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const swap = db.prepare('SELECT * FROM shift_swaps WHERE id = ? AND company_id = ?').get(req.params.id, companyId) as any;
  if (!swap) {
    res.status(404).json({ error: '交代リクエストが見つかりません' });
    return;
  }
  if (swap.status !== 'pending') {
    res.status(400).json({ error: 'すでに対応済みです' });
    return;
  }
  if (swap.target_user_id && swap.target_user_id !== userId) {
    res.status(403).json({ error: 'このリクエストは他のスタッフに依頼されています' });
    return;
  }
  if (swap.requester_id === userId) {
    res.status(400).json({ error: '自分のリクエストは承諾できません' });
    return;
  }

  const txn = db.transaction(() => {
    // シフトの担当者を変更
    db.prepare('UPDATE shifts SET user_id = ? WHERE id = ? AND company_id = ?').run(userId, swap.shift_id, companyId);
    db.prepare('UPDATE shift_swaps SET status = ?, responder_id = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('accepted', userId, swap.id);
  });
  txn();
  logAudit({ userId, companyId, action: 'accept', entity: 'shift_swap', entityId: Number(req.params.id), summary: `シフト交代を承諾 (shift #${swap.shift_id})` });
  res.json({ message: '承諾しました' });
});

// POST /api/swaps/:id/reject
router.post('/:id/reject', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const swap = db.prepare('SELECT * FROM shift_swaps WHERE id = ? AND company_id = ?').get(req.params.id, companyId) as any;
  if (!swap) {
    res.status(404).json({ error: '交代リクエストが見つかりません' });
    return;
  }
  if (swap.status !== 'pending') {
    res.status(400).json({ error: 'すでに対応済みです' });
    return;
  }
  db.prepare('UPDATE shift_swaps SET status = ?, responder_id = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('rejected', userId, swap.id);
  logAudit({ userId, companyId, action: 'reject', entity: 'shift_swap', entityId: Number(req.params.id) });
  res.json({ message: '拒否しました' });
});

// DELETE /api/swaps/:id - 依頼者が取消
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const swap = db.prepare('SELECT * FROM shift_swaps WHERE id = ? AND company_id = ?').get(req.params.id, companyId) as any;
  if (!swap) {
    res.status(404).json({ error: '交代リクエストが見つかりません' });
    return;
  }
  const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
  if (swap.requester_id !== userId && !isAdmin) {
    res.status(403).json({ error: '依頼者本人または管理者のみ取消できます' });
    return;
  }
  db.prepare('DELETE FROM shift_swaps WHERE id = ?').run(req.params.id);
  logAudit({ userId, companyId, action: 'delete', entity: 'shift_swap', entityId: Number(req.params.id) });
  res.json({ message: '取消しました' });
});

export default router;
