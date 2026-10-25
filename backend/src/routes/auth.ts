import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db, { SUPER_ADMIN_EMAIL } from '../db';
import { JWT_SECRET, authenticateToken, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { verifyRequestLink } from './line';
import { lineOnlyInfo } from './qr-clock';
import { getJSTDate, getJSTTime } from '../utils/jst';
import { ClockAction, ClockError, applyPunch, parseLocation, userBelongsToCompany } from '../utils/clock';
import { sendMail } from '../utils/mailer';
import { findSoleAdminCompanies, cancelCompanySubscription, deleteAccount } from '../utils/account-deletion';

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
    SELECT c.id, c.name, c.company_pin, c.staff_home, uc.role as company_role
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
  const today = getJSTDate();
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
  if (lineOnlyInfo(company.id)) {
    res.status(403).json({ error: 'このお店は、LINEのメニュー「打刻する」から打刻してください', line_only: true });
    return;
  }

  // Verify user belongs to this company
  if (!userBelongsToCompany(userId, company.id)) {
    res.status(403).json({ error: 'このスタッフは会社に所属していません' });
    return;
  }

  // 打刻の規則（複数回休憩・退勤時の休憩合計など）はスタッフ用・会場QRと共通
  const KIOSK_ACTIONS: Record<string, ClockAction> = {
    'clock-in': 'clock_in', 'clock-out': 'clock_out', 'break-start': 'break_start', 'break-end': 'break_end',
  };
  const clockAction = KIOSK_ACTIONS[action];
  if (!clockAction) {
    res.status(400).json({ error: '打刻の種類が正しくありません' });
    return;
  }

  const today = getJSTDate();
  try {
    applyPunch(clockAction, {
      companyId: company.id, userId: Number(userId),
      date: today, time: getJSTTime(),
      source: 'kiosk',
      location: parseLocation(req.body),
    });
  } catch (e) {
    if (e instanceof ClockError) {
      // 従来どおりキオスクの打刻エラーは 400 で返す
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
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

  // 「LINEからだけ」のお店は、会社PINで名前を選ぶログイン自体を止める（他人になりすませるため）。スタッフはLINEのリンクから入る
  if (lineOnlyInfo(company.id)) {
    res.status(403).json({ error: 'このお店は、LINEのメニューから開いてください（会社PINでのログインは使えません）', line_only: true });
    return;
  }

  // 会社PINだけで管理者としてログインできないようにする（会社PINはスタッフ用のQRに載っているため）
  if (['admin', 'super_admin'].includes(userRow.role) || userRow.company_role === 'admin') {
    res.status(403).json({ error: '管理者はメールアドレスとパスワードでログインしてください' });
    return;
  }

  // Get all companies this user belongs to
  const companies = db.prepare(`
    SELECT c.id, c.name, c.company_pin, c.staff_home, uc.role as company_role
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
// POST /api/auth/line-link - LINE で届いた希望提出リンクからのログイン（名前選択を省く）
router.post('/line-link', (req: Request, res: Response): void => {
  const link = verifyRequestLink(String(req.body?.token || ''));
  if (!link) {
    res.status(401).json({ error: 'このリンクは期限切れか無効です。LINE のトークで「希望」と送ると新しいリンクが届きます' });
    return;
  }
  const userRow = db.prepare(`
    SELECT u.id, u.email, u.name, u.role FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    WHERE u.id = ? AND u.is_active = 1
  `).get(link.cid, link.uid) as any;
  if (!userRow) {
    res.status(401).json({ error: 'スタッフが見つかりません' });
    return;
  }
  const companies = db.prepare(`
    SELECT c.id, c.name, c.company_pin, c.staff_home, uc.role as company_role
    FROM user_companies uc JOIN companies c ON uc.company_id = c.id
    WHERE uc.user_id = ?
  `).all(userRow.id);
  const token = jwt.sign(
    { id: userRow.id, email: userRow.email, role: userRow.role, name: userRow.name },
    JWT_SECRET,
    { expiresIn: '90d' }
  );
  res.json({
    token,
    user: { id: userRow.id, email: userRow.email, name: userRow.name, role: userRow.role },
    companies,
    selectedCompanyId: link.cid,
    year: link.y,
    month: link.m,
    page: link.page,
    campaign_id: link.campaign_id ?? null,
  });
});

router.post('/register', (req: Request, res: Response): void => {
  const { email, password, name, companyName, attribution } = req.body;
  // 任意の流入データは文字列だけを最大200文字で保存する。
  const acquisition = ['source', 'medium', 'campaign', 'content', 'landing_path', 'referrer'].map(key =>
    attribution && typeof attribution[key] === 'string' ? attribution[key].slice(0, 200) : null
  );

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
    'INSERT INTO companies (name, company_pin, acq_source, acq_medium, acq_campaign, acq_content, acq_landing_path, acq_referrer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(companyName, companyPin, ...acquisition);
  const companyId = companyResult.lastInsertRowid as number;

  db.prepare(
    'INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)'
  ).run(userId, companyId, 'admin');

  // 新規会社は無料プラン1店舗＋30日Proトライアルで初期化
  db.prepare(
    "INSERT INTO subscriptions (company_id, plan, max_stores, trial_ends_at) VALUES (?, ?, ?, datetime('now', '+30 days'))"
  ).run(companyId, 'free', 1);

  // 登録画面で入れた「店舗名・会社名」をそのまま最初の店舗にする。
  // 以前は登録直後の初期設定でもう一度「店舗名」を聞いていて、同じ名前を二度入れさせられた人の多くが
  // 「あとで登録する」を押してそのまま店舗なしで止まっていた（25社中9社）。名前は店舗画面で直せる。
  db.prepare('INSERT INTO stores (company_id, name) VALUES (?, ?)').run(companyId, companyName);

  logAudit({ userId: userId, companyId, action: 'create', entity: 'company', entityId: companyId, summary: `会社「${companyName}」を新規作成` });

  // 運営者へ新規登録の即時通知（送信失敗しても登録処理は成功させる。feedback.tsと同方式）
  try {
    const registeredAt = `${getJSTDate()} ${getJSTTime()}`;
    const subject = `【シフトログ】新規登録: ${companyName}`;
    const body = `新しい会社が登録されました。\n\n会社名: ${companyName}\n管理者名: ${name}\nメール: ${email}\n登録時刻: ${registeredAt} (JST)\n流入元: ${acquisition.slice(0, 3).map(value => value ?? 'unknown').join('/')}\ncompany_id: ${companyId}\n\n登録当日が唯一のフォロー窓です。ウェルカムメールを検討してください。\n利用状況: https://shiftlog-production.up.railway.app/admin`;
    sendMail(SUPER_ADMIN_EMAIL, subject, body).catch(() => {});
  } catch {}

  const token = jwt.sign(
    { id: userId, email, role: assignedRole, name },
    JWT_SECRET,
    { expiresIn: '90d' }
  );

  res.status(201).json({
    token,
    user: { id: userId, email, name, role: assignedRole },
    companies: [{ id: companyId, name: companyName, company_pin: companyPin, company_role: 'admin' }],
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
    SELECT c.id, c.name, c.company_pin, c.staff_home, uc.role as company_role
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

// GET /api/auth/account - 退会時に何が消えるかの事前確認
router.get('/account', authenticateToken, (req: AuthRequest, res: Response): void => {
  const user = db.prepare('SELECT id, email, name, password FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  const soleAdminCompanies = findSoleAdminCompanies(user.id);

  // 自分が抜けても管理者が残る会社（＝会社は消えず、自分だけ抜ける）
  const soleAdminIds = new Set(soleAdminCompanies.map(c => c.id));
  const allCompanies = db.prepare(`
    SELECT c.id, c.name, uc.role
    FROM user_companies uc
    JOIN companies c ON c.id = uc.company_id
    WHERE uc.user_id = ?
    ORDER BY c.name ASC
  `).all(user.id) as { id: number; name: string; role: string }[];
  const leavingCompanies = allCompanies.filter(c => !soleAdminIds.has(c.id));

  // Apple の App内課金は、こちらのサーバーからは解約できない（App Store の設定からのみ）。
  // 退会画面で「解約は別途必要」と明示しないと Guideline 5.1.1(v) の運用要件を満たさない。
  const appleSubCompanies = soleAdminCompanies.filter(c => {
    const sub = db.prepare(
      "SELECT platform, plan, status FROM subscriptions WHERE company_id = ?"
    ).get(c.id) as any;
    return sub?.platform === 'apple' && sub?.plan === 'pro' && sub?.status !== 'canceled';
  });

  res.json({
    email: user.email,
    name: user.name,
    requires_password: !!user.password,
    // この会社は会社ごと全データが消える
    deleting_companies: soleAdminCompanies,
    // この会社からは自分だけ抜ける（会社は残る）
    leaving_companies: leavingCompanies,
    // Apple 課金が残っている場合、App Store 側で別途解約が必要
    has_apple_subscription: appleSubCompanies.length > 0,
  });
});

// DELETE /api/auth/account - アカウント削除（App Store ガイドライン 5.1.1(v) 必須要件）
router.delete('/account', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const { password, confirm } = req.body || {};

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user) {
    res.status(404).json({ error: 'ユーザーが見つかりません' });
    return;
  }

  if (user.email === SUPER_ADMIN_EMAIL) {
    res.status(403).json({ error: '運営アカウントは削除できません' });
    return;
  }

  // パスワードを持つアカウントはパスワード確認、PINのみのスタッフは文字入力で確認
  if (user.password) {
    if (!password) {
      res.status(400).json({ error: 'パスワードを入力してください' });
      return;
    }
    if (!bcrypt.compareSync(password, user.password)) {
      res.status(401).json({ error: 'パスワードが正しくありません' });
      return;
    }
  } else if (confirm !== '削除') {
    res.status(400).json({ error: '確認のため「削除」と入力してください' });
    return;
  }

  const soleAdminCompanies = findSoleAdminCompanies(user.id);

  // DB を消す前に有料契約を解約する（消した後だと stripe_subscription_id が引けない）
  for (const company of soleAdminCompanies) {
    await cancelCompanySubscription(company.id);
  }

  // 監査ログは会社ごと消えるため、削除前に記録を残す
  logAudit({
    userId: user.id,
    companyId: null,
    action: 'delete',
    entity: 'account',
    entityId: user.id,
    summary: `アカウント削除: ${user.email || user.name}`,
    detail: { deleted_companies: soleAdminCompanies.map(c => c.name) },
  });

  try {
    deleteAccount(user.id, soleAdminCompanies.map(c => c.id));
  } catch (e) {
    console.error('[auth] アカウント削除に失敗:', e);
    res.status(500).json({ error: 'アカウント削除に失敗しました。時間をおいて再度お試しください。' });
    return;
  }

  res.json({ message: 'アカウントを削除しました' });
});

export default router;
