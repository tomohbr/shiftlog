import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';

const router = Router();

function isAdmin(role?: string) {
  return role === 'admin' || role === 'super_admin';
}

// GET /api/skills - 会社のスキル一覧
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const skills = db.prepare(`
    SELECT s.*, COUNT(us.user_id) as user_count
    FROM skills s
    LEFT JOIN user_skills us ON us.skill_id = s.id
    WHERE s.company_id = ?
    GROUP BY s.id
    ORDER BY s.name
  `).all(companyId);
  res.json({ skills });
});

// POST /api/skills - スキル追加（管理者）
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req.user?.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const { name, color } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'スキル名を入力してください' });
    return;
  }

  try {
    const result = db.prepare(
      'INSERT INTO skills (company_id, name, color) VALUES (?, ?, ?)'
    ).run(companyId, name.trim(), color || '#6B7280');
    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(result.lastInsertRowid);
    logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'skill', entityId: Number(result.lastInsertRowid), summary: `スキル「${name}」を追加` });
    res.status(201).json({ skill });
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) {
      res.status(409).json({ error: '同名のスキルが既に存在します' });
      return;
    }
    res.status(500).json({ error: 'スキル追加に失敗しました' });
  }
});

// DELETE /api/skills/:id
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req.user?.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const skill = db.prepare('SELECT * FROM skills WHERE id = ? AND company_id = ?').get(req.params.id, companyId) as any;
  if (!skill) {
    res.status(404).json({ error: 'スキルが見つかりません' });
    return;
  }
  db.prepare('DELETE FROM skills WHERE id = ?').run(req.params.id);
  logAudit({ userId: req.user!.id, companyId, action: 'delete', entity: 'skill', entityId: Number(req.params.id), summary: `スキル「${skill.name}」を削除` });
  res.json({ message: '削除しました' });
});

// PUT /api/skills/user/:userId - ユーザーのスキル付与を一括上書き
router.put('/user/:userId', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req.user?.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const userId = parseInt(req.params.userId);
  const { skill_ids } = req.body as { skill_ids: number[] };

  // 同じ会社に属しているか
  const uc = db.prepare('SELECT 1 FROM user_companies WHERE user_id = ? AND company_id = ?').get(userId, companyId);
  if (!uc) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  const txn = db.transaction((ids: number[]) => {
    db.prepare(`DELETE FROM user_skills WHERE user_id = ? AND skill_id IN (SELECT id FROM skills WHERE company_id = ?)`).run(userId, companyId);
    const insert = db.prepare('INSERT OR IGNORE INTO user_skills (user_id, skill_id) VALUES (?, ?)');
    for (const sid of ids || []) {
      // 会社のスキルかチェック
      const exists = db.prepare('SELECT 1 FROM skills WHERE id = ? AND company_id = ?').get(sid, companyId);
      if (exists) insert.run(userId, sid);
    }
  });
  txn(skill_ids || []);
  logAudit({ userId: req.user!.id, companyId, action: 'update', entity: 'user_skills', entityId: userId, summary: `ユーザー #${userId} のスキルを更新` });
  res.json({ message: '更新しました' });
});

// GET /api/skills/user/:userId - ユーザーのスキル一覧
router.get('/user/:userId', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = parseInt(req.params.userId);
  const skills = db.prepare(`
    SELECT s.* FROM skills s
    JOIN user_skills us ON us.skill_id = s.id
    WHERE us.user_id = ? AND s.company_id = ?
    ORDER BY s.name
  `).all(userId, companyId);
  res.json({ skills });
});

export default router;
