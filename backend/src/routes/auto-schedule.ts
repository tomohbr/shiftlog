import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';

const router = Router();

// POST /api/auto-schedule/propose
// body: { year, month, slots: [{ date, start_time, end_time, needed: number, skill_ids?: number[] }] }
// シフト希望を尊重しつつ、各スロットに needed 人を割り当てる greedy 算法
router.post('/propose', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!['admin','super_admin'].includes(req.user!.role) && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const companyId = req.companyId!;
  const { year, month, slots } = req.body;
  if (!year || !month || !Array.isArray(slots) || slots.length === 0) {
    res.status(400).json({ error: 'year, month, slots が必要です' });
    return;
  }

  const datePrefix = `${year}-${String(Number(month)).padStart(2, '0')}`;

  // 1) 会社のスタッフと希望シフトをロード
  const staff = db.prepare(`
    SELECT u.id, u.name, uc.hourly_wage
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    WHERE u.is_active = 1 AND u.role = 'staff'
  `).all(companyId) as any[];

  const requests = db.prepare(`
    SELECT user_id, date, availability
    FROM shift_requests
    WHERE company_id = ? AND date LIKE ?
  `).all(companyId, `${datePrefix}-%`) as any[];

  const reqByUserDate = new Map<string, string>();
  for (const r of requests) reqByUserDate.set(`${r.user_id}:${r.date}`, r.availability);

  // 2) 既存シフト負荷（週ごとの勤務時間で過労を避ける）
  const assignedHoursByUser = new Map<number, number>();
  for (const s of staff) assignedHoursByUser.set(s.id, 0);

  // 3) スキル要件
  const skillMap = new Map<number, number[]>(); // user_id -> skill_ids[]
  const userSkills = db.prepare(`
    SELECT us.user_id, us.skill_id FROM user_skills us
    JOIN skills s ON s.id = us.skill_id WHERE s.company_id = ?
  `).all(companyId) as any[];
  for (const row of userSkills) {
    if (!skillMap.has(row.user_id)) skillMap.set(row.user_id, []);
    skillMap.get(row.user_id)!.push(row.skill_id);
  }

  // 4) 各スロットに割当
  const assignments: any[] = [];
  const unfilled: any[] = [];

  for (const slot of slots) {
    const { date, start_time, end_time, needed, skill_ids } = slot;
    if (!date || !start_time || !end_time) continue;
    const n = Number(needed) || 1;

    // 候補: スキル充足＋希望シフトで出勤不可でない人
    const candidates = staff.filter(s => {
      const av = reqByUserDate.get(`${s.id}:${date}`);
      if (av === 'unavailable') return false;
      if (Array.isArray(skill_ids) && skill_ids.length > 0) {
        const mySkills = skillMap.get(s.id) || [];
        const hasAll = skill_ids.every((sid: number) => mySkills.includes(sid));
        if (!hasAll) return false;
      }
      return true;
    });

    // スコア: preferred > available > undefined > (unavailable は除外済)
    // 過労ペナルティ: 既に割当時間が多い人の優先度を下げる
    candidates.sort((a, b) => {
      const avA = reqByUserDate.get(`${a.id}:${date}`) || '';
      const avB = reqByUserDate.get(`${b.id}:${date}`) || '';
      const scoreA = (avA === 'preferred' ? 2 : avA === 'available' ? 1 : 0) - (assignedHoursByUser.get(a.id)! * 0.05);
      const scoreB = (avB === 'preferred' ? 2 : avB === 'available' ? 1 : 0) - (assignedHoursByUser.get(b.id)! * 0.05);
      return scoreB - scoreA;
    });

    const picked = candidates.slice(0, n);
    const [sh, sm] = start_time.split(':').map(Number);
    const [eh, em] = end_time.split(':').map(Number);
    const hours = Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
    for (const p of picked) {
      assignedHoursByUser.set(p.id, (assignedHoursByUser.get(p.id) || 0) + hours);
      assignments.push({
        date, start_time, end_time,
        user_id: p.id, user_name: p.name,
        availability: reqByUserDate.get(`${p.id}:${date}`) || null,
      });
    }
    if (picked.length < n) {
      unfilled.push({ date, start_time, end_time, needed: n, assigned: picked.length });
    }
  }

  res.json({ assignments, unfilled });
});

// POST /api/auto-schedule/apply - 提案をそのまま shifts テーブルに反映
router.post('/apply', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!['admin','super_admin'].includes(req.user!.role) && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const { assignments } = req.body as { assignments: Array<{ date: string; start_time: string; end_time: string; user_id: number; break_minutes?: number; notes?: string }> };
  if (!Array.isArray(assignments) || assignments.length === 0) {
    res.status(400).json({ error: 'assignments が必要です' });
    return;
  }

  let created = 0;
  let skipped = 0;
  const txn = db.transaction(() => {
    for (const a of assignments) {
      // 重複チェック
      const exists = db.prepare(
        'SELECT id FROM shifts WHERE company_id = ? AND user_id = ? AND date = ? AND start_time = ? AND end_time = ?'
      ).get(companyId, a.user_id, a.date, a.start_time, a.end_time);
      if (exists) { skipped++; continue; }
      db.prepare(
        'INSERT INTO shifts (company_id, user_id, date, start_time, end_time, break_minutes, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(companyId, a.user_id, a.date, a.start_time, a.end_time, a.break_minutes || 0, a.notes || null, 'confirmed');
      created++;
    }
  });
  txn();
  logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'shift', summary: `自動生成でシフト ${created} 件を作成（スキップ: ${skipped}）` });
  res.json({ created, skipped });
});

export default router;
