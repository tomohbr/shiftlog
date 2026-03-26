import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/labor/costs?year=2026&month=3 - Labor cost calculation
router.get('/costs', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;
  const datePrefix = `${year}-${String(Number(month as string)).padStart(2, '0')}`;

  // Get shifts with hourly wages
  const shifts = db.prepare(`
    SELECT s.date, s.start_time, s.end_time, s.break_minutes, uc.hourly_wage, u.name as user_name
    FROM shifts s
    JOIN user_companies uc ON uc.user_id = s.user_id AND uc.company_id = s.company_id
    JOIN users u ON u.id = s.user_id
    WHERE s.company_id = ? AND s.date LIKE ?
  `).all(companyId, `${datePrefix}-%`) as any[];

  let totalCost = 0;
  const dailyCosts: Record<string, number> = {};
  const weeklyCosts: Record<string, number> = {};

  for (const shift of shifts) {
    const [sh, sm] = shift.start_time.split(':').map(Number);
    const [eh, em] = shift.end_time.split(':').map(Number);
    const hours = Math.max(0, (eh * 60 + em - sh * 60 - sm - (shift.break_minutes || 0)) / 60);
    const cost = Math.round(hours * (shift.hourly_wage || 0));

    totalCost += cost;
    dailyCosts[shift.date] = (dailyCosts[shift.date] || 0) + cost;

    // Week number
    const d = new Date(shift.date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];
    weeklyCosts[weekKey] = (weeklyCosts[weekKey] || 0) + cost;
  }

  res.json({ totalCost, dailyCosts, weeklyCosts, shiftCount: shifts.length });
});

// GET /api/labor/alerts?year=2026&month=3 - Labor law alerts
router.get('/alerts', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;
  const datePrefix = `${year}-${String(Number(month as string)).padStart(2, '0')}`;

  const shifts = db.prepare(`
    SELECT s.user_id, u.name as user_name, s.date, s.start_time, s.end_time, s.break_minutes
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    WHERE s.company_id = ? AND s.date LIKE ?
    ORDER BY s.user_id, s.date
  `).all(companyId, `${datePrefix}-%`) as any[];

  const alerts: any[] = [];

  // Group by user
  const byUser: Record<number, any[]> = {};
  for (const s of shifts) {
    if (!byUser[s.user_id]) byUser[s.user_id] = [];
    byUser[s.user_id].push(s);
  }

  for (const [userId, userShifts] of Object.entries(byUser)) {
    const userName = userShifts[0].user_name;
    const dates = userShifts.map(s => s.date).sort();

    // 連勤チェック (6日以上)
    let consecutive = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays === 1) {
        consecutive++;
        if (consecutive >= 6) {
          alerts.push({
            type: 'consecutive',
            severity: consecutive >= 7 ? 'error' : 'warning',
            user_id: Number(userId),
            user_name: userName,
            message: `${userName}: ${consecutive}日連勤（${dates[i - consecutive + 1]}〜${dates[i]}）`,
            dates: dates.slice(i - consecutive + 1, i + 1),
          });
        }
      } else {
        consecutive = 1;
      }
    }

    // 週40時間チェック
    const weeklyHours: Record<string, number> = {};
    for (const s of userShifts) {
      const d = new Date(s.date);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      const [sh, sm] = s.start_time.split(':').map(Number);
      const [eh, em] = s.end_time.split(':').map(Number);
      const hours = Math.max(0, (eh * 60 + em - sh * 60 - sm - (s.break_minutes || 0)) / 60);
      weeklyHours[weekKey] = (weeklyHours[weekKey] || 0) + hours;
    }

    for (const [week, hours] of Object.entries(weeklyHours)) {
      if (hours > 40) {
        alerts.push({
          type: 'weekly_overtime',
          severity: hours > 45 ? 'error' : 'warning',
          user_id: Number(userId),
          user_name: userName,
          message: `${userName}: 週${hours.toFixed(1)}時間勤務（${week}週）- 40時間超過`,
          week,
          hours,
        });
      }
    }

    // 月間残業チェック (160時間基準)
    let monthlyHours = 0;
    for (const s of userShifts) {
      const [sh, sm] = s.start_time.split(':').map(Number);
      const [eh, em] = s.end_time.split(':').map(Number);
      monthlyHours += Math.max(0, (eh * 60 + em - sh * 60 - sm - (s.break_minutes || 0)) / 60);
    }
    if (monthlyHours > 160) {
      alerts.push({
        type: 'monthly_overtime',
        severity: monthlyHours > 180 ? 'error' : 'warning',
        user_id: Number(userId),
        user_name: userName,
        message: `${userName}: 月間${monthlyHours.toFixed(1)}時間（160時間超過）`,
        hours: monthlyHours,
      });
    }
  }

  res.json({ alerts });
});

