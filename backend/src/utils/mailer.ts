import nodemailer from 'nodemailer';

// Railway本番はSMTP egress(465/587)がブロックされているため、Resend(HTTPS API)を第一経路に。
// 優先順: RESEND_API_KEY があればResend / なくてSMTP_USER+SMTP_PASSがあればnodemailer / どちらもなければスキップ。
// sendMail(to, subject, text) のインターフェースは維持、未設定時に false を返す縮退動作も維持する。

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'シフトログ <onboarding@resend.dev>';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.MAIL_FROM || (SMTP_USER ? `シフトログ <${SMTP_USER}>` : undefined);

type Mode = 'resend' | 'smtp' | 'none';

function mode(): Mode {
  if (RESEND_API_KEY) return 'resend';
  if (SMTP_USER && SMTP_PASS) return 'smtp';
  return 'none';
}

export function isMailConfigured(): boolean {
  return mode() !== 'none';
}

let smtpTransporter: nodemailer.Transporter | null = null;
function getSmtpTransporter(): nodemailer.Transporter {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return smtpTransporter;
}

async function sendViaResend(to: string, subject: string, text: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[mailer] resend failed to ${to}: HTTP ${res.status} ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[mailer] resend error to ${to}:`, err);
    return false;
  }
}

async function sendViaSmtp(to: string, subject: string, text: string): Promise<boolean> {
  try {
    await getSmtpTransporter().sendMail({ from: SMTP_FROM, to, subject, text });
    return true;
  } catch (err) {
    console.error(`[mailer] smtp send failed to ${to}:`, err);
    return false;
  }
}

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const m = mode();
  if (m === 'resend') return sendViaResend(to, subject, text);
  if (m === 'smtp') return sendViaSmtp(to, subject, text);
  return false;
}
