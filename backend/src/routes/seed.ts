import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';

const router = Router();

const DEMO_STAFF = [
  { name: 'デモ太郎', pin: '1001', hourly_wage: 1100, employment_type: 'パート' },
  { name: 'デモ花子', pin: '1002', hourly_wage: 1200, employment_type: 'アルバイト' },
  { name: 'デモ次郎', pin: '1003', hourly_wage: 1300, employment_type: '正社員' },
  { name: 'デモ美咲', pin: '1004', hourly_wage: 1050, employment_type: 'パート' },
];
const DEMO_SKILLS = [
  { name: '新人教育', color: '#3B82F6' },
  { name: 'レジ担当', color: '#10B981' },
  { name: '閉店できる', color: '#F59E0B' },
];

// POST /api/seed/demo - 自分の会社にサンプルデータを一括投入
// body: { include_store?, include_staff?, include_shifts?, include_skills? }
router.post('/demo', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!['admin', 'super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const { include_store = true, include_staff = true, include_shifts = true, include_skills = true } = req.body;

  const created = { store: 0, staff: 0, skills: 0, shifts: 0 };
  const txn = db.transaction(() => {
    // 店舗: 未作成のときだけ追加
    if (include_store) {
      const count = (db.prepare('SELECT COUNT(*) as c FROM stores WHERE company_id = ?').get(companyId) as any).c;
      if (count === 0) {
        db.prepare('INSERT INTO stores (company_id, name, address, phone) VALUES (?, ?, ?, ?)')
          .run(companyId, 'デモ店舗', '東京都○○区1-2-3', '03-1234-5678');
        created.store = 1;
      }
    }

    const staffIds: number[] = [];
    if (include_staff) {
      for (const s of DEMO_STAFF) {
        // 同名の未登録スタッフのみ追加
        const existing = db.prepare('SELECT u.id FROM users u JOIN user_companies uc ON uc.user_id=u.id WHERE u.name = ? AND uc.company_id = ?').get(s.name, companyId) as any;
        if (existing) { staffIds.push(existing.id); continue; }
        const pw = bcrypt.hashSync(Math.random().toString(36).slice(2, 12), 10);
        const r = db.prepare('INSERT INTO users (email, password, name, pin, role) VALUES (?, ?, ?, ?, ?)').run(null, pw, s.name, s.pin, 'staff');
        const uid = Number(r.lastInsertRowid);
        db.prepare('INSERT OR IGNORE INTO user_companies (user_id, company_id, role, hourly_wage, employment_type) VALUES (?, ?, ?, ?, ?)')
          .run(uid, companyId, 'staff', s.hourly_wage, s.employment_type);
        staffIds.push(uid);
        created.staff++;
      }
    }

    if (include_skills) {
      for (const sk of DEMO_SKILLS) {
        try {
          db.prepare('INSERT INTO skills (company_id, name, color) VALUES (?, ?, ?)').run(companyId, sk.name, sk.color);
          created.skills++;
        } catch { /* UNIQUE violation, skip */ }
      }
    }

    if (include_shifts && staffIds.length > 0) {
      // 今週の平日に各スタッフのシフトを 9-17 で追加
      const today = new Date();
      const start = new Date(today); start.setDate(today.getDate() - today.getDay() + 1); // 月曜日
      for (let i = 0; i < 7; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue; // 土日スキップ
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        // 各日2名ずつ交代で割当
        const picks = [staffIds[i % staffIds.length], staffIds[(i + 1) % staffIds.length]];
        for (const uid of picks) {
          const dup = db.prepare('SELECT id FROM shifts WHERE company_id = ? AND user_id = ? AND date = ? AND start_time = ?').get(companyId, uid, dateStr, '09:00');
          if (dup) continue;
          db.prepare('INSERT INTO shifts (company_id, user_id, date, start_time, end_time, break_minutes, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(companyId, uid, dateStr, '09:00', '17:00', 60, 'confirmed');
          created.shifts++;
        }
      }
    }
  });

  try {
    txn();
    logAudit({ userId: req.user!.id, companyId, action: 'bulk_import', entity: 'demo_seed', summary: `デモデータ投入: 店舗${created.store}/スタッフ${created.staff}/スキル${created.skills}/シフト${created.shifts}` });
    res.json({ ok: true, created });
  } catch (e: any) {
    res.status(500).json({ error: 'デモデータ投入に失敗: ' + e.message });
  }
});

// DELETE /api/seed/demo - デモデータのみを削除（会社そのものは残す）
router.delete('/demo', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!['admin', 'super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const names = DEMO_STAFF.map(s => s.name);
  const skillNames = DEMO_SKILLS.map(s => s.name);

  const removed = { staff: 0, skills: 0, store: 0, shifts: 0 };
  const txn = db.transaction(() => {
    // デモスタッフとそのシフトを削除
    const stmt = db.prepare('SELECT u.id FROM users u JOIN user_companies uc ON uc.user_id = u.id WHERE u.name = ? AND uc.company_id = ?');
    for (const name of names) {
      const u = stmt.get(name, companyId) as any;
      if (!u) continue;
      const sr = db.prepare('DELETE FROM shifts WHERE company_id = ? AND user_id = ?').run(companyId, u.id);
      removed.shifts += sr.changes;
      db.prepare('DELETE FROM user_companies WHERE user_id = ? AND company_id = ?').run(u.id, companyId);
      // 他の会社にいなければユーザー自体も削除
      const other = db.prepare('SELECT 1 FROM user_companies WHERE user_id = ?').get(u.id);
      if (!other) db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      removed.staff++;
    }
    for (const sn of skillNames) {
      const r = db.prepare('DELETE FROM skills WHERE company_id = ? AND name = ?').run(companyId, sn);
      removed.skills += r.changes;
    }
    const sr = db.prepare("DELETE FROM stores WHERE company_id = ? AND name = 'デモ店舗'").run(companyId);
    removed.store = sr.changes;
  });
  txn();
  logAudit({ userId: req.user!.id, companyId, action: 'delete', entity: 'demo_seed', summary: `デモデータ削除: 店舗${removed.store}/スタッフ${removed.staff}/スキル${removed.skills}/シフト${removed.shifts}` });
  res.json({ ok: true, removed });
});

export default router;
