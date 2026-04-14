import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db, { SUPER_ADMIN_EMAIL } from '../db';
import { JWT_SECRET, authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/auth/login
router.post('/login', (req: Request, res: Response): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email) as any;

  if (!user) {
    res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
    return;
  }

  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) {
    res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
    return;
  }

  // Get companies this user belongs to
  const companies = db.prepare(`
    SELECT c.id, c.name, uc.role as company_role
    FROM user_companies uc
    JOIN companies c ON uc.company_id = c.id
    WHERE uc.user_id = ?
  `).all(user.id);

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '90d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    companies,
  });
});

// POST /api/auth/kiosk - 会社PINでスタッフ一覧を取得（認証不要）
router.post('/kiosk', (req: Request, res: Response): void => {
  const { companyPin } = req.body;

  if (!companyPin) {
    res.status(400).json({ error: '会社PINを入力してください' });
    return;
  }

  const company = db.prepare('SELECT id, name FROM companies WHERE company_pin = ?').get(companyPin) as any;
  if (!company) {
    res.status(401).json({ error: 'PINが正しくありません' });
    return;
  }

  // Get all staff for this company (including admins)
  const staff = db.prepare(`
    SELECT u.id, u.name, u.role, uc.color, uc.employment_type, uc.role as company_role
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    WHERE u.is_active = 1
    ORDER BY u.role DESC, u.name ASC
  `).all(company.id);

  // Get today's time records for this company
  const today = new Date().toISOString().split('T')[0];
  const records = db.prepare(`
    SELECT user_id, clock_in, clock_out, break_start, break_end, status
    FROM time_records
    WHERE company_id = ? AND date = ?
  `).all(company.id, today);

  res.json({ company, staff, todayRecords: records });
});

