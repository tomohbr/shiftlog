import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { pushToCompanyAsync, pushToUsersAsync } from '../utils/apns';
import { phoneOnly, phoneOnlyMessage } from '../utils/absenceRule';

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
  // 前日・当日など、お店が電話でしか受けない日（管理者が記録する場合は通す）
  const storeId = shift_id ? (db.prepare('SELECT store_id FROM shifts WHERE id = ?').get(shift_id) as any)?.store_id : null;
  if (!['admin', 'super_admin'].includes(req.user!.role) && phoneOnly(companyId, date, storeId)) {
    res.status(400).json({ error: phoneOnlyMessage(companyId, storeId), phone_only: true });
    return;
  }

  const result = db.prepare(
    'INSERT INTO absence_reports (company_id, user_id, shift_id, date, reason) VALUES (?, ?, ?, ?, ?)'
  ).run(companyId, userId, shift_id || null, date, reason || null);

  // 欠勤が出たら、代わりに入れる人を探すため会社全員に通知する（本人は除く）
  pushToCompanyAsync(companyId, {
    title: 'ヘルプ募集',
    body: `${req.user!.name}さんが ${date} を欠勤。入れる方を探しています。`,
    path: '/absence',
  }, userId);

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

  pushToUsersAsync([report.user_id], {
    title: 'ヘルプが見つかりました',
    body: `${req.user!.name}さんが ${report.date} の代わりに入ってくれます`,
    path: '/absence',
  });

  // 元のシフトの担当を代わりの人に差し替える（会場・時間はそのまま）。
  // 以前は新しいシフトを作って元を cancelled にしていたが、cancelled が一覧に残り二重に見えていた
  if (report.shift_id) {
    db.prepare('UPDATE shifts SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?')
      .run(req.user!.id, report.shift_id, req.companyId!);
  }

  res.json({ message: '代替を引き受けました' });
});

// PUT /api/absence/:id - Update status (admin)
router.put('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!['admin','super_admin'].includes(req.user!.role)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
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
