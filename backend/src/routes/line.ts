import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest, JWT_SECRET } from '../middleware/auth';

// LINE 連携（お店ごとの LINE 公式アカウント → スタッフへの通知）
//
// 流れ:
//   1. 管理者が LINE 公式アカウントの「チャネルアクセストークン」と「チャネルシークレット」を貼って保存
//      → サーバーが Bot 情報（@ID・名前）を取りに行き、Webhook URL も LINE 側に自動で登録する
//   2. スタッフはアプリの「LINEで通知を受け取る」→ 友だち追加 → 表示された6桁の連携コードをトークに送る
//      （oaMessage リンクでコード入りのトーク画面が開くので、押して送信するだけ）
//   3. Webhook がコードを受け取り、そのスタッフと LINE の userId を結びつける
//   4. 以後、シフト公開・希望収集の開始などを LINE で送る
//   5. 希望収集の案内・催促には本人専用のリンクを付ける。LINE から開くと名前選択なしで
//      その月の希望提出画面に入れる（トークで「希望」と送っても同じリンクが返ってくる）

const router = Router();
const APP_URL = process.env.APP_URL || 'https://shiftlog-production.up.railway.app';
const LINK_CODE_MINUTES = 30;

const isAdmin = (req: AuthRequest) => ['admin', 'super_admin'].includes(req.user!.role);
const webhookUrl = (companyId: number) => `${APP_URL}/api/line/webhook/${companyId}`;
const addFriendUrl = (basicId: string) => `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;
// コード入りでトーク画面を開くリンク（押して送信するだけで連携できる）
const sendCodeUrl = (basicId: string, code: string) => `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/?${encodeURIComponent(code)}`;

// 希望提出リンク用の署名鍵。通常のログイントークンとは鍵を分け、リンクの文字列がそのまま
// API の Bearer トークンとして通らないようにする
const LINK_SECRET = `${JWT_SECRET}:line-request-link`;
const REQUEST_LINK_DAYS = 21;

export function requestLinkUrl(userId: number, companyId: number, year: number, month: number): string {
  const t = jwt.sign({ uid: userId, cid: companyId, y: year, m: month }, LINK_SECRET, { expiresIn: `${REQUEST_LINK_DAYS}d` });
  return `${APP_URL}/l/${t}`;
}

export function verifyRequestLink(token: string): { uid: number; cid: number; y: number; m: number } | null {
  try {
    const d = jwt.verify(token, LINK_SECRET) as any;
    if (!d?.uid || !d?.cid || !d?.y || !d?.m) return null;
    return { uid: Number(d.uid), cid: Number(d.cid), y: Number(d.y), m: Number(d.m) };
  } catch { return null; }
}

async function lineApi(token: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`https://api.line.me${path}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

type LineMessage = string | Record<string, unknown>;
const toMessage = (m: LineMessage) => (typeof m === 'string' ? { type: 'text', text: m } : m);

async function sendLineMessage(accessToken: string, lineUserId: string, message: LineMessage) {
  try {
    const r = await lineApi(accessToken, '/v2/bot/message/push', { method: 'POST', body: { to: lineUserId, messages: [toMessage(message)] } });
    if (!r.ok) console.error('[line] push 失敗', r.status, JSON.stringify(r.data).slice(0, 200));
    return r.ok;
  } catch { return false; }
}

async function replyLine(accessToken: string, replyToken: string, message: LineMessage) {
  try { await lineApi(accessToken, '/v2/bot/message/reply', { method: 'POST', body: { replyToken, messages: [toMessage(message)] } }); } catch { /* 返信失敗は無視 */ }
}

