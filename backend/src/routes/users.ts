import { canSeeWages, hideWages } from '../utils/wages';
import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { autoDisplayName } from '../utils/displayName';
import { FREE_STAFF_LIMIT, canAddStaff, hasProAccess, sendUpgradeRequired } from '../utils/billing';

const router = Router();

function isAdmin(role?: string) {
  return role === 'admin' || role === 'super_admin';
}

// POST /api/users/bulk - CSV一括インポート
// body: { rows: [{name, email?, pin?, hourly_wage?, employment_type?, phone?}] }
router.post('/bulk', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req.user?.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const companyId = req.companyId!;
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'rows (配列) が必要です' });
    return;
  }
  if (rows.length > 500) {
    res.status(400).json({ error: '一度に登録できるのは500件までです' });
    return;
  }
  if (!canAddStaff(companyId, rows.length)) {
    sendUpgradeRequired(res, `スタッフ${FREE_STAFF_LIMIT + 1}名以上の登録`);
    return;
  }

  const results: Array<{ row: number; status: 'created' | 'skipped' | 'error'; message?: string; user_id?: number }> = [];
  const txn = db.transaction(() => {
    rows.forEach((row: any, idx: number) => {
      const name = (row.name || '').toString().trim();
      if (!name) {
        results.push({ row: idx + 1, status: 'error', message: '氏名が空です' });
        return;
      }
      const email = row.email ? String(row.email).trim().toLowerCase() : null;
      const pin = hasProAccess(companyId) && row.pin ? String(row.pin).trim() : null;
      const hourlyWage = row.hourly_wage != null && canSeeWages(req) ? Number(row.hourly_wage) : 0;
      const employmentType = row.employment_type || 'パート';
      const phone = row.phone ? String(row.phone).trim() : null;

      // 重複チェック（同一会社内で同名+同PINがあればスキップ）
      let existingUserId: number | null = null;
      if (email) {
        const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any;
        if (u) existingUserId = u.id;
      }
      if (existingUserId) {
        const uc = db.prepare('SELECT 1 FROM user_companies WHERE user_id = ? AND company_id = ?').get(existingUserId, companyId);
        if (uc) {
          results.push({ row: idx + 1, status: 'skipped', message: '既に会社に登録済みです', user_id: existingUserId });
          return;
        }
      }

      let userId: number;
      if (existingUserId) {
        userId = existingUserId;
      } else {
        const defaultPassword = bcrypt.hashSync(Math.random().toString(36).slice(2, 12), 10);
        const r = db.prepare('INSERT INTO users (email, password, name, pin, role) VALUES (?, ?, ?, ?, ?)').run(email, defaultPassword, name, pin, 'staff');
        userId = Number(r.lastInsertRowid);
      }

      db.prepare(`
        INSERT OR IGNORE INTO user_companies (user_id, company_id, role, hourly_wage, employment_type, phone)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, companyId, 'staff', hourlyWage, employmentType, phone);

      results.push({ row: idx + 1, status: 'created', user_id: userId });
    });
  });

  try {
    txn();
    logAudit({ userId: req.user!.id, companyId, action: 'bulk_import', entity: 'user', summary: `${results.filter(r => r.status === 'created').length} 名をCSV一括登録` });
    res.json({ results });
  } catch (e: any) {
    res.status(500).json({ error: '一括インポートに失敗しました: ' + e.message });
  }
});

// GET /api/users - Get all users for the selected company
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  const users = db.prepare(`
    SELECT u.id, u.email, u.name, u.furigana, u.pin, u.role, u.is_active, u.created_at,
           uc.color, uc.hourly_wage, uc.phone, uc.role as company_role,
           uc.employment_type, uc.display_name, uc.sort_order, uc.can_see_wages, uc.wage_exempt, uc.line_watch,
           (SELECT MAX(tr.updated_at) FROM time_records tr WHERE tr.user_id = u.id AND tr.company_id = ?) as last_timecard_at,
           (SELECT COUNT(*) FROM time_records tr WHERE tr.user_id = u.id AND tr.company_id = ?) as timecard_count
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    WHERE u.is_active = 1
    ORDER BY uc.sort_order IS NULL, uc.sort_order, u.role DESC, u.name ASC
  `).all(companyId, companyId, companyId) as any[];

  // スタッフには名前と色だけ返す（時給・電話・メール・打刻用PINなどは管理者だけ）
  const isAdmin = ['admin', 'super_admin'].includes(req.user!.role) ||
    (db.prepare('SELECT role FROM user_companies WHERE user_id = ? AND company_id = ?').get(req.user!.id, companyId) as any)?.role === 'admin';
  if (!isAdmin) {
    res.json({ users: users.map(u => ({ id: u.id, name: u.name, role: u.role, company_role: u.company_role, color: u.color, is_active: u.is_active, display_name: u.display_name, sort_order: u.sort_order })) });
    return;
  }

  // 時給は「見られる人」だけ（店長などの管理者にも出さない）
  res.json({ users: hideWages(users, req), can_see_wages: canSeeWages(req) });
});

// GET /api/users/:id
router.get('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = parseInt(req.params.id);

  if (!['admin','super_admin'].includes(req.user!.role) && req.user!.id !== userId) {
    res.status(403).json({ error: 'アクセス権限がありません' });
    return;
  }

  const user = db.prepare(`
    SELECT u.id, u.email, u.name, u.furigana, u.pin, u.role, u.is_active, u.created_at,
           uc.color, uc.hourly_wage, uc.phone, uc.role as company_role,
           uc.employment_type
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    WHERE u.id = ?
  `).get(companyId, userId);

  if (!user) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  // スタッフは自分の時給も見られない
  res.json({ user: hideWages([user as any], req)[0] });
});

// POST /api/users - Create new staff in company
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (!['admin','super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const { email, password, name, pin, role, color, hourly_wage, phone, employment_type } = req.body;
  const staffPin = hasProAccess(companyId) ? (pin || null) : null;

  if (!name) {
    res.status(400).json({ error: '名前を入力してください' });
    return;
  }
  if ((role || 'staff') !== 'admin' && !canAddStaff(companyId, 1)) {
    sendUpgradeRequired(res, `スタッフ${FREE_STAFF_LIMIT + 1}名以上の登録`);
    return;
  }

  // Check if user already exists (by email if provided)
  let existing: any = null;
  if (email) {
    existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any;
  }

  let userId: number;

  if (existing) {
    const alreadyInCompany = db.prepare(
      'SELECT id FROM user_companies WHERE user_id = ? AND company_id = ?'
    ).get(existing.id, companyId);

    if (alreadyInCompany) {
      res.status(409).json({ error: 'このスタッフは既にこの会社に所属しています' });
      return;
    }

    userId = existing.id;
  } else {
    const hash = password ? bcrypt.hashSync(password, 10) : null;
    const result = db.prepare(
      'INSERT INTO users (email, password, name, pin, role) VALUES (?, ?, ?, ?, ?)'
    ).run(email || null, hash, name, staffPin, role || 'staff');
    userId = result.lastInsertRowid as number;
  }

  // Link to company
  try {
    db.prepare(
      'INSERT INTO user_companies (user_id, company_id, role, employment_type, color, hourly_wage, phone) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, companyId, role || 'staff', employment_type || 'part_time', color || '#4A90E2', canSeeWages(req) ? (hourly_wage || 0) : 0, phone || null);
  } catch (err: any) {
    res.status(400).json({ error: 'スタッフの追加に失敗しました' });
    return;
  }
  // 呼び名（下の名前）を使っている会社なら、新しい人にも入れる（スタッフだけ）
  if ((role || 'staff') === 'staff' && !req.body.display_name) autoDisplayName(companyId, Number(userId), name);

  const user = db.prepare(`
    SELECT u.id, u.email, u.name, u.furigana, u.pin, u.role, u.is_active, u.created_at,
           uc.color, uc.hourly_wage, uc.phone, uc.role as company_role,
           uc.employment_type
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    WHERE u.id = ?
  `).get(companyId, userId);

  res.status(201).json({ user: hideWages([user as any], req)[0] });
});

// PUT /api/users/:id
router.put('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = parseInt(req.params.id);

  if (!['admin','super_admin'].includes(req.user!.role) && req.user!.id !== userId) {
    res.status(403).json({ error: 'アクセス権限がありません' });
    return;
  }

  const uc = db.prepare(
    'SELECT * FROM user_companies WHERE user_id = ? AND company_id = ?'
  ).get(userId, companyId) as any;
  if (!uc) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  const { name, email, password, pin, color, phone, role, employment_type, furigana, display_name, sort_order, can_see_wages, wage_exempt, line_watch } = req.body;
  // 時給を変えられるのは「時給を見られる人」だけ（本人・ほかの管理者からは変えられない）
  const wageOk = canSeeWages(req);
  const hourly_wage = wageOk ? req.body.hourly_wage : undefined;
  if (furigana !== undefined) db.prepare('UPDATE users SET furigana = ? WHERE id = ?').run(String(furigana || '').trim() || null, parseInt(req.params.id));
  const staffPin = hasProAccess(companyId) ? pin : undefined;

  // Update user table
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (name !== undefined || email !== undefined || staffPin !== undefined || role !== undefined) {
    db.prepare(
      'UPDATE users SET name = ?, email = ?, pin = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(name !== undefined ? name : user.name, email !== undefined ? email : user.email, staffPin !== undefined ? staffPin : user.pin, role !== undefined ? role : user.role, userId);
  }

  // Update password if provided
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, userId);
  }

  // Update company-specific data
  // 役割と雇用形態を変えられるのは管理者（スーパー管理者を含む）だけ
  const canManage = ['admin', 'super_admin'].includes(req.user!.role);
  const newRole = canManage ? (role || uc.role) : uc.role;
  const newEmploymentType = canManage ? (employment_type || uc.employment_type) : uc.employment_type;
  db.prepare(
    'UPDATE user_companies SET color = ?, hourly_wage = ?, phone = ?, role = ?, employment_type = ? WHERE user_id = ? AND company_id = ?'
  ).run(
    color || uc.color,
    hourly_wage !== undefined ? hourly_wage : uc.hourly_wage,
    phone !== undefined ? phone : uc.phone,
    newRole,
    newEmploymentType,
    userId, companyId
  );
  // 呼び名と並び順も管理者だけ（空にすると氏名・並び順なしに戻る）
  if (canManage && display_name !== undefined) {
    db.prepare('UPDATE user_companies SET display_name = ? WHERE user_id = ? AND company_id = ?').run(String(display_name || '').trim().slice(0, 20) || null, userId, companyId);
  }
  if (canManage && req.body.is_minor !== undefined) {
    db.prepare('UPDATE user_companies SET is_minor = ? WHERE user_id = ? AND company_id = ?').run(req.body.is_minor ? 1 : 0, userId, companyId);
  }
  if (canManage && sort_order !== undefined) {
    const n = sort_order === null || sort_order === '' ? null : Math.trunc(Number(sort_order));
    db.prepare('UPDATE user_companies SET sort_order = ? WHERE user_id = ? AND company_id = ?').run(n !== null && Number.isFinite(n) ? n : null, userId, companyId);
  }
  // 「時給を見られる」を付け外しできるのも、時給を見られる人だけ
  if (canManage && line_watch !== undefined) {
    db.prepare('UPDATE user_companies SET line_watch = ? WHERE user_id = ? AND company_id = ?').run(line_watch ? 1 : 0, userId, companyId);
  }
  if (wageOk && wage_exempt !== undefined) {
    db.prepare('UPDATE user_companies SET wage_exempt = ? WHERE user_id = ? AND company_id = ?').run(wage_exempt ? 1 : 0, userId, companyId);
  }
  if (wageOk && can_see_wages !== undefined) {
    db.prepare('UPDATE user_companies SET can_see_wages = ? WHERE user_id = ? AND company_id = ?').run(can_see_wages ? 1 : 0, userId, companyId);
  }

  const updated = db.prepare(`
    SELECT u.id, u.email, u.name, u.furigana, u.pin, u.role, u.is_active, u.created_at,
           uc.color, uc.hourly_wage, uc.phone, uc.role as company_role,
           uc.employment_type, uc.display_name, uc.sort_order, uc.can_see_wages, uc.wage_exempt
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    WHERE u.id = ?
  `).get(companyId, userId);

  res.json({ user: hideWages([updated as any], req)[0] });
});

// DELETE /api/users/:id (remove from company)
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = parseInt(req.params.id);

  if (!['admin','super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  if (req.user!.id === userId) {
    res.status(400).json({ error: '自分自身を削除することはできません' });
    return;
  }

  const uc = db.prepare(
    'SELECT * FROM user_companies WHERE user_id = ? AND company_id = ?'
  ).get(userId, companyId);
  if (!uc) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  // Remove from company (not delete user entirely)
  db.prepare('DELETE FROM user_companies WHERE user_id = ? AND company_id = ?').run(userId, companyId);
  res.json({ message: 'スタッフをこの会社から削除しました' });
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = parseInt(req.params.id);

  if (!['admin','super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const { newPassword } = req.body;
  if (!newPassword) {
    res.status(400).json({ error: '新しいパスワードを入力してください' });
    return;
  }

  const uc = db.prepare(
    'SELECT * FROM user_companies WHERE user_id = ? AND company_id = ?'
  ).get(userId, companyId);
  if (!uc) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, userId);
  res.json({ message: 'パスワードをリセットしました' });
});

export default router;
