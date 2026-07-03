import nodemailer from 'nodemailer';

// SMTP設定は環境変数から。未設定なら送信をスキップ（アプリは正常動作を続ける）。
// 推奨: Gmailの場合 SMTP_USER=Gmailアドレス, SMTP_PASS=アプリパスワード
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || (SMTP_USER ? `シフトログ <${SMTP_USER}>` : undefined);

let transporter: nodemailer.Transporter | null = null;

export function isMailConfigured(): boolean {
  return !!(SMTP_USER && SMTP_PASS);
}

function getTransporter(): nodemailer.Transporter | null {
  if (!isMailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({ from: MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    console.error(`[mailer] send failed to ${to}:`, err);
    return false;
  }
}
