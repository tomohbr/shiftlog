import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/shift-requests?year=2026&month=3 - Get all requests for a month
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month, user_id } = req.query;

  let query = `
    SELECT sr.*, u.name as user_name, uc.color as user_color
    FROM shift_requests sr
    JOIN users u ON u.id = sr.user_id
    JOIN user_companies uc ON uc.user_id = sr.user_id AND uc.company_id = sr.company_id
    WHERE sr.company_id = ?
  `;
  const params: any[] = [companyId];

  if (year && month) {
    query += ` AND sr.date LIKE ?`;
    params.push(`${year}-${String(Number(month)).padStart(2, '0')}-%`);
  }
  if (user_id) {
    query += ` AND sr.user_id = ?`;
    params.push(user_id);
  }
  query += ' ORDER BY sr.date, u.name';

  const requests = db.prepare(query).all(...params);
  res.json({ requests });
});

// POST /api/shift-requests - Submit availability (staff)
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const { date, availability, preferred_start, preferred_end, notes } = req.body;

  if (!date || !availability) {
    res.status(400).json({ error: '日付と出勤可否は必須です' });
    return;
  }

  db.prepare(`
    INSERT INTO shift_requests (company_id, user_id, date, availability, preferred_start, preferred_end, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, user_id, date) DO UPDATE SET
      availability = excluded.availability,
      preferred_start = excluded.preferred_start,
      preferred_end = excluded.preferred_end,
      notes = excluded.notes
  `).run(companyId, userId, date, availability, preferred_start || null, preferred_end || null, notes || null);

  res.json({ message: '希望を提出しました' });
});

// POST /api/shift-requests/bulk - Submit multiple days at once
router.post('/bulk', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const { requests } = req.body;

  if (!Array.isArray(requests)) {
    res.status(400).json({ error: 'requests配列が必要です' });
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO shift_requests (company_id, user_id, date, availability, preferred_start, preferred_end, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, user_id, date) DO UPDATE SET
      availability = excluded.availability,
      preferred_start = excluded.preferred_start,
      preferred_end = excluded.preferred_end,
      notes = excluded.notes
  `);

  const insert = db.transaction((items: any[]) => {
    for (const item of items) {
      stmt.run(companyId, userId, item.date, item.availability, item.preferred_start || null, item.preferred_end || null, item.notes || null);
    }
  });
  insert(requests);

  res.json({ message: `${requests.length}件の希望を提出しました` });
});

// GET /api/shift-requests/period?year=2026&month=3 - Get collection period info
router.get('/period', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;
  const period = db.prepare(
    'SELECT * FROM shift_request_periods WHERE company_id = ? AND year = ? AND month = ?'
  ).get(companyId, year, month);
  res.json({ period: period || null });
});

// POST /api/shift-requests/period - Open/close collection period (admin)
router.post('/period', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const { year, month, deadline, status } = req.body;

  db.prepare(`
    INSERT INTO shift_request_periods (company_id, year, month, deadline, status)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(company_id, year, month) DO UPDATE SET
      deadline = excluded.deadline,
      status = excluded.status
  `).run(companyId, year, month, deadline || null, status || 'open');

  res.json({ message: '収集期間を設定しました' });
});

// GET /api/shift-requests/summary?year=2026&month=3 - Summary view for admin
router.get('/summary', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;

  const staff = db.prepare(`
    SELECT u.id, u.name, uc.color FROM users u
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    WHERE uc.role = 'staff' ORDER BY u.name
  `).all(companyId);

  const requests = db.prepare(`
    SELECT user_id, date, availability, preferred_start, preferred_end, notes
    FROM shift_requests WHERE company_id = ? AND date LIKE ?
  `).all(companyId, `${year}-${String(Number(month as string)).padStart(2, '0')}-%`);

  res.json({ staff, requests });
});

export default router;
