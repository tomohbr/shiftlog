import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { sendRequestLinks, periodText } from './line';
import { pushToCompanyAsync } from '../utils/apns';

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
  if (!['admin','super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const { year, month, deadline, status, start_date, end_date } = req.body;

  if (start_date && end_date && start_date > end_date) {
    res.status(400).json({ error: '収集期間の開始日は終了日より前にしてください' });
    return;
  }

  const prev = db.prepare(
    'SELECT status FROM shift_request_periods WHERE company_id = ? AND year = ? AND month = ?'
  ).get(companyId, year, month) as any;

  db.prepare(`
    INSERT INTO shift_request_periods (company_id, year, month, deadline, status, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, year, month) DO UPDATE SET
      deadline = excluded.deadline,
      status = excluded.status,
      start_date = excluded.start_date,
      end_date = excluded.end_date
  `).run(companyId, year, month, deadline || null, status || 'open', start_date || null, end_date || null);

  // closed → open に変わった時だけスタッフへLINE通知（設定済みの会社のみ）
  const nowOpen = (status || 'open') === 'open';
  const wasOpen = prev?.status === 'open';
  if (nowOpen && !wasOpen) {
    const deadlinePush = deadline ? `締切は ${deadline} です。` : '';
    pushToCompanyAsync(companyId, {
      title: 'シフト希望の受付が始まりました',
      body: `${year}年${month}月分の希望を提出してください。${deadlinePush}`,
      path: '/shift-requests',
    }, req.user!.id);

    const lineSettings = db.prepare('SELECT notify_request_open FROM line_settings WHERE company_id = ?').get(companyId) as any;
    if (lineSettings?.notify_request_open) {
      const detail = periodText({ year: Number(year), month: Number(month), start_date, end_date, deadline });
      sendRequestLinks(companyId, Number(year), Number(month), 'シフト希望の受付が始まりました。', detail).catch(() => {});
    }
  }

  res.json({ message: '収集期間を設定しました' });
});

// POST /api/shift-requests/remind - 未提出のスタッフにだけ、本人専用リンク付きで LINE を送る (admin)
router.post('/remind', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!['admin','super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const year = Number(req.body.year);
  const month = Number(req.body.month);
  const period = db.prepare(
    'SELECT * FROM shift_request_periods WHERE company_id = ? AND year = ? AND month = ?'
  ).get(companyId, year, month) as any;
  if (!period || period.status !== 'open') {
    res.status(400).json({ error: 'この月は希望を受付中ではありません' });
    return;
  }
  const line = db.prepare('SELECT channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any;
  if (!line?.channel_access_token) {
    res.status(409).json({ error: 'LINE 通知の設定がまだです（LINE設定の画面から設定してください）' });
    return;
  }

  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const from = period.start_date || `${ym}-01`;
  const to = period.end_date || `${ym}-31`;
  const unsubmitted = db.prepare(`
    SELECT u.id, u.name, (uli.line_user_id IS NOT NULL) AS linked
    FROM user_companies uc JOIN users u ON u.id = uc.user_id AND u.is_active = 1
    LEFT JOIN user_line_ids uli ON uli.user_id = u.id
    WHERE uc.company_id = ? AND uc.role = 'staff'
      AND NOT EXISTS (
        SELECT 1 FROM shift_requests sr
        WHERE sr.company_id = uc.company_id AND sr.user_id = u.id AND sr.date BETWEEN ? AND ?
      )
    ORDER BY u.name
  `).all(companyId, from, to) as { id: number; name: string; linked: number }[];

  const linkedIds = unsubmitted.filter(u => u.linked).map(u => u.id);
  const result = linkedIds.length
    ? await sendRequestLinks(companyId, year, month, 'シフト希望がまだ届いていません。', periodText({ year, month, ...period }), linkedIds)
    : { sent: 0, targets: 0 };

  res.json({
    sent: result.sent,
    unsubmitted: unsubmitted.length,
    not_linked: unsubmitted.filter(u => !u.linked).map(u => u.name),
  });
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
