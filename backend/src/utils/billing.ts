import { Response } from 'express';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

export const PRICE_PER_MONTH = 980;
export const FREE_STAFF_LIMIT = 30;
export const TRIAL_DAYS = 30;

export function getSubscription(companyId: number): any {
  return db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(companyId) as any;
}

export function isProCompany(companyId: number): boolean {
  const subscription = getSubscription(companyId);
  return subscription?.plan === 'pro' && subscription?.status !== 'canceled';
}

// トライアル中か（有料Proではないが、期限内はPro機能を全開放）
export function isInTrial(companyId: number): boolean {
  const subscription = getSubscription(companyId);
  if (!subscription?.trial_ends_at) return false;
  if (subscription.plan === 'pro' && subscription.status !== 'canceled') return false;
  return new Date(subscription.trial_ends_at).getTime() > Date.now();
}

// Pro機能を使えるか（有料Pro or トライアル中）
export function hasProAccess(companyId: number): boolean {
  return isProCompany(companyId) || isInTrial(companyId);
}

export function getTrialInfo(companyId: number): { in_trial: boolean; trial_ends_at: string | null; trial_days_left: number | null } {
  const subscription = getSubscription(companyId);
  const endsAt = subscription?.trial_ends_at || null;
  if (!endsAt) return { in_trial: false, trial_ends_at: null, trial_days_left: null };
  const msLeft = new Date(endsAt).getTime() - Date.now();
  const inTrial = msLeft > 0 && !(subscription.plan === 'pro' && subscription.status !== 'canceled');
  return {
    in_trial: inTrial,
    trial_ends_at: endsAt,
    trial_days_left: inTrial ? Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000))) : 0,
  };
}

export function sendUpgradeRequired(res: Response, feature: string, trialExpired = false): void {
  res.status(402).json({
    code: 'UPGRADE_REQUIRED',
    error: trialExpired
      ? `無料トライアルが終了しました。${feature}はProプラン（月額¥${PRICE_PER_MONTH}）で引き続き利用できます。データはそのまま保持されています。`
      : `${feature}はProプランで利用できます。1店舗は無料、Proは月額¥${PRICE_PER_MONTH}です。`,
    feature,
    price: PRICE_PER_MONTH,
    trial_expired: trialExpired,
  });
}

export function requireProFeature(req: AuthRequest, res: Response, feature: string): boolean {
  if (req.user?.role === 'super_admin') return true;
  const companyId = req.companyId!;
  if (hasProAccess(companyId)) return true;
  // トライアルを一度でも付与されていた会社には「終了した」文言を出す
  const hadTrial = !!getSubscription(companyId)?.trial_ends_at;
  sendUpgradeRequired(res, feature, hadTrial);
  return false;
}

export function getStaffCount(companyId: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM user_companies uc
    JOIN users u ON u.id = uc.user_id
    WHERE uc.company_id = ? AND u.is_active = 1 AND uc.role != 'admin'
  `).get(companyId) as any;
  return row?.count || 0;
}

export function canAddStaff(companyId: number, countToAdd = 1): boolean {
  if (hasProAccess(companyId)) return true;
  return getStaffCount(companyId) + countToAdd <= FREE_STAFF_LIMIT;
}

// 日本時間での「今年・今月」（サーバーはUTCで動く前提）
export function currentYearMonthJST(): { year: number; month: number } {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1 };
}

// 当月データはFreeでも閲覧可。過去月・未来月の履歴はPro（or トライアル）。
export function requireProForPastMonths(req: AuthRequest, res: Response, year: number, month: number, feature: string): boolean {
  const now = currentYearMonthJST();
  if (year === now.year && month === now.month) return true;
  return requireProFeature(req, res, feature);
}
