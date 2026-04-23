import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';

const router = Router();

// Helper: CSV文字列を生成 (BOM付きUTF-8で日本の給与ソフトが文字化けしないように)
function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [headers.join(','), ...rows.map(r => r.map(escape).join(','))];
  return '\uFEFF' + lines.join('\r\n'); // BOM
}

interface WorkSummary {
  user_id: number;
  user_name: string;
  email: string | null;
  employee_code: string | null;
  days: number;
  total_minutes: number;
  night_minutes: number;
  overtime_minutes: number; // 8h/日 超過
  holiday_minutes: number;
  total_wage: number;
  hourly_wage: number;
}

function summarize(companyId: number, year: number, month: number): WorkSummary[] {
  const datePrefix = `${year}-${String(month).padStart(2, '0')}`;
  const shifts = db.prepare(`
    SELECT s.*, u.id as uid, u.name, u.email, uc.hourly_wage
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = s.company_id
    WHERE s.company_id = ? AND s.date LIKE ?
  `).all(companyId, `${datePrefix}-%`) as any[];

  const byUser = new Map<number, WorkSummary>();
  for (const s of shifts) {
    const [sh, sm] = s.start_time.split(':').map(Number);
    const [eh, em] = s.end_time.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm) - (s.break_minutes || 0);
    if (mins < 0) mins += 24 * 60; // 翌日跨ぎ
    if (mins < 0) mins = 0;

    // 深夜勤務(22:00-翌5:00)
    let nightMins = 0;
    const startMin = sh * 60 + sm;
    const endMin = startMin + mins;
    for (let t = startMin; t < endMin; t++) {
      const h = Math.floor(t / 60) % 24;
      if (h >= 22 || h < 5) nightMins++;
    }

    // 日次残業 8h超
    const overtimeMins = Math.max(0, mins - 8 * 60);

    // 休日（土日）判定
    const d = new Date(s.date);
    const holidayMins = (d.getDay() === 0 || d.getDay() === 6) ? mins : 0;

    if (!byUser.has(s.uid)) {
      byUser.set(s.uid, {
        user_id: s.uid,
        user_name: s.name,
        email: s.email,
        employee_code: null,
        days: 0,
        total_minutes: 0,
        night_minutes: 0,
        overtime_minutes: 0,
        holiday_minutes: 0,
        total_wage: 0,
        hourly_wage: s.hourly_wage || 0,
      });
    }
    const summary = byUser.get(s.uid)!;
    summary.days++;
    summary.total_minutes += mins;
    summary.night_minutes += nightMins;
    summary.overtime_minutes += overtimeMins;
    summary.holiday_minutes += holidayMins;
    summary.total_wage += Math.round((mins / 60) * (s.hourly_wage || 0));
  }
  return Array.from(byUser.values()).sort((a, b) => b.total_minutes - a.total_minutes);
}

// GET /api/payroll/export?year=&month=&format=freee|moneyforward|kingoftime|generic
router.get('/export', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  const format = String(req.query.format || 'generic');

  const summaries = summarize(companyId, year, month);

  let csv = '';
  let filename = `payroll-${year}-${String(month).padStart(2, '0')}.csv`;

  const hours = (m: number) => (m / 60).toFixed(2);

  switch (format) {
    case 'freee': {
      // freee 人事労務の勤怠インポート形式（簡易版）
      const headers = ['氏名', 'メールアドレス', '勤務日数', '総労働時間', '所定外労働時間', '深夜労働時間', '休日労働時間'];
      const rows = summaries.map(s => [s.user_name, s.email || '', s.days, hours(s.total_minutes), hours(s.overtime_minutes), hours(s.night_minutes), hours(s.holiday_minutes)]);
      csv = toCsv(headers, rows);
      filename = `freee-attendance-${year}-${String(month).padStart(2, '0')}.csv`;
      break;
    }
    case 'moneyforward': {
      const headers = ['社員名', 'メール', '出勤日数', '総労働時間', '残業時間', '深夜時間', '休日労働時間', '基本給'];
      const rows = summaries.map(s => [s.user_name, s.email || '', s.days, hours(s.total_minutes), hours(s.overtime_minutes), hours(s.night_minutes), hours(s.holiday_minutes), s.total_wage]);
      csv = toCsv(headers, rows);
      filename = `mf-attendance-${year}-${String(month).padStart(2, '0')}.csv`;
      break;
    }
    case 'kingoftime': {
      // KING OF TIME 簡易エクスポート
      const headers = ['従業員コード', '従業員名', '勤務日数', '勤務時間合計', '法定外残業', '深夜', '休日'];
      const rows = summaries.map(s => [s.user_id, s.user_name, s.days, hours(s.total_minutes), hours(s.overtime_minutes), hours(s.night_minutes), hours(s.holiday_minutes)]);
      csv = toCsv(headers, rows);
      filename = `kot-${year}-${String(month).padStart(2, '0')}.csv`;
      break;
    }
    default: {
      // generic
      const headers = ['ユーザーID', '氏名', 'メール', '時給', '勤務日数', '総労働時間(h)', '法定外残業(h)', '深夜労働(h)', '休日労働(h)', '概算給与(円)'];
      const rows = summaries.map(s => [s.user_id, s.user_name, s.email || '', s.hourly_wage, s.days, hours(s.total_minutes), hours(s.overtime_minutes), hours(s.night_minutes), hours(s.holiday_minutes), s.total_wage]);
      csv = toCsv(headers, rows);
      break;
    }
  }

  logAudit({ userId: req.user!.id, companyId, action: 'export', entity: 'payroll', summary: `${year}年${month}月の給与データを ${format} 形式で出力` });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// GET /api/payroll/summary?year=&month= (プレビュー用JSON)
router.get('/summary', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  res.json({ summaries: summarize(companyId, year, month), year, month });
});

export default router;