// POST /api/auth/kiosk-clock - キオスク打刻（PINで認証）
router.post('/kiosk-clock', (req: Request, res: Response): void => {
  const { companyPin, userId, action } = req.body;

  if (!companyPin || !userId || !action) {
    res.status(400).json({ error: 'パラメータが不足しています' });
    return;
  }

  const company = db.prepare('SELECT id FROM companies WHERE company_pin = ?').get(companyPin) as any;
  if (!company) {
    res.status(401).json({ error: 'PINが正しくありません' });
    return;
  }

  // Verify user belongs to this company
  const uc = db.prepare(
    'SELECT * FROM user_companies WHERE user_id = ? AND company_id = ?'
  ).get(userId, company.id);
  if (!uc) {
    res.status(403).json({ error: 'このスタッフは会社に所属していません' });
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toTimeString().slice(0, 5);

  if (action === 'clock-in') {
    // Check if already clocked in today
    const existing = db.prepare(
      'SELECT * FROM time_records WHERE company_id = ? AND user_id = ? AND date = ? AND status = ?'
    ).get(company.id, userId, today, 'open') as any;
    if (existing) {
      res.status(400).json({ error: '既に出勤済みです' });
      return;
    }
    db.prepare(
      'INSERT INTO time_records (company_id, user_id, date, clock_in, status) VALUES (?, ?, ?, ?, ?)'
    ).run(company.id, userId, today, now, 'open');
  } else if (action === 'clock-out') {
    const record = db.prepare(
      'SELECT * FROM time_records WHERE company_id = ? AND user_id = ? AND date = ? AND status = ?'
    ).get(company.id, userId, today, 'open') as any;
    if (!record) {
      res.status(400).json({ error: '出勤記録がありません' });
      return;
    }
    let breakMins = 0;
    if (record.break_start && record.break_end) {
      const bs = record.break_start.split(':').map(Number);
      const be = record.break_end.split(':').map(Number);
      breakMins = (be[0] * 60 + be[1]) - (bs[0] * 60 + bs[1]);
    }
    db.prepare(
      'UPDATE time_records SET clock_out = ?, break_minutes = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(now, breakMins, 'closed', record.id);
  } else if (action === 'break-start') {
    const record = db.prepare(
      'SELECT * FROM time_records WHERE company_id = ? AND user_id = ? AND date = ? AND status = ?'
    ).get(company.id, userId, today, 'open') as any;
    if (!record) {
      res.status(400).json({ error: '出勤記録がありません' });
      return;
    }
    db.prepare('UPDATE time_records SET break_start = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(now, record.id);
  } else if (action === 'break-end') {
    const record = db.prepare(
      'SELECT * FROM time_records WHERE company_id = ? AND user_id = ? AND date = ? AND status = ?'
    ).get(company.id, userId, today, 'open') as any;
    if (!record) {
      res.status(400).json({ error: '出勤記録がありません' });
      return;
    }
    db.prepare('UPDATE time_records SET break_end = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(now, record.id);
  }

  // Return updated records
  const records = db.prepare(
    'SELECT user_id, clock_in, clock_out, break_start, break_end, status FROM time_records WHERE company_id = ? AND date = ?'
  ).all(company.id, today);

  res.json({ ok: true, todayRecords: records });
});

// POST /api/auth/pin-login - 会社PIN + スタッフ選択でログイン（JWT発行）
router.post('/pin-login', (req: Request, res: Response): void => {
  const { companyPin, userId } = req.body;

  if (!companyPin || !userId) {
    res.status(400).json({ error: '会社PINとスタッフを選択してください' });
    return;
  }

  const company = db.prepare('SELECT id, name FROM companies WHERE company_pin = ?').get(companyPin) as any;
  if (!company) {
    res.status(401).json({ error: '会社PINが正しくありません' });
    return;
  }

  // Find user in this company
  const userRow = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, uc.role as company_role
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    WHERE u.id = ? AND u.is_active = 1
  `).get(company.id, userId) as any;

  if (!userRow) {
    res.status(401).json({ error: 'スタッフが見つかりません' });
    return;
  }

  // Get all companies this user belongs to
  const companies = db.prepare(`
    SELECT c.id, c.name, uc.role as company_role
    FROM user_companies uc
    JOIN companies c ON uc.company_id = c.id
    WHERE uc.user_id = ?
  `).all(userRow.id);

  const token = jwt.sign(
    { id: userRow.id, email: userRow.email, role: userRow.role, name: userRow.name },
    JWT_SECRET,
    { expiresIn: '90d' }
  );

  res.json({
    token,
    user: {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: userRow.role,
    },
    companies,
    selectedCompanyId: company.id,
  });
});

// POST /api/auth/register - 新規登録（管理者アカウント + 会社作成）
router.post('/register', (req: Request, res: Response): void => {
  const { email, password, name, companyName } = req.body;

  if (!email || !password || !name || !companyName) {
    res.status(400).json({ error: 'すべての項目を入力してください' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as any;
  if (existing) {
    // super_admin 用メールは既存を上書きして再登録できるようにする
    if (email === SUPER_ADMIN_EMAIL) {
      db.prepare('DELETE FROM user_companies WHERE user_id = ?').run(existing.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
    } else {
      res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
      return;
    }
  }

  const hash = bcrypt.hashSync(password, 10);
  const assignedRole = email === SUPER_ADMIN_EMAIL ? 'super_admin' : 'admin';
  const userResult = db.prepare(
    'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)'
  ).run(email, hash, name, assignedRole);
  const userId = userResult.lastInsertRowid as number;

  const companyPin = String(Math.floor(100000 + Math.random() * 900000));
  const companyResult = db.prepare(
    'INSERT INTO companies (name, company_pin) VALUES (?, ?)'
  ).run(companyName, companyPin);
  const companyId = companyResult.lastInsertRowid as number;

  db.prepare(
    'INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)'
  ).run(userId, companyId, 'admin');

  const token = jwt.sign(
    { id: userId, email, role: assignedRole, name },
    JWT_SECRET,
    { expiresIn: '90d' }
  );

  res.status(201).json({
    token,
    user: { id: userId, email, name, role: assignedRole },
    companies: [{ id: companyId, name: companyName, company_role: 'admin' }],
  });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req: AuthRequest, res: Response): void => {
  const user = db.prepare(
    'SELECT id, email, name, role FROM users WHERE id = ? AND is_active = 1'
  ).get(req.user!.id) as any;

  if (!user) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  const companies = db.prepare(`
    SELECT c.id, c.name, uc.role as company_role
    FROM user_companies uc
    JOIN companies c ON uc.company_id = c.id
    WHERE uc.user_id = ?
  `).all(user.id);

  res.json({ user, companies });
});

// POST /api/auth/change-password
router.post('/change-password', authenticateToken, (req: AuthRequest, res: Response): void => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: '現在のパスワードと新しいパスワードを入力してください' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  const validPassword = bcrypt.compareSync(currentPassword, user.password);
  if (!validPassword) {
    res.status(401).json({ error: '現在のパスワードが正しくありません' });
    return;
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newHash, req.user!.id);

  res.json({ message: 'パスワードを変更しました' });
});

export default router;