// Send to all members of the company who linked LINE
export async function notifyCompanyStaff(companyId: number, message: string): Promise<number> {
  const settings = db.prepare('SELECT * FROM line_settings WHERE company_id = ?').get(companyId) as any;
  if (!settings?.channel_access_token) return 0;

  const lineUsers = db.prepare(`
    SELECT uli.line_user_id FROM user_line_ids uli
    JOIN user_companies uc ON uc.user_id = uli.user_id AND uc.company_id = ?
    JOIN users u ON u.id = uli.user_id AND u.is_active = 1
  `).all(companyId) as any[];

  let sent = 0;
  for (const u of lineUsers) {
    if (await sendLineMessage(settings.channel_access_token, u.line_user_id, message)) sent++;
  }
  return sent;
}

/** シフト公開の LINE 通知（設定で ON のときだけ） */
export function notifyShiftPublished(companyId: number, year: number, month: number): void {
  const s = db.prepare('SELECT notify_shift_published FROM line_settings WHERE company_id = ?').get(companyId) as any;
  if (!s || s.notify_shift_published === 0) return;
  const msg = `【シフトログ】${year}年${month}月のシフトが公開されました。\n自分の勤務を確認してください。\n\n${APP_URL}/my-shifts`;
  notifyCompanyStaff(companyId, msg).catch(() => {});
}

// 希望提出の案内カード（長いURLを見せず、ボタン1つで提出ページを開く）
type CardPeriod = { year: number; month: number; start_date?: string | null; end_date?: string | null; deadline?: string | null };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function requestBubble(heading: string, name: string, p: CardPeriod, url: string) {
  const rows: [string, string][] = [
    ['対象', p.start_date && p.end_date ? `${md(p.start_date)} 〜 ${md(p.end_date)}` : `${p.year}年${p.month}月`],
  ];
  if (p.deadline) rows.push(['締切', md(p.deadline)]);
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        { type: 'text', text: heading, weight: 'bold', size: 'md', wrap: true },
        { type: 'text', text: `${p.year}年${p.month}月のシフト希望`, size: 'sm', color: '#555555' },
        {
          type: 'box', layout: 'vertical', spacing: 'xs',
          contents: rows.map(([k, v]) => ({
            type: 'box', layout: 'baseline',
            contents: [
              { type: 'text', text: k, size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: v, size: 'sm', weight: 'bold', flex: 5, wrap: true },
            ],
          })),
        },
        { type: 'text', text: `${name}さん専用のボタンです。名前を選ばずに開けます。`, size: 'xs', color: '#888888', wrap: true },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'button', style: 'primary', color: '#06C755', action: { type: 'uri', label: '希望を提出する', uri: url } }],
    },
  };
}

function requestCard(heading: string, name: string, periods: CardPeriod[], urlFor: (p: CardPeriod) => string) {
  const bubbles = periods.map(p => requestBubble(heading, name, p, urlFor(p)));
  return {
    type: 'flex',
    altText: `【シフトログ】${heading}`,
    contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles },
  };
}

/**
 * 希望シフトの案内を、LINE 連携済みの人へ本人専用リンク付きで送る。
 * onlyUserIds を渡すとその人だけ（未提出者への催促用）。
 */
