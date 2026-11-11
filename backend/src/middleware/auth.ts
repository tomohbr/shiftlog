import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'shiftlog-secret-key-2024';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: string;
    name: string;
  };
  companyId?: number;
}

// 運営者（芝原）用の API キー。キー本体は運営者の Mac の ~/.config/shiftlog-api/key だけにあり、
// ここには SHA-256 だけを置く。キーで入ると user_id=1・会社1 の管理者として扱う。
// 差し替えは SHIFTLOG_API_KEY_SHA256 で上書き、無効化は "off" を入れる。
const API_KEY_SHA256 = (process.env.SHIFTLOG_API_KEY_SHA256
  || '1f315140e9ca08dcc9eea65bce7aa8055ebdec0ac32d0ed9e0e218f1305c99ea').toLowerCase();
const API_KEY_USER_ID = 1;
const API_KEY_COMPANY_ID = 1;

function tryApiKey(req: AuthRequest): boolean {
  const key = req.headers['x-api-key'];
  if (typeof key !== 'string' || !key || API_KEY_SHA256 === 'off') return false;
  const got = Buffer.from(crypto.createHash('sha256').update(key).digest('hex'));
  const want = Buffer.from(API_KEY_SHA256);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return false;
  const u = db.prepare('SELECT id, email, role, name FROM users WHERE id = ?').get(API_KEY_USER_ID) as any;
  if (!u) return false;
  req.user = { id: u.id, email: u.email, role: u.role, name: u.name };
  const companyHeader = req.headers['x-company-id'];
  req.companyId = companyHeader ? parseInt(companyHeader as string) : API_KEY_COMPANY_ID;
  return true;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.headers['x-api-key']) {
    if (tryApiKey(req)) { next(); return; }
    res.status(403).json({ error: 'API キーが無効です' });
    return;
  }
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: '認証が必要です' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      name: decoded.name,
    };
    // companyId comes from header (selected company)
    const companyHeader = req.headers['x-company-id'];
    if (companyHeader) {
      req.companyId = parseInt(companyHeader as string);
    }
    next();
  } catch {
    res.status(403).json({ error: 'トークンが無効です' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  // Global admin / super_admin
  if (req.user.role === 'admin' || req.user.role === 'super_admin') {
    next();
    return;
  }
  // Check company-level admin role
  if (req.companyId) {
    const uc = db.prepare(
      'SELECT role FROM user_companies WHERE user_id = ? AND company_id = ?'
    ).get(req.user.id, req.companyId) as any;
    if (uc && uc.role === 'admin') {
      next();
      return;
    }
  }
  res.status(403).json({ error: '管理者権限が必要です' });
}

export function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'super_admin') {
    res.status(403).json({ error: 'スーパー管理者権限が必要です' });
    return;
  }
  next();
}

// Middleware to require a company to be selected AND verify user belongs to it
export function requireCompany(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.companyId) {
    res.status(400).json({ error: '会社を選択してください (X-Company-Id header)' });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: '認証が必要です' });
    return;
  }
  const uc = db.prepare(
    'SELECT 1 FROM user_companies WHERE user_id = ? AND company_id = ?'
  ).get(req.user.id, req.companyId);
  if (!uc) {
    res.status(403).json({ error: 'この会社へのアクセス権限がありません' });
    return;
  }
  next();
}

export { JWT_SECRET };
