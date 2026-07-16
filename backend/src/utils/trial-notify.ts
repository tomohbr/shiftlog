import db from '../db';
import { isMailConfigured, sendMail } from './mailer';
import { PRICE_PER_MONTH } from './billing';

const APP_URL = process.env.APP_URL || 'https://shiftlog-production.up.railway.app';

// 送信済み記録（同じ通知を二度送らない）
db.exec(`
  CREATE TABLE IF NOT EXISTS trial_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    notice_type TEXT NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, notice_type)
  )
`);

function adminEmails(companyId: number): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT u.email FROM users u
    JOIN user_companies uc ON uc.user_id = u.id
    WHERE uc.company_id = ? AND uc.role = 'admin' AND u.email IS NOT NULL AND u.email != '' AND u.is_active = 1
  `).all(companyId) as { email: string }[];
  return rows.map(r => r.email);
}

function buildMessage(noticeType: string, companyName: string, daysLeft: number): { subject: string; text: string } {
  const settingsUrl = `${APP_URL}/settings`;
  const footer = `\n---\nシフトログ\n${APP_URL}\nプランの確認・変更: ${settingsUrl}\n`;

  if (noticeType === 'd7') {
    return {
      subject: `【シフトログ】Proトライアル終了まであと${daysLeft}日です`,
      text: `${companyName} ご担当者様\n\nシフトログのProトライアルは、あと${daysLeft}日で終了します。\n\n終了後もデータは消えません。打刻・シフト管理・当月の勤務集計は、これまで通り無料でご利用いただけます。\n\n過去月の集計・CSV出力・給与ソフト連携（freee / マネーフォワード / KING OF TIME）を引き続きお使いになる場合は、Proプラン（月額¥${PRICE_PER_MONTH.toLocaleString()}）をご検討ください。\n\nお手続きは設定ページからいつでも行えます:\n${settingsUrl}\n${footer}`,
    };
  }
  if (noticeType === 'd1') {
    return {
      subject: '【シフトログ】Proトライアルは明日終了します',
      text: `${companyName} ご担当者様\n\nシフトログのProトライアルは明日で終了します。\n\n終了後もデータは消えず、打刻・シフト管理・当月の勤務集計は無料のまま使えます。\n\n月末の給与計算でCSV出力・給与ソフト連携をお使いの場合は、Proプラン（月額¥${PRICE_PER_MONTH.toLocaleString()}）への切り替えをおすすめします。手続きは1分で完了します:\n${settingsUrl}\n${footer}`,
    };
  }
  return {
    subject: '【シフトログ】Proトライアルが終了しました（データはそのまま残っています）',
    text: `${companyName} ご担当者様\n\nシフトログのProトライアル期間が終了し、Freeプランに切り替わりました。\n\nこれまでに登録されたスタッフ・シフト・打刻データはすべてそのまま残っています。打刻・シフト管理・当月の勤務集計は引き続き無料でご利用いただけます。\n\n過去月の集計・CSV出力・給与ソフト連携が必要になったときは、いつでもProプラン（月額¥${PRICE_PER_MONTH.toLocaleString()}）に切り替えられます:\n${settingsUrl}\n${footer}`,
  };
}

export async function runTrialNotifications(): Promise<void> {
  if (!isMailConfigured()) {
    console.log('[trial-notify] mail not configured — skipping (set BREVO_API_KEY, or SMTP_USER / SMTP_PASS for local dev)');
    return;
  }

  const subs = db.prepare(`
    SELECT s.company_id, s.trial_ends_at, c.name as company_name
    FROM subscriptions s
    JOIN companies c ON c.id = s.company_id
    WHERE s.plan = 'free' AND s.trial_ends_at IS NOT NULL
  `).all() as { company_id: number; trial_ends_at: string; company_name: string }[];

  const now = Date.now();

  for (const sub of subs) {
    const msLeft = new Date(sub.trial_ends_at + 'Z').getTime() - now;
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

    let noticeType: string | null = null;
    if (daysLeft <= 0 && daysLeft >= -7) noticeType = 'expired';
    else if (daysLeft === 1) noticeType = 'd1';
    else if (daysLeft >= 2 && daysLeft <= 7) noticeType = 'd7';
    if (!noticeType) continue;

    const already = db.prepare(
      'SELECT 1 FROM trial_notices WHERE company_id = ? AND notice_type = ?'
    ).get(sub.company_id, noticeType);
    if (already) continue;

    const emails = adminEmails(sub.company_id);
    if (emails.length === 0) {
      // 宛先がない場合も記録して毎回スキャンしないようにする
      db.prepare('INSERT OR IGNORE INTO trial_notices (company_id, notice_type) VALUES (?, ?)').run(sub.company_id, noticeType);
      continue;
    }

    const { subject, text } = buildMessage(noticeType, sub.company_name, daysLeft);
    let sentAny = false;
    for (const email of emails) {
      const ok = await sendMail(email, subject, text);
      if (ok) sentAny = true;
    }
    if (sentAny) {
      db.prepare('INSERT OR IGNORE INTO trial_notices (company_id, notice_type) VALUES (?, ?)').run(sub.company_id, noticeType);
      console.log(`[trial-notify] sent ${noticeType} to company ${sub.company_id} (${emails.length} recipients)`);
    }
  }
}

export function startTrialNotifier(): void {
  // 起動1分後に初回実行、その後12時間ごと
  setTimeout(() => { runTrialNotifications().catch(e => console.error('[trial-notify]', e)); }, 60 * 1000);
  setInterval(() => { runTrialNotifications().catch(e => console.error('[trial-notify]', e)); }, 12 * 60 * 60 * 1000);
}