export async function sendRequestLinks(
  companyId: number, period: CardPeriod, heading: string, onlyUserIds?: number[],
): Promise<{ sent: number; targets: number }> {
  const settings = db.prepare('SELECT channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any;
  if (!settings?.channel_access_token) return { sent: 0, targets: 0 };
  let rows = db.prepare(`
    SELECT uli.user_id, uli.line_user_id, u.name FROM user_line_ids uli
    JOIN user_companies uc ON uc.user_id = uli.user_id AND uc.company_id = ?
    JOIN users u ON u.id = uli.user_id AND u.is_active = 1
  `).all(companyId) as { user_id: number; line_user_id: string; name: string }[];
  if (onlyUserIds) {
    const only = new Set(onlyUserIds);
    rows = rows.filter(r => only.has(r.user_id));
  }
  let sent = 0;
  for (const r of rows) {
    const card = requestCard(heading, r.name, [period], p => requestLinkUrl(r.user_id, companyId, p.year, p.month));
    if (await sendLineMessage(settings.channel_access_token, r.line_user_id, card)) sent++;
  }
  return { sent, targets: rows.length };
}

function membersWithLink(companyId: number) {
  return db.prepare(`
    SELECT u.id, u.name, uc.role, (uli.line_user_id IS NOT NULL) AS linked
    FROM user_companies uc JOIN users u ON u.id = uc.user_id
    LEFT JOIN user_line_ids uli ON uli.user_id = u.id
    WHERE uc.company_id = ? AND u.is_active = 1
    ORDER BY uc.role = 'staff', u.name
  `).all(companyId) as { id: number; name: string; role: string; linked: number }[];
}

// GET /api/line/settings
router.get('/settings', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const settings = db.prepare('SELECT * FROM line_settings WHERE company_id = ?').get(req.companyId!) as any;
  res.json({
    settings: settings || null,
    webhook_url: webhookUrl(req.companyId!),
    members: membersWithLink(req.companyId!).map(m => ({ ...m, linked: !!m.linked })),
  });
});

// POST /api/line/settings
// 保存と同時に、LINE 側の Bot 情報を読み取り、Webhook URL の登録と疎通確認まで行う
router.post('/settings', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const companyId = req.companyId!;
  const { notify_shift_published, notify_shift_changed, notify_help_request, notify_request_open } = req.body;
  const token = String(req.body.channel_access_token || '').trim();
  const secret = String(req.body.channel_secret || '').trim();

  // ブラウザの自動入力でメールアドレス等が入る事故があったため、形式を先に確かめる
  if (secret && !/^[0-9a-f]{32}$/i.test(secret)) {
    res.status(400).json({ error: 'チャネルシークレットの形式が違います（32文字の英数字です）。ブラウザの自動入力が入っていないか確認して、LINE Developers からコピーし直してください' });
    return;
  }
  if (token && /[\s@]/.test(token)) {
    res.status(400).json({ error: 'チャネルアクセストークンの形式が違います。LINE Developers の「Messaging API設定」からコピーし直してください' });
    return;
  }

  const check: { bot?: string; webhook?: string; error?: string } = {};
  let basicId: string | null = null;
  let botName: string | null = null;
  if (token) {
    try {
      const info = await lineApi(token, '/v2/bot/info');
      if (!info.ok) {
        res.status(400).json({ error: 'チャネルアクセストークンが正しくありません（LINE から拒否されました）' });
        return;
      }
      basicId = info.data?.basicId || null;
      botName = info.data?.displayName || null;
      check.bot = `${botName}（${basicId}）`;
      if (secret) {
        const set = await lineApi(token, '/v2/bot/channel/webhook/endpoint', { method: 'PUT', body: { endpoint: webhookUrl(companyId) } });
        check.webhook = set.ok ? 'Webhook URL を登録しました' : `Webhook URL の登録に失敗（${set.status}）`;
      }
    } catch (err: any) {
      check.error = `LINE に接続できませんでした: ${err?.message || err}`;
    }
  }

  db.prepare(`
    INSERT INTO line_settings (company_id, channel_access_token, channel_secret, bot_basic_id, bot_name, notify_shift_published, notify_shift_changed, notify_help_request, notify_request_open)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET
      channel_access_token = excluded.channel_access_token,
      channel_secret = excluded.channel_secret,
      bot_basic_id = COALESCE(excluded.bot_basic_id, line_settings.bot_basic_id),
      bot_name = COALESCE(excluded.bot_name, line_settings.bot_name),
      notify_shift_published = excluded.notify_shift_published,
      notify_shift_changed = excluded.notify_shift_changed,
      notify_help_request = excluded.notify_help_request,
      notify_request_open = excluded.notify_request_open
  `).run(companyId, token || null, secret || null, basicId, botName,
    notify_shift_published ? 1 : 0, notify_shift_changed ? 1 : 0, notify_help_request ? 1 : 0,
    notify_request_open === undefined ? 1 : (notify_request_open ? 1 : 0));

  // 登録直後に LINE 側から疎通テストを打ってもらう（署名検証まで通るかの確認）
  if (token && secret && check.webhook?.startsWith('Webhook URL を登録')) {
    try {
      const t = await lineApi(token, '/v2/bot/channel/webhook/test', { method: 'POST', body: { endpoint: webhookUrl(companyId) } });
      check.webhook += t.data?.success ? '・疎通OK' : `・疎通NG（${t.data?.reason || t.data?.detail || t.status}）`;
    } catch { /* 疎通テストの失敗は保存を止めない */ }
  }

  res.json({ message: 'LINE設定を保存しました', check });
});

