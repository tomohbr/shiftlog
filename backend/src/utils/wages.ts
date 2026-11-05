import { Response, NextFunction } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

// 時給・人件費を見られる人。
//   - スタッフは見られない（自分の時給も）
//   - 会社の誰かに「時給を見られる」（user_companies.can_see_wages）を付けたら、その人と運営者（super_admin）だけ。
//     ほかの管理者（店長など）には時給・人件費を出さない
//   - 誰にも付けていない会社は、これまでどおり管理者全員が見られる

function restricted(companyId: number): boolean {
  return !!db.prepare('SELECT 1 FROM user_companies WHERE company_id = ? AND can_see_wages = 1 LIMIT 1').get(companyId);
}

export function canSeeWagesFor(userId: number, userRole: string, companyId: number | null | undefined): boolean {
  if (userRole === 'super_admin') return true;
  if (!companyId) return false;
  const uc = db.prepare('SELECT role, can_see_wages FROM user_companies WHERE user_id = ? AND company_id = ?').get(userId, companyId) as { role: string; can_see_wages: number | null } | undefined;
  if (!uc) return false;
  const admin = userRole === 'admin' || uc.role === 'admin';
  if (!admin) return false;
  return restricted(companyId) ? uc.can_see_wages === 1 : true;
}

export const canSeeWages = (req: AuthRequest) => canSeeWagesFor(req.user!.id, req.user!.role, req.companyId);

/** 時給・人件費の画面と API の入口 */
export function requireWages(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!canSeeWages(req)) { res.status(403).json({ error: '時給・人件費は、見る権限のある人だけが見られます' }); return; }
  next();
}

/** 見られない人には時給と金額を消して返す */
export function hideWages<T extends Record<string, any>>(rows: T[], req: AuthRequest): T[] {
  if (canSeeWages(req)) return rows;
  return rows.map(r => {
    const o: any = { ...r };
    for (const k of ['hourly_wage', 'total_wage', 'can_see_wages', 'wage_exempt']) if (k in o) o[k] = null;
    return o;
  });
}
