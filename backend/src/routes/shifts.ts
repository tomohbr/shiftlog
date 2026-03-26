import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/shifts?year=2024&month=1
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month, user_id, start_date, end_date } = req.query;

  let query = `
    SELECT s.*, u.name as user_name, uc.color as user_color
    FROM shifts s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN user_companies uc ON s.user_id = uc.user_id AND s.company_id = uc.company_id
    WHERE s.company_id = ?
  `;
  const params: (string | number)[] = [companyId];

  if (year && month) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
    query += ' AND s.date >= ? AND s.date <= ?';
    params.push(startDate, endDate);
  } else if (start_date && end_date) {
    query += ' AND s.date >= ? AND s.date <= ?';
    params.push(start_date as string, end_date as string);
  }

  if (req.user!.role !== 'admin') {
    query += ' AND s.user_id = ?';
    params.push(req.user!.id);
  } else if (user_id) {
    query += ' AND s.user_id = ?';
    params.push(parseInt(user_id as string));
  }

  query += ' ORDER BY s.date ASC, s.start_time ASC';

  const shifts = db.prepare(query).all(...params);
  res.json({ shifts });
});

// GET /api/shifts/:id
router.get('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  const shift = db.prepare(`
    SELECT s.*, u.name as user_name, uc.color as user_color
    FROM shifts s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN user_companies uc ON s.user_id = uc.user_id AND s.company_id = uc.company_id
    WHERE s.id = ? AND s.company_id = ?
  `).get(req.params.id, companyId) as any;

  if (!shift) {
    res.status(404).json({ error: 'シフトが見つかりません' });
    return;
  }

  if (req.user!.role !== 'admin' && shift.user_id !== req.user!.id) {
    res.status(403).json({ error: 'アクセス権限がありません' });
    return;
  }

  res.json({ shift });
});

// POST /api/shifts
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const { user_id, date, start_time, end_time, break_minutes, notes } = req.body;

  if (!user_id || !date || !start_time || !end_time) {
    res.status(400).json({ error: 'スタッフ、日付、開始時間、終了時間を入力してください' });
    return;
  }

  // Check user belongs to company
  const uc = db.prepare(
    'SELECT * FROM user_companies WHERE user_id = ? AND company_id = ?'
  ).get(user_id, companyId);
  if (!uc) {
    res.status(404).json({ error: 'スタッフが見つかりません' });
    return;
  }

  const existing = db.prepare(`
    SELECT id FROM shifts
    WHERE company_id = ? AND user_id = ? AND date = ?
    AND NOT (end_time <= ? OR start_time >= ?)
  `).get(companyId, user_id, date, start_time, end_time);

  if (existing) {
    res.status(409).json({ error: 'この時間帯にすでにシフトが登録されています' });
    return;
  }

  const result = db.prepare(
    'INSERT INTO shifts (company_id, user_id, date, start_time, end_time, break_minutes, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(companyId, user_id, date, start_time, end_time, break_minutes || 0, notes || null, 'confirmed');

  const shift = db.prepare(`
    SELECT s.*, u.name as user_name, uc.color as user_color
    FROM shifts s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN user_companies uc ON s.user_id = uc.user_id AND s.company_id = uc.company_id
    WHERE s.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ shift });
});

// PUT /api/shifts/:id
router.put('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const shift = db.prepare('SELECT * FROM shifts WHERE id = ? AND company_id = ?').get(req.params.id, companyId) as any;
  if (!shift) {
    res.status(404).json({ error: 'シフトが見つかりません' });
    return;
  }

  const { user_id, date, start_time, end_time, break_minutes, notes, status } = req.body;

  db.prepare(`
    UPDATE shifts
    SET user_id = ?, date = ?, start_time = ?, end_time = ?,
        break_minutes = ?, notes = ?, status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND company_id = ?
  `).run(
    user_id || shift.user_id,
    date || shift.date,
    start_time || shift.start_time,
    end_time || shift.end_time,
    break_minutes !== undefined ? break_minutes : shift.break_minutes,
    notes !== undefined ? notes : shift.notes,
    status || shift.status,
    req.params.id, companyId
  );

  const updated = db.prepare(`
    SELECT s.*, u.name as user_name, uc.color as user_color
    FROM shifts s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN user_companies uc ON s.user_id = uc.user_id AND s.company_id = uc.company_id
    WHERE s.id = ?
  `).get(req.params.id);

  res.json({ shift: updated });
});

