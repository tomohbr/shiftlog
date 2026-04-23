import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/templates
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const templates = db.prepare(
    'SELECT * FROM shift_templates WHERE company_id = ? ORDER BY start_time'
  ).all(req.companyId!);
  res.json({ templates });
});

// POST /api/templates
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!['admin','super_admin'].includes(req.user!.role)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const { name, start_time, end_time, break_minutes, color } = req.body;
  if (!name || !start_time || !end_time) { res.status(400).json({ error: '名前と時間は必須です' }); return; }

  const result = db.prepare(
    'INSERT INTO shift_templates (company_id, name, start_time, end_time, break_minutes, color) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.companyId!, name, start_time, end_time, break_minutes || 0, color || '#4A90E2');

  const template = db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ template });
});

// PUT /api/templates/:id
router.put('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!['admin','super_admin'].includes(req.user!.role)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const { name, start_time, end_time, break_minutes, color } = req.body;
  db.prepare(
    'UPDATE shift_templates SET name=?, start_time=?, end_time=?, break_minutes=?, color=? WHERE id=? AND company_id=?'
  ).run(name, start_time, end_time, break_minutes || 0, color || '#4A90E2', req.params.id, req.companyId!);
  const template = db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(req.params.id);
  res.json({ template });
});

// DELETE /api/templates/:id
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!['admin','super_admin'].includes(req.user!.role)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  db.prepare('DELETE FROM shift_templates WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId!);
  res.json({ message: '削除しました' });
});

// POST /api/templates/:id/apply - Apply template to create shifts
router.post('/:id/apply', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!['admin','super_admin'].includes(req.user!.role)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const template = db.prepare(
    'SELECT * FROM shift_templates WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId!) as any;
  if (!template) { res.status(404).json({ error: 'テンプレートが見つかりません' }); return; }

  const { user_ids, dates } = req.body;
  if (!Array.isArray(user_ids) || !Array.isArray(dates)) {
    res.status(400).json({ error: 'user_idsとdatesの配列が必要です' }); return;
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO shifts (company_id, user_id, date, start_time, end_time, break_minutes, status)
    VALUES (?, ?, ?, ?, ?, ?, 'confirmed')
  `);
  let count = 0;
  const insert = db.transaction(() => {
    for (const date of dates) {
      for (const userId of user_ids) {
        const r = stmt.run(req.companyId!, userId, date, template.start_time, template.end_time, template.break_minutes);
        if (r.changes > 0) count++;
      }
    }
  });
  insert();

  res.json({ message: `${count}件のシフトを作成しました` });
});

export default router;
