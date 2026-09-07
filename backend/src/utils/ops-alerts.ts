import crypto from 'crypto';
import db, { SUPER_ADMIN_EMAIL } from '../db';
import { isMailConfigured, sendMail } from './mailer';

// 運営者（shibahara.724@gmail.com）への障害・フィードバック通知。
//
// 目的: 不具合が起きたとき、ユーザーから言われる前に気づけるようにする。
// 同じエラーが連続して起きてもメールが洪水にならないよう、
// 「署名（fingerprint）ごとに 6 時間に 1 通」に抑える。送信記録は ops_notices に残す。

const RESEND_AFTER_MS = 6 * 60 * 60 * 1000;
const APP_URL = process.env.APP_URL || 'https://shiftlog-production.up.railway.app';

db.exec(`
  CREATE TABLE IF NOT EXISTS ops_notices (
    key TEXT PRIMARY KEY,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/** メッセージとスタックの先頭から安定した署名を作る（行番号のブレを吸収するためファイル名まで） */
export function fingerprint(message: string, stack?: string | null, extra = ''): string {
  const firstFrame = (stack || '').split('\n').map(l => l.trim()).find(l => l.startsWith('at ')) || '';
  const normalized = `${message}|${firstFrame.replace(/:\d+:\d+\)?$/, '')}|${extra}`;
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

/** 同じ key の通知を短時間に繰り返さない。送ってよければ true。 */
export function shouldNotify(key: string): boolean {
  const row = db.prepare('SELECT sent_at FROM ops_notices WHERE key = ?').get(key) as { sent_at: string } | undefined;
  if (row) {
    const last = new Date(row.sent_at.replace(' ', 'T') + 'Z').getTime();
    if (Date.now() - last < RESEND_AFTER_MS) return false;
  }
  db.prepare(`
    INSERT INTO ops_notices (key, sent_at) VALUES (?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET sent_at = CURRENT_TIMESTAMP
  `).run(key);
  return true;
}

export interface ErrorNotice {
  source: 'server' | 'client';
  message: string;
  stack?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  path?: string | null;
  userId?: number | null;
  companyId?: number | null;
  extra?: Record<string, unknown>;
}

/** 運営者にエラーをメールする（送信失敗・未設定は握りつぶす。本処理を止めない） */
export function notifyError(notice: ErrorNotice): void {
  try {
    const fp = fingerprint(notice.message, notice.stack, notice.source);
    if (!shouldNotify(`err:${fp}`)) return;
    if (!isMailConfigured()) return;

    const where = notice.source === 'server' ? 'サーバー' : (notice.platform === 'ios' ? 'iOSアプリ' : 'Web');
    const subject = `【シフトログ】不具合検知（${where}）: ${notice.message.slice(0, 60)}`;
    const lines = [
      `${where}でエラーが発生しました。同じエラーは6時間に1回だけ通知します。`,
      '',
      `発生元: ${notice.source} / ${notice.platform || '-'} / ver ${notice.appVersion || '-'}`,
      `画面・パス: ${notice.path || '-'}`,
      `ユーザー: ${notice.userId ?? '-'} / 会社: ${notice.companyId ?? '-'}`,
      `時刻: ${new Date().toISOString()} (UTC)`,
      '',
      '--- メッセージ ---',
      notice.message,
      '',
      '--- スタック ---',
      (notice.stack || '(なし)').slice(0, 2000),
    ];
    if (notice.extra && Object.keys(notice.extra).length) {
      lines.push('', '--- 追加情報 ---', JSON.stringify(notice.extra, null, 2).slice(0, 1500));
    }
    lines.push('', `管理画面: ${APP_URL}/admin-hub`);
    sendMail(SUPER_ADMIN_EMAIL, subject, lines.join('\n')).catch(() => {});
  } catch (e) {
    console.error('[ops-alerts] 通知に失敗:', (e as Error).message);
  }
}

/** サーバー側の例外を記録して通知する */
export function reportServerError(err: unknown, context: { path?: string; userId?: number | null; companyId?: number | null; extra?: Record<string, unknown> } = {}): void {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error('[server-error]', context.path || '', error);
  try {
    db.prepare(`
      INSERT INTO client_errors (user_id, company_id, platform, app_version, path, message, stack, fingerprint)
      VALUES (?, ?, 'server', ?, ?, ?, ?, ?)
    `).run(
      context.userId ?? null,
      context.companyId ?? null,
      process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || null,
      context.path || null,
      error.message.slice(0, 1000),
      (error.stack || '').slice(0, 4000),
      fingerprint(error.message, error.stack, 'server'),
    );
  } catch (e) {
    console.error('[ops-alerts] エラー記録に失敗:', (e as Error).message);
  }
  notifyError({ source: 'server', message: error.message, stack: error.stack, path: context.path, userId: context.userId, companyId: context.companyId, extra: context.extra });
}