// GET /api/labor/ratio?year=2026&month=3 - Labor cost ratio
router.get('/ratio', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;
  const datePrefix = `${year}-${String(Number(month as string)).padStart(2, '0')}`;

  // Get labor costs
  const shifts = db.prepare(`
    SELECT s.date, s.start_time, s.end_time, s.break_minutes, uc.hourly_wage
    FROM shifts s
    JOIN user_companies uc ON uc.user_id = s.user_id AND uc.company_id = s.company_id
    WHERE s.company_id = ? AND s.date LIKE ?
  `).all(companyId, `${datePrefix}-%`) as any[];

  const dailyLaborCosts: Record<string, number> = {};
  let totalLaborCost = 0;
  for (const s of shifts) {
    const [sh, sm] = s.start_time.split(':').map(Number);
    const [eh, em] = s.end_time.split(':').map(Number);
    const hours = Math.max(0, (eh * 60 + em - sh * 60 - sm - (s.break_minutes || 0)) / 60);
    const cost = Math.round(hours * (s.hourly_wage || 0));
    dailyLaborCosts[s.date] = (dailyLaborCosts[s.date] || 0) + cost;
    totalLaborCost += cost;
  }

  // Get sales
  const sales = db.prepare(`
    SELECT date, amount FROM daily_sales
    WHERE company_id = ? AND date LIKE ?
  `).all(companyId, `${datePrefix}-%`) as any[];

  let totalSales = 0;
  const dailySales: Record<string, number> = {};
  for (const s of sales) {
    dailySales[s.date] = s.amount;
    totalSales += s.amount;
  }

  const ratio = totalSales > 0 ? Math.round((totalLaborCost / totalSales) * 1000) / 10 : 0;

  res.json({
    totalLaborCost,
    totalSales,
    ratio,
    daily: Object.keys({ ...dailyLaborCosts, ...dailySales }).sort().map(date => ({
      date,
      laborCost: dailyLaborCosts[date] || 0,
      sales: dailySales[date] || 0,
      ratio: (dailySales[date] || 0) > 0 ? Math.round(((dailyLaborCosts[date] || 0) / dailySales[date]) * 1000) / 10 : 0,
    })),
  });
});

// POST /api/labor/sales - Upsert daily sales
router.post('/sales', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const { date, amount, notes } = req.body;

  db.prepare(`
    INSERT INTO daily_sales (company_id, date, amount, notes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(company_id, date) DO UPDATE SET
      amount = excluded.amount, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP
  `).run(companyId, date, amount, notes || null);

  res.json({ message: '売上を保存しました' });
});

// GET /api/labor/sales?year=2026&month=3
router.get('/sales', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month } = req.query;
  const sales = db.prepare(
    `SELECT * FROM daily_sales WHERE company_id = ? AND date LIKE ? ORDER BY date`
  ).all(companyId, `${year}-${String(Number(month as string)).padStart(2, '0')}-%`);
  res.json({ sales });
});

export default router;
