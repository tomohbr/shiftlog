import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db';
import { JWT_SECRET } from '../middleware/auth';
import { fingerprint, notifyError } from '../utils/ops-alerts';

// 画面の利用状況とクライアント側エラーの受け口。
//
// 「登録した人がどこまで進んで、どの画面で止まっているか」を追うため、
// フロントは画面遷移と主要操作を usage_events として送ってくる。
// ログイン前（LP・ログイン画面）の動きも取りたいので、認証は任意。
// トークンがあれば user_id / company_id を紐づける。

const router = Router();

const MAX_EVENTS_PER_REQUEST = 50;
const ALLOWED_PLATFORMS = new Set(['web', 'ios', 'android']);

function optionalUser(req: Request): { userId: number | null; companyId: number | null } {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  let userId: number | null = null;
  if (token) {
    try { userId = Number((jwt.verify(token, JWT_SECRET) as any).id) || null; } catch { userId = null; }
  }
  const companyHeader = req.headers['x-company-id'];
  const companyId = companyHeader ? parseInt(String(companyHeader)) || null : null;
  return { userId, companyId };
}

const clip = (v: unknown, n: number): string | null =>
  typeof v === 'string' && v.length ? v.slice(0, n) : null;

// POST /api/telemetry/events - 画面遷移・操作イベント（まとめ送り）
router.post('/events', (req: Request, res: Response): void => {
  const { userId, companyId } = optionalUser(req);
  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
  const platform = ALLOWED_PLATFORMS.has(req.body?.platform) ? req.body.platform : 'web';
  const appVersion = clip(req.body?.app_version, 32);

  const insert = db.prepare(`
    INSERT INTO usage_events (user_id, company_id, platform, app_version, event, path, meta, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let saved = 0;
  const run = db.transaction(() => {
    for (const e of events) {
      const name = clip(e?.event, 64);
      if (!name || !/^[a-z0-9_]+$/.test(name)) continue;
      let meta: string | null = null;
      if (e?.meta && typeof e.meta === 'object') {
        try { meta = JSON.stringify(e.meta).slice(0, 1000); } catch { meta = null; }
      }
      insert.run(userId, companyId, platform, appVersion, name, clip(e?.path, 200), meta, clip(e?.session_id, 64));
      saved++;
    }
  });
  try { run(); } catch (err) { console.error('[telemetry] 保存失敗:', (err as Error).message); }
  res.json({ ok: true, saved });
});

// POST /api/telemetry/error - クライアント側の例外。記録して運営者に通知する
router.post('/error', (req: Request, res: Response): void => {
  const { userId, companyId } = optionalUser(req);
  const message = clip(req.body?.message, 1000);
  if (!message) {
    res.status(400).json({ error: 'message が必要です' });
    return;
  }
  const stack = clip(req.body?.stack, 4000);
  const platform = ALLOWED_PLATFORMS.has(req.body?.platform) ? req.body.platform : 'web';
  const appVersion = clip(req.body?.app_version, 32);
  const path = clip(req.body?.path, 200);

  try {
    db.prepare(`
      INSERT INTO client_errors (user_id, company_id, platform, app_version, path, message, stack, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, companyId, platform, appVersion, path, message, stack, fingerprint(message, stack, platform));
  } catch (err) {
    console.error('[telemetry] エラー記録失敗:', (err as Error).message);
  }

  notifyError({
    source: 'client', message, stack, platform, appVersion, path, userId, companyId,
    extra: { userAgent: (req.headers['user-agent'] || '').slice(0, 200) },
  });
  res.json({ ok: true });
});

export default router;
