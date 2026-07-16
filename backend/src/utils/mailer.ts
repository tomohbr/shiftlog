import nodemailer from 'nodemailer';

// Railway本番はSMTP egress(465/587)がブロックされているため、Brevo(HTTPS API/443)を第一経路に。
// 優先順: BREVO_API_KEY があればBrevo / なくてSMTP_USER+SMTP_PASSがあればnodemailer(ローカル開発用) / どちらもなければスキップ。
// sendMail(to, subject, text) のインターフェースは維持、未設定時に false を返す縮退動作も維持する。
//
// 送信元/返信先の方針（2026-07-16）:
//   - 返信の受け口は shibahara.724@gmail.com を維持（既存顧客スレッド継続のため Reply-To を必ず付与）
//   - Brevoでgmail送信元は From がBrevo側で書き換えられる（例: @brevosend.com）が、
//     表示名「シフトログ」と Reply-To は維持される。独自ドメイン取得後は MAIL_FROM_EMAIL を差し替えるだけでよい。

const BREVO_API_KEY = process.env.BREVO_API_KEY;

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'シフトログ';
const MAIL_FROM_EMAIL = process.env.MAIL_FROM_EMAIL || SMTP_USER || 'shibahara.724@gmail.com';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || 'shibahara.724@gmail.com';
const SMTP_FROM = process.env.MAIL_FROM || `${MAIL_FROM_NAME} <${MAIL_FROM_EMAIL}>`;

type Mode = 'brevo' | 'smtp' | 'none';

export interface MailResult {
  ok: boolean;
  via: Mode;
  messageId?: string;
  error?: string;
}

function mode(): Mode {
  if (BREVO_API_KEY) return 'brevo';
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

async function sendViaBrevo(to: string, subject: string, text: string): Promise<MailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY as string,
      },
      body: JSON.stringify({
        sender: { name: MAIL_FROM_NAME, email: MAIL_FROM_EMAIL },
        replyTo: { name: MAIL_FROM_NAME, email: MAIL_REPLY_TO },
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
      signal: controller.signal,
    });
    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, via: 'brevo', error: `HTTP ${res.status}: ${bodyText.slice(0, 300)}` };
    }
    let messageId: string | undefined;
    try { messageId = JSON.parse(bodyText)?.messageId; } catch {}
    return { ok: true, via: 'brevo', messageId };
  } catch (err: any) {
    return { ok: false, via: 'brevo', error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaSmtp(to: string, subject: string, text: string): Promise<MailResult> {
  try {
    const info = await getSmtpTransporter().sendMail({
      from: SMTP_FROM,
      replyTo: MAIL_REPLY_TO,
      to,
      subject,
      text,
    });
    return { ok: true, via: 'smtp', messageId: info?.messageId };
  } catch (err: any) {
    return { ok: false, via: 'smtp', error: String(err?.message || err) };
  }
}

// 詳細な結果（経路・Message-Id）が必要な場合はこちら（管理者のテスト送信・実測確認用）
export async function sendMailWithResult(to: string, subject: string, text: string): Promise<MailResult> {
  const m = mode();
  if (m === 'none') return { ok: false, via: 'none', error: 'mail not configured' };
  const result = m === 'brevo'
    ? await sendViaBrevo(to, subject, text)
    : await sendViaSmtp(to, subject, text);
  if (result.ok) {
    console.log(`[mailer] sent via ${result.via} to ${to} (messageId: ${result.messageId || 'n/a'})`);
  } else {
    console.error(`[mailer] send failed via ${result.via} to ${to}: ${result.error}`);
  }
  return result;
}

// 既存呼び出し互換（auth.ts / feedback.ts / trial-notify.ts はこのまま）
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const result = await sendMailWithResult(to, subject, text);
  return result.ok;
}
