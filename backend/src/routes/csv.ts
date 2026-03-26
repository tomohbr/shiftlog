import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';

const router = Router();

function toCsv(headers: string[], rows: any[][]): string {
  const bom = '\uFEFF'; // UTF-8 BOM for Excel
  const header = headers.join(',');
  const body = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  return bom + header + '\n' + body;
}

// GET /api/csv/shifts?year=2026&month=3
router.get('/shifts', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;
  const datePrefix = `${year}-${String(Number(month as string)).padStart(2, '0')}`;

  const shifts = db.prepare(`
    SELECT s.date, u.name as staff_name, s.start_time, s.end_time, s.break_minutes, s.status, s.notes
    FROM shifts s JOIN users u ON u.id = s.user_id
    WHERE s.company_id = ? AND s.date LIKE ? ORDER BY s.date, s.start_time
  `).all(companyId, `${datePrefix}-%`) as any[];

  const csv = toCsv(
    ['日付', 'スタッフ名', '開始時間', '終了時間', '休憩(分)', 'ステータス', '備考'],
    shifts.map(s => [s.date, s.staff_name, s.start_time, s.end_time, s.break_minutes, s.status, s.notes])
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="shifts_${datePrefix}.csv"`);
  res.send(csv);
});

// GET /api/csv/timecards?year=2026&month=3
router.get('/timecards', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;
  const datePrefix = `${year}-${String(Number(month as string)).padStart(2, '0')}`;

  const records = db.prepare(`
    SELECT tr.date, u.name as staff_name, tr.clock_in, tr.clock_out, tr.break_minutes, tr.status, tr.notes
    FROM time_records tr JOIN users u ON u.id = tr.user_id
    WHERE tr.company_id = ? AND tr.date LIKE ? ORDER BY tr.date, tr.clock_in
  `).all(companyId, `${datePrefix}-%`) as any[];

  const csv = toCsv(
    ['日付', 'スタッフ名', '出勤', '退勤', '休憩(分)', 'ステータス', '備考'],
    records.map(r => [r.date, r.staff_name, r.clock_in, r.clock_out, r.break_minutes, r.status, r.notes])
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="timecards_${datePrefix}.csv"`);
  res.send(csv);
});

// GET /api/csv/summary?year=2026&month=3
router.get('/summary', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;
  const datePrefix = `${year}-${String(Number(month as string)).padStart(2, '0')}`;

  const staff = db.prepare(`
    SELECT u.id, u.name, uc.employment_type, uc.hourly_wage
    FROM users u JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    ORDER BY u.name
  `).all(companyId) as any[];

  const rows = staff.map(s => {
    const shifts = db.prepare(`
      SELECT start_time, end_time, break_minutes FROM shifts
      WHERE company_id = ? AND user_id = ? AND date LIKE ?
    `).all(companyId, s.id, `${datePrefix}-%`) as any[];

    let totalMinutes = 0;
    for (const sh of shifts) {
      const [sH, sM] = sh.start_time.split(':').map(Number);
      const [eH, eM] = sh.end_time.split(':').map(Number);
      totalMinutes += Math.max(0, eH * 60 + eM - sH * 60 - sM - (sh.break_minutes || 0));
    }
    const hours = totalMinutes / 60;
    const cost = Math.round(hours * (s.hourly_wage || 0));
    const overtime = Math.max(0, hours - 160);

    return [s.name, s.employment_type === 'full_time' ? '正社員' : 'パート', s.hourly_wage, shifts.length, hours.toFixed(1), overtime.toFixed(1), cost];
  });

  const csv = toCsv(
    ['スタッフ名', '雇用形態', '時給', 'シフト数', '合計時間', '残業時間', '人件費概算'],
    rows
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="summary_${datePrefix}.csv"`);
  res.send(csv);
});

export default router;
