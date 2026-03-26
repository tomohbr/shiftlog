import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/absence - List absence reports
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { status, year, month } = req.query;

  let query = `
    SELECT ar.*, u.name as user_name, uc.color as user_color,
           cu.name as cover_user_name
    FROM absence_reports ar
    JOIN users u ON u.id = ar.user_id
    JOIN user_companies uc ON uc.user_id = ar.user_id AND uc.company_id = ar.company_id
    LEFT JOIN users cu ON cu.id = ar.cover_user_id
    WHERE ar.company_id = ?
  `;
  const params: any[] = [companyId];

  if (status) { query += ' AND ar.status = ?'; params.push(status); }
  if (year && month) {
    query += ' AND ar.date LIKE ?';
    params.push(`${year}-${String(Number(month as string)).padStart(2, '0')}-%`);
  }
  query += ' ORDER BY ar.created_at DESC';

  res.json({ reports: db.prepare(query).all(...params) });
});

// POST /api/absence - Report absence (staff)
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const { shift_id, date, reason } = req.body;

  if (!date) { res.status(400).json({ error: '日付は必須です' }); return; }

  const result = db.prepare(
    'INSERT INTO absence_reports (company_id, user_id, shift_id, date, reason) VALUES (?, ?, ?, ?, ?)'
  ).run(companyId, userId, shift_id || null, date, reason || null);

  res.status(201).json({ report: db.prepare('SELECT * FROM absence_reports WHERE id = ?').get(result.lastInsertRowid) });
});

// POST /api/absence/:id/cover - Volunteer to cover (staff)
router.post('/:id/cover', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const report = db.prepare(
    'SELECT * FROM absence_reports WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId!) as any;
  if (!report) { res.status(404).json({ error: '見つかりません' }); return; }
  if (report.status !== 'pending') { res.status(400).json({ error: '既に対応済みです' }); return; }

  db.prepare(
    'UPDATE absence_reports SET cover_user_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(req.user!.id, 'covered', req.params.id);

  // If there's a linked shift, create a new shift for cover user
  if (report.shift_id) {
    const originalShift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(report.shift_id) as any;
    if (originalShift) {
      db.prepare(
        'INSERT INTO shifts (company_id, user_id, date, start_time, end_time, break_minutes, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(req.companyId!, req.user!.id, originalShift.date, originalShift.start_time, originalShift.end_time, originalShift.break_minutes, 'confirmed');
      // Cancel original shift
      db.prepare("UPDATE shifts SET status = 'cancelled' WHERE id = ?").run(report.shift_id);
    }
  }

  res.json({ message: '代替を引き受けました' });
});

// PUT /api/absence/:id - Update status (admin)
router.put('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const { status } = req.body;
  db.prepare(
    'UPDATE absence_reports SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?'
  ).run(status, req.params.id, req.companyId!);
  res.json({ message: '更新しました' });
});

// GET /api/absence/help-requests - Open help requests for staff to see
router.get('/help-requests', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const reports = db.prepare(`
    SELECT ar.*, u.name as user_name, s.start_time, s.end_time
    FROM absence_reports ar
    JOIN users u ON u.id = ar.user_id
    LEFT JOIN shifts s ON s.id = ar.shift_id
    WHERE ar.company_id = ? AND ar.status = 'pending'
    ORDER BY ar.date
  `).all(req.companyId!);
  res.json({ reports });
});

export default router;