// POST /api/line/link-code - 自分用の連携コードを発行（スタッフ・管理者どちらも）
router.post('/link-code', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const s = db.prepare('SELECT channel_access_token, channel_secret, bot_basic_id, bot_name FROM line_settings WHERE company_id = ?').get(req.companyId!) as any;
  if (!s?.channel_access_token || !s?.channel_secret || !s?.bot_basic_id) {
    res.status(409).json({ error: 'このお店はまだ LINE 通知の設定をしていません', configured: false });
    return;
  }
  db.prepare("DELETE FROM line_link_codes WHERE expires_at < datetime('now') OR (user_id = ? AND company_id = ?)").run(req.user!.id, req.companyId!);
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = String(crypto.randomInt(100000, 1000000));
    if (!db.prepare('SELECT 1 FROM line_link_codes WHERE code = ?').get(code)) break;
  }
  db.prepare(`INSERT INTO line_link_codes (code, user_id, company_id, expires_at) VALUES (?, ?, ?, datetime('now', '+${LINK_CODE_MINUTES} minutes'))`)
    .run(code, req.user!.id, req.companyId!);
  res.json({
    code, minutes: LINK_CODE_MINUTES,
    bot_name: s.bot_name, basic_id: s.bot_basic_id,
    add_friend_url: addFriendUrl(s.bot_basic_id),
    send_code_url: sendCodeUrl(s.bot_basic_id, code),
  });
});

// GET /api/line/me - 自分が連携済みか、お店が LINE を設定済みか
router.get('/me', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const s = db.prepare('SELECT channel_secret, bot_basic_id, bot_name FROM line_settings WHERE company_id = ? AND channel_access_token IS NOT NULL').get(req.companyId!) as any;
  const linked = !!db.prepare('SELECT 1 FROM user_line_ids WHERE user_id = ?').get(req.user!.id);
  res.json({ configured: !!(s?.channel_secret && s?.bot_basic_id), bot_name: s?.bot_name || null, linked });
});

