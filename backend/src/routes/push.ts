import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { isApnsConfigured, sendPushToUsers } from '../utils/apns';

const router = Router();

// iOS ネイティブアプリのプッシュ通知（APNs）用エンドポイント。
// Web の Web Push（push_subscriptions）とは別系統。

// POST /api/push/device - デバイストークンの登録
router.post('/device', authenticateToken, (req: AuthRequest, res: Response): void => {
  const { token, platform, environment, app_version } = req.body || {};

  if (!token || typeof token !== 'string' || !/^[0-9a-fA-F]{64,200}$/.test(token)) {
    res.status(400).json({ error: 'デバイストークンが不正です' });
    return;
  }

  // 同じ端末を別のスタッフが使う（店舗の共有端末など）場合、
  // トークンは常に「最後にログインした人」に付け替える。前の人に通知が飛ばないようにするため。
  db.prepare(`
    INSERT INTO device_tokens (user_id, token, platform, environment, app_version)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      user_id = excluded.user_id,
      platform = excluded.platform,
      environment = excluded.environment,
      app_version = excluded.app_version,
      last_seen_at = CURRENT_TIMESTAMP
  `).run(
    req.user!.id,
    token,
    platform === 'android' ? 'android' : 'ios',
    environment === 'sandbox' ? 'sandbox' : 'production',
    typeof app_version === 'string' ? app_version.slice(0, 32) : null,
  );

  res.json({ ok: true, configured: isApnsConfigured() });
});

// DELETE /api/push/device - デバイストークンの解除（ログアウト時）
router.delete('/device', authenticateToken, (req: AuthRequest, res: Response): void => {
  const token = (req.body || {}).token;
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'デバイストークンが不正です' });
    return;
  }
  db.prepare('DELETE FROM device_tokens WHERE token = ? AND user_id = ?').run(token, req.user!.id);
  res.json({ ok: true });
});

// POST /api/push/test - 自分宛にテスト通知を送る（設定画面の動作確認用）
router.post('/test', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isApnsConfigured()) {
    res.status(503).json({ error: 'プッシュ通知はまだ設定されていません' });
    return;
  }
  const sent = await sendPushToUsers([req.user!.id], {
    title: 'シフトログ',
    body: 'プッシュ通知のテストです。正常に届いています。',
    path: '/settings',
  });
  if (sent === 0) {
    res.status(404).json({ error: '通知先の端末が登録されていません。アプリで通知を許可してください。' });
    return;
  }
  res.json({ ok: true, sent });
});

export default router;
