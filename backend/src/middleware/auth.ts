import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
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

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
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
  // Global admin or company-level admin
  if (req.user.role === 'admin') {
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

// Middleware to require a company to be selected
export function requireCompany(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.companyId) {
    res.status(400).json({ error: '会社を選択してください (X-Company-Id header)' });
    return;
  }
  next();
}

export { JWT_SECRET };