// DELETE /api/line/me - 連携解除
router.delete('/me', authenticateToken, (req: AuthRequest, res: Response): void => {
  db.prepare('DELETE FROM user_line_ids WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

// POST /api/line/register - (旧) LINE userId を直接登録。互換のため残す
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
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const sent = await notifyCompanyStaff(req.companyId!, '【シフトログ】LINE通知のテストです。正常に動作しています。');
  if (sent === 0) {
    res.status(400).json({ error: 'LINE を連携している人がまだいません。先に「LINEで通知を受け取る」から連携してください' });
    return;
  }
  res.json({ message: `テスト通知を${sent}人に送信しました`, sent });
});

// POST /api/line/webhook/:companyId - お店ごとの LINE 公式アカウントからのイベント
router.post('/webhook/:companyId', async (req: Request, res: Response): Promise<void> => {
  const companyId = parseInt(req.params.companyId);
  const s = db.prepare('SELECT channel_access_token, channel_secret FROM line_settings WHERE company_id = ?').get(companyId) as any;
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  const signature = String(req.headers['x-line-signature'] || '');
  if (!s?.channel_secret || !signature) { res.status(401).json({ error: 'unauthorized' }); return; }
  const expected = crypto.createHmac('sha256', s.channel_secret).update(raw).digest('base64');
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { res.status(401).json({ error: 'invalid signature' }); return; }

  let body: any = {};
  try { body = JSON.parse(raw.toString('utf8')); } catch { body = {}; }
  // LINE には先に 200 を返す（返信は replyToken で後から送れる）
  res.json({ status: 'ok' });

  for (const event of body.events || []) {
    const lineUserId: string | undefined = event.source?.userId;
    if (!lineUserId) continue;
    try {
      if (event.type === 'follow' && event.replyToken) {
        await replyLine(s.channel_access_token, event.replyToken,
          '友だち追加ありがとうございます。\nシフトの通知を受け取るには、シフトログの「LINEで通知を受け取る」に表示される6桁の連携コードを、このトークに送ってください。');
      } else if (event.type === 'unfollow') {
        db.prepare('DELETE FROM user_line_ids WHERE line_user_id = ?').run(lineUserId);
      } else if (event.type === 'message' && event.message?.type === 'text' && event.replyToken) {
        const text = String(event.message.text);
        const m = text.match(/\d{6}/);
        if (!m) {
          if (/希望|シフト/.test(text)) await replyRequestLink(companyId, lineUserId, s.channel_access_token, event.replyToken);
          continue;
        }
        const row = db.prepare(`
          SELECT lc.user_id, u.name FROM line_link_codes lc JOIN users u ON u.id = lc.user_id
          WHERE lc.code = ? AND lc.company_id = ? AND lc.expires_at >= datetime('now')
        `).get(m[0], companyId) as any;
        if (!row) {
          await replyLine(s.channel_access_token, event.replyToken, 'この連携コードは見つからないか、期限切れです。アプリでもう一度コードを表示してください。');
          continue;
        }
        db.prepare(`
          INSERT INTO user_line_ids (user_id, line_user_id) VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET line_user_id = excluded.line_user_id
        `).run(row.user_id, lineUserId);
        db.prepare('DELETE FROM line_link_codes WHERE code = ?').run(m[0]);
        await replyLine(s.channel_access_token, event.replyToken, `${row.name}さん、連携できました。\nシフトが公開されたら、このLINEでお知らせします。`);
      }
    } catch (err) {
      console.error('[line] webhook 処理失敗:', (err as Error).message);
    }
  }
});

// トークで「希望」と送られたら、受付中の月の本人専用リンクを返す（返信なので通数に数えられない）
async function replyRequestLink(companyId: number, lineUserId: string, token: string, replyToken: string) {
  const who = db.prepare(`
    SELECT u.id, u.name FROM user_line_ids uli
    JOIN users u ON u.id = uli.user_id AND u.is_active = 1
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    WHERE uli.line_user_id = ?
  `).get(companyId, lineUserId) as any;
  if (!who) {
    await replyLine(token, replyToken, 'まだシフトログと連携されていません。アプリの「LINEで通知を受け取る」に出る6桁のコードをこのトークに送ってください。');
    return;
  }
  const open = db.prepare(`
    SELECT year, month, start_date, end_date, deadline FROM shift_request_periods
    WHERE company_id = ? AND status = 'open' ORDER BY year DESC, month DESC
  `).all(companyId) as any[];
  if (open.length === 0) {
    await replyLine(token, replyToken, '今はシフト希望の受付をしていません。受付が始まったらこのLINEでお知らせします。');
    return;
  }
  await replyLine(token, replyToken, requestCard('希望の提出はこちら', who.name, open.slice(0, 10), p => requestLinkUrl(who.id, companyId, p.year, p.month)));
}

// POST /api/line/webhook - 旧URL（会社IDなし）。何もしない
router.post('/webhook', (_req, res) => { res.json({ status: 'ok' }); });

export default router;
