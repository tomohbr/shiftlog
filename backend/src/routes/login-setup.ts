import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { canSeeWages } from '../utils/wages';
import { logAudit } from '../utils/audit';

// ログインの新規登録リンク。メール・パスワードがまだない人（社長など）に送り、本人が自分で決めて登録する。
//   - 発行できるのは時給を見られる人（芝原・社長など）だけ。管理者のログインを他人に作られないように
//   - 1回使ったら終わり。7日で切れる。パスワードは本人しか知らない
db.exec(`
  CREATE TABLE IF NOT EXISTS login_setup_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_by INTEGER,
    expires_at DATETIME NOT NULL,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const router = Router();
const APP_URL = process.env.APP_URL || 'https://shiftlog-production.up.railway.app';
const DAYS = 7;

function findLink(token: string) {
  return db.prepare(`
    SELECT l.*, u.name, u.email, c.name AS company_name FROM login_setup_links l
    JOIN users u ON u.id = l.user_id AND u.is_active = 1
    JOIN companies c ON c.id = l.company_id
    WHERE l.token = ? AND l.used_at IS NULL AND l.expires_at >= datetime('now')
  `).get(token) as any;
}

// POST /api/login-setup { user_id } - 新規登録リンクを出す
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!canSeeWages(req)) { res.status(403).json({ error: '新規登録のリンクは、時給を見られる人だけが出せます' }); return; }
  const companyId = req.companyId!;
  const userId = Number(req.body?.user_id);
  const target = db.prepare('SELECT u.id, u.name FROM users u JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ? WHERE u.id = ? AND u.is_active = 1').get(companyId, userId) as any;
  if (!target) { res.status(404).json({ error: 'スタッフが見つかりません' }); return; }
  // 前に出した使っていないリンクは止める（最新の1本だけ有効）
  db.prepare('UPDATE login_setup_links SET expires_at = CURRENT_TIMESTAMP WHERE user_id = ? AND company_id = ? AND used_at IS NULL').run(userId, companyId);
  const token = crypto.randomBytes(18).toString('base64url');
  db.prepare(`INSERT INTO login_setup_links (token, company_id, user_id, created_by, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+${DAYS} days'))`).run(token, companyId, userId, req.user!.id);
  logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'login_setup', entityId: userId, summary: `${target.name}さんのログイン新規登録リンクを発行` });
  res.status(201).json({ url: `${APP_URL}/signup/${token}`, days: DAYS });
});

// GET /api/login-setup/:token - リンクを開いたとき（誰の登録か）
router.get('/:token', (req: Request, res: Response): void => {
  const l = findLink(String(req.params.token));
  if (!l) { res.status(404).json({ error: 'このリンクは使えません（期限切れか、もう登録済みです）。担当者に新しいリンクをもらってください。' }); return; }
  res.json({ name: l.name, company_name: l.company_name, email: l.email || '' });
});

// POST /api/login-setup/:token { email, password } - 本人がメールとパスワードを決める
router.post('/:token', (req: Request, res: Response): void => {
  const l = findLink(String(req.params.token));
  if (!l) { res.status(404).json({ error: 'このリンクは使えません（期限切れか、もう登録済みです）。担当者に新しいリンクをもらってください。' }); return; }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'メールアドレスの形が正しくありません' }); return; }
  if (password.length < 8) { res.status(400).json({ error: 'パスワードは8文字以上にしてください' }); return; }
  const taken = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id != ?').get(email, l.user_id);
  if (taken) { res.status(409).json({ error: 'このメールアドレスは、もう別の人が使っています' }); return; }
  db.prepare('UPDATE users SET email = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(email, bcrypt.hashSync(password, 10), l.user_id);
  db.prepare('UPDATE login_setup_links SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(l.id);
  logAudit({ userId: l.user_id, companyId: l.company_id, action: 'update', entity: 'login_setup', entityId: l.user_id, summary: `${l.name}さんがログインを登録` });
  res.json({ ok: true, email });
});

export default router;
