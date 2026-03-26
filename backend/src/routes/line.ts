import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';

const router = Router();

// Helper: send LINE message
async function sendLineMessage(accessToken: string, lineUserId: string, message: string) {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text: message }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

// Send to all staff in company
export async function notifyCompanyStaff(companyId: number, message: string) {
  const settings = db.prepare(
    'SELECT * FROM line_settings WHERE company_id = ?'
  ).get(companyId) as any;
  if (!settings?.channel_access_token) return;

  const lineUsers = db.prepare(`
    SELECT uli.line_user_id FROM user_line_ids uli
    JOIN user_companies uc ON uc.user_id = uli.user_id AND uc.company_id = ?
  `).all(companyId) as any[];

  for (const u of lineUsers) {
    await sendLineMessage(settings.channel_access_token, u.line_user_id, message);
  }
}

// GET /api/line/settings
router.get('/settings', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const settings = db.prepare('SELECT * FROM line_settings WHERE company_id = ?').get(req.companyId!);
  res.json({ settings: settings || null });
});

// POST /api/line/settings
router.post('/settings', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const { channel_access_token, notify_shift_published, notify_shift_changed, notify_help_request } = req.body;

  db.prepare(`
    INSERT INTO line_settings (company_id, channel_access_token, notify_shift_published, notify_shift_changed, notify_help_request)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET
      channel_access_token = excluded.channel_access_token,
      notify_shift_published = excluded.notify_shift_published,
      notify_shift_changed = excluded.notify_shift_changed,
      notify_help_request = excluded.notify_help_request
  `).run(req.companyId!, channel_access_token, notify_shift_published ? 1 : 0, notify_shift_changed ? 1 : 0, notify_help_request ? 1 : 0);

  res.json({ message: 'LINE設定を保存しました' });
});

// POST /api/line/register - Staff registers their LINE user ID
router.post('/register', authenticateToken, (req: AuthRequest, res: Response): void => {
  const { line_user_id } = req.body;
  if (!line_user_id) { res.status(400).json({ error: 'LINE IDが必要です' }); return; }

  db.prepare(`
    INSERT INTO user_line_ids (user_id, line_user_id) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET line_user_id = excluded.line_user_id
  `).run(req.user!.id, line_user_id);

  res.json({ message: 'LINE連携が完了しました' });
});

// POST /api/line/test - Send test message (admin)
router.post('/test', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user!.role !== 'admin') { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  await notifyCompanyStaff(req.companyId!, '【シフトログ】LINE通知のテストです。正常に動作しています。');
  res.json({ message: 'テスト通知を送信しました' });
});

// POST /api/line/webhook - LINE webhook receiver
router.post('/webhook', (req, res) => {
  // Handle LINE webhook events (friend add, etc.)
  const events = req.body?.events || [];
  for (const event of events) {
    if (event.type === 'follow') {
      // User added the bot - store their LINE user ID
      // They need to link their account via the app
      console.log('New LINE follower:', event.source.userId);
    }
  }
  res.json({ status: 'ok' });
});

export default router;