// DELETE /api/shifts/:id
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const shift = db.prepare('SELECT * FROM shifts WHERE id = ? AND company_id = ?').get(req.params.id, companyId);
  if (!shift) {
    res.status(404).json({ error: 'シフトが見つかりません' });
    return;
  }

  db.prepare('DELETE FROM shifts WHERE id = ? AND company_id = ?').run(req.params.id, companyId);
  res.json({ message: 'シフトを削除しました' });
});

// POST /api/shifts/bulk
router.post('/bulk', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const { shifts } = req.body;
  if (!Array.isArray(shifts) || shifts.length === 0) {
    res.status(400).json({ error: 'シフトデータが必要です' });
    return;
  }

  const insertShift = db.prepare(
    'INSERT OR REPLACE INTO shifts (company_id, user_id, date, start_time, end_time, break_minutes, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const insertMany = db.transaction((shiftsData: any[]) => {
    for (const s of shiftsData) {
      insertShift.run(companyId, s.user_id, s.date, s.start_time, s.end_time, s.break_minutes || 0, s.notes || null, 'confirmed');
    }
  });

  insertMany(shifts);
  res.json({ message: `${shifts.length}件のシフトを登録しました` });
});

// GET /api/shifts/report/summary
router.get('/report/summary', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;

  if (!year || !month) {
    res.status(400).json({ error: '年と月を指定してください' });
    return;
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  let query = `
    SELECT
      u.id as user_id,
      u.name as user_name,
      uc.color as user_color,
      uc.hourly_wage,
      uc.employment_type,
      COUNT(s.id) as shift_count,
      SUM(
        CASE WHEN s.id IS NOT NULL THEN
          (CAST(substr(s.end_time, 1, 2) AS INTEGER) * 60 + CAST(substr(s.end_time, 4, 2) AS INTEGER))
          - (CAST(substr(s.start_time, 1, 2) AS INTEGER) * 60 + CAST(substr(s.start_time, 4, 2) AS INTEGER))
          - s.break_minutes
        ELSE 0 END
      ) as total_minutes
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    LEFT JOIN shifts s ON u.id = s.user_id AND s.company_id = ? AND s.date >= ? AND s.date <= ?
    WHERE u.is_active = 1
  `;
  const params: (string | number)[] = [companyId, companyId, startDate, endDate];

  if (req.user!.role !== 'admin') {
    query += ' AND u.id = ?';
    params.push(req.user!.id);
  }

  query += ' GROUP BY u.id, u.name, uc.color, uc.hourly_wage, uc.employment_type ORDER BY u.name ASC';

  const summary = db.prepare(query).all(...params);

  const result = (summary as any[]).map(row => ({
    ...row,
    total_hours: row.total_minutes ? Math.floor(row.total_minutes / 60) : 0,
    total_minutes_remainder: row.total_minutes ? row.total_minutes % 60 : 0,
    total_wage: row.total_minutes ? Math.floor((row.total_minutes / 60) * row.hourly_wage) : 0,
  }));

  res.json({ summary: result });
});

// Publication endpoints (moved from shiftRequests)
router.get('/publication/:year/:month', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.params;

  const publication = db.prepare(
    'SELECT * FROM shift_publications WHERE company_id = ? AND year = ? AND month = ?'
  ).get(companyId, parseInt(year), parseInt(month));

  res.json({ publication: publication || { is_published: 0 } });
});

router.post('/publication', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const { year, month, is_published } = req.body;
  if (!year || !month) {
    res.status(400).json({ error: '年と月を指定してください' });
    return;
  }

  const existing = db.prepare(
    'SELECT id FROM shift_publications WHERE company_id = ? AND year = ? AND month = ?'
  ).get(companyId, year, month);

  if (existing) {
    db.prepare(`
      UPDATE shift_publications
      SET is_published = ?, published_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE company_id = ? AND year = ? AND month = ?
    `).run(is_published ? 1 : 0, is_published ? 1 : 0, companyId, year, month);
  } else {
    db.prepare(`
      INSERT INTO shift_publications (company_id, year, month, is_published, published_at)
      VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)
    `).run(companyId, year, month, is_published ? 1 : 0, is_published ? 1 : 0);
  }

  const publication = db.prepare(
    'SELECT * FROM shift_publications WHERE company_id = ? AND year = ? AND month = ?'
  ).get(companyId, year, month);

  res.json({ publication });
});

export default router;
