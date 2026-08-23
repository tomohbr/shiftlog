import db, { SUPER_ADMIN_EMAIL } from '../db';

// App Store ガイドライン 5.1.1(v) 対応：
// アカウント作成ができるアプリは、アプリ内からアカウントを完全に削除できる必要がある。
// foreign_keys = ON のため、子テーブルから順に消す。

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const Stripe = require('stripe');
  return new Stripe(key, { apiVersion: '2024-12-18.acacia' });
}

// 自分が admin で、かつ他に admin がいない会社（＝自分が消えると管理者不在になる会社）
export function findSoleAdminCompanies(userId: number): { id: number; name: string }[] {
  return db.prepare(`
    SELECT c.id, c.name
    FROM user_companies uc
    JOIN companies c ON c.id = uc.company_id
    WHERE uc.user_id = ? AND uc.role = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM user_companies o
        WHERE o.company_id = uc.company_id AND o.role = 'admin' AND o.user_id != uc.user_id
      )
    ORDER BY c.name ASC
  `).all(userId) as { id: number; name: string }[];
}

// 会社に紐づく全データを削除する
export function deleteCompanyData(companyId: number): void {
  // skills 経由の user_skills は company_id を持たないので先に落とす
  db.prepare('DELETE FROM user_skills WHERE skill_id IN (SELECT id FROM skills WHERE company_id = ?)').run(companyId);
  db.prepare('DELETE FROM skills WHERE company_id = ?').run(companyId);

  db.prepare('DELETE FROM time_record_edits WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM shift_swaps WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM absence_reports WHERE company_id = ?').run(companyId);

  db.prepare('DELETE FROM punch_receipts WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM time_records WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM shifts WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM shift_publications WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM shift_requests WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM shift_request_periods WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM shift_templates WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM daily_sales WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM line_settings WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM feedbacks WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM audit_logs WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM subscriptions WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM stores WHERE company_id = ?').run(companyId);

  db.prepare('DELETE FROM user_companies WHERE company_id = ?').run(companyId);
  db.prepare('DELETE FROM companies WHERE id = ?').run(companyId);
}

// 退会するユーザー個人のデータを、残る会社側からも消す
function deleteUserPersonalData(userId: number): void {
  // 本人の打刻に紐づく修正履歴（time_record_id が NOT NULL なので先に消す）
  db.prepare('DELETE FROM time_record_edits WHERE time_record_id IN (SELECT id FROM time_records WHERE user_id = ?)').run(userId);
  db.prepare('UPDATE time_record_edits SET target_user_id = NULL WHERE target_user_id = ?').run(userId);

  // 交代依頼（shift_id が NOT NULL なので本人のシフトに紐づくものごと消す）
  db.prepare('DELETE FROM shift_swaps WHERE requester_id = ? OR shift_id IN (SELECT id FROM shifts WHERE user_id = ?)').run(userId, userId);
  db.prepare('UPDATE shift_swaps SET target_user_id = NULL WHERE target_user_id = ?').run(userId);
  db.prepare('UPDATE shift_swaps SET responder_id = NULL WHERE responder_id = ?').run(userId);

  // 欠勤報告（shift_id / cover_user_id は NULL 可）
  db.prepare('DELETE FROM absence_reports WHERE user_id = ?').run(userId);
  db.prepare('UPDATE absence_reports SET cover_user_id = NULL WHERE cover_user_id = ?').run(userId);
  db.prepare('UPDATE absence_reports SET shift_id = NULL WHERE shift_id IN (SELECT id FROM shifts WHERE user_id = ?)').run(userId);

  db.prepare('DELETE FROM punch_receipts WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM time_records WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM shifts WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM shift_requests WHERE user_id = ?').run(userId);

  db.prepare('DELETE FROM user_skills WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM ical_tokens WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM device_tokens WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_line_ids WHERE user_id = ?').run(userId);

  // 監査ログ・フィードバックは記録として残すが、個人との紐付けは外す
  db.prepare('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?').run(userId);
  db.prepare('UPDATE feedbacks SET user_id = NULL WHERE user_id = ?').run(userId);

  db.prepare('DELETE FROM user_companies WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// 有料契約が残っていれば解約する（失敗しても退会自体は止めない）
export async function cancelCompanySubscription(companyId: number): Promise<void> {
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(companyId) as any;
  if (!subscription?.stripe_subscription_id) return;

  const stripe = getStripe();
  if (!stripe) return;

  try {
    await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
  } catch (e) {
    console.error(`[account-deletion] Stripe解約に失敗 (company_id=${companyId}):`, e);
  }
}

// 退会処理本体。会社データと個人データをまとめて1トランザクションで消す
export function deleteAccount(userId: number, companyIdsToDelete: number[]): void {
  // 会社を消す前にメンバーを控えておく（消した後だと user_companies から辿れない）
  const memberIds = new Set<number>();
  for (const companyId of companyIdsToDelete) {
    const rows = db.prepare('SELECT user_id FROM user_companies WHERE company_id = ?').all(companyId) as { user_id: number }[];
    rows.forEach(r => memberIds.add(r.user_id));
  }
  memberIds.delete(userId);

  const run = db.transaction(() => {
    for (const companyId of companyIdsToDelete) {
      deleteCompanyData(companyId);
    }
    deleteUserPersonalData(userId);

    // 会社ごと消したことで、どこにも所属しなくなったスタッフのアカウントも残さない
    for (const memberId of memberIds) {
      const member = db.prepare('SELECT email FROM users WHERE id = ?').get(memberId) as any;
      if (!member || member.email === SUPER_ADMIN_EMAIL) continue;

      const stillBelongs = db.prepare('SELECT 1 FROM user_companies WHERE user_id = ? LIMIT 1').get(memberId);
      if (!stillBelongs) deleteUserPersonalData(memberId);
    }
  });
  run();
}
