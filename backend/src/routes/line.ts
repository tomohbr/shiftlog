import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest, JWT_SECRET } from '../middleware/auth';
import { absenceRule, phoneOnly, phoneOnlyMessage } from '../utils/absenceRule';

// LINE 連携（お店ごとの LINE 公式アカウント → スタッフへの通知）
//
// 流れ:
//   1. 管理者が LINE 公式アカウントの「チャネルアクセストークン」と「チャネルシークレット」を貼って保存
//      → サーバーが Bot 情報（@ID・名前）を取りに行き、Webhook URL も LINE 側に自動で登録する
//   2. スタッフはアプリの「LINEで通知を受け取る」→ 友だち追加 → 表示された6桁の連携コードをトークに送る
//      （oaMessage リンクでコード入りのトーク画面が開くので、押して送信するだけ）
//   3. Webhook がコードを受け取り、そのスタッフと LINE の userId を結びつける
//   4. 以後、シフト公開・希望収集の開始などを LINE で送る
//   5. 希望収集の案内・催促・シフト公開には本人専用のリンクを付ける。LINE から開くと名前選択なしで
//      その月の希望提出画面／シフト画面に入れる
//   6. トーク画面の下にメニュー（シフトを見る・希望を出す・休みの連絡・打刻のしかた）を付ける。押すと本人専用の
//      カードを返信する（返信なので無料プランの通数に数えない）。文字で「シフト」「希望」と送っても同じ

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

export type LinkPage = 'requests' | 'shifts';

export function requestLinkUrl(userId: number, companyId: number, year: number, month: number, page: LinkPage = 'requests'): string {
  const t = jwt.sign({ uid: userId, cid: companyId, y: year, m: month, ...(page === 'shifts' ? { p: 's' } : {}) }, LINK_SECRET, { expiresIn: `${REQUEST_LINK_DAYS}d` });
  return `${APP_URL}/l/${t}`;
}

export function verifyRequestLink(token: string): { uid: number; cid: number; y: number; m: number; page: LinkPage } | null {
  try {
    const d = jwt.verify(token, LINK_SECRET) as any;
    if (!d?.uid || !d?.cid || !d?.y || !d?.m) return null;
    return { uid: Number(d.uid), cid: Number(d.cid), y: Number(d.y), m: Number(d.m), page: d.p === 's' ? 'shifts' : 'requests' };
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
  const s = db.prepare('SELECT notify_shift_published, channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any;
  if (!s || s.notify_shift_published === 0 || !s.channel_access_token) return;
  (async () => {
    for (const r of linkedMembers(companyId)) {
      const card = shiftsCard(companyId, r.user_id, r.name, `${month}月のシフトが公開されました`, [{ year, month }]);
      await sendLineMessage(s.channel_access_token, r.line_user_id, card);
    }
  })().catch(() => {});
}

function linkedMembers(companyId: number) {
  return db.prepare(`
    SELECT uli.user_id, uli.line_user_id, u.name FROM user_line_ids uli
    JOIN user_companies uc ON uc.user_id = uli.user_id AND uc.company_id = ?
    JOIN users u ON u.id = uli.user_id AND u.is_active = 1
  `).all(companyId) as { user_id: number; line_user_id: string; name: string }[];
}

const jstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const md2 = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return `${m}/${dd}（${'日月火水木金土'[new Date(y, m - 1, dd).getDay()]}）`;
};

// シフトを見るカード: 次の勤務を書いて、月ごとのボタンで自分のシフト画面を開く
function shiftsCard(companyId: number, userId: number, name: string, heading: string, months: { year: number; month: number }[]) {
  const next = db.prepare(`
    SELECT s.date, s.start_time, s.end_time, st.name AS store_name FROM shifts s
    LEFT JOIN stores st ON st.id = s.store_id
    JOIN shift_publications p ON p.company_id = s.company_id AND p.is_published = 1
      AND p.year = CAST(substr(s.date, 1, 4) AS INTEGER) AND p.month = CAST(substr(s.date, 6, 2) AS INTEGER)
    WHERE s.company_id = ? AND s.user_id = ? AND s.date >= ?
    ORDER BY s.date, s.start_time LIMIT 1
  `).get(companyId, userId, jstToday()) as any;
  const nextBox = next
    ? [
        { type: 'text', text: '次の勤務', size: 'xs', color: '#888888' },
        { type: 'text', text: `${md2(next.date)} ${String(next.start_time).slice(0, 5)}–${String(next.end_time).slice(0, 5)}`, size: 'lg', weight: 'bold', wrap: true },
        ...(next.store_name ? [{ type: 'text', text: `📍 ${next.store_name}`, size: 'md', weight: 'bold', color: '#E8590C', wrap: true }] : []),
      ]
    : [{ type: 'text', text: '公開済みのこれからの勤務はありません', size: 'sm', color: '#888888', wrap: true }];
  return {
    type: 'flex',
    altText: `【シフトログ】${heading}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: heading, weight: 'bold', size: 'md', wrap: true },
          { type: 'box', layout: 'vertical', spacing: 'xs', contents: nextBox },
          { type: 'text', text: `${name}さん専用のボタンです。名前を選ばずに開けます。`, size: 'xs', color: '#888888', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: months.map((p, i) => ({
          type: 'button', style: i === 0 ? 'primary' : 'secondary', color: i === 0 ? '#1C7ED6' : undefined,
          action: { type: 'uri', label: `${p.month}月のシフトを見る`, uri: requestLinkUrl(userId, companyId, p.year, p.month, 'shifts') },
        })),
      },
    },
  };
}

// シフト変更のお知らせカード（変更前は取り消し線、変更後を太字で）
type Snap = { date: string; start_time: string; end_time: string; store_name: string | null };
const snapText = (x: Snap) => `${x.store_name ? x.store_name + ' ' : ''}${String(x.start_time).slice(0, 5)}–${String(x.end_time).slice(0, 5)}`;

export async function sendShiftChangeCard(companyId: number, userId: number, name: string, changes: { before: Snap | null; after: Snap | null }[]): Promise<boolean> {
  const s = db.prepare('SELECT channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any;
  const to = db.prepare('SELECT line_user_id FROM user_line_ids WHERE user_id = ?').get(userId) as any;
  if (!s?.channel_access_token || !to) return false;
  const rows = changes.slice(0, 12).map(c => {
    const d = (c.after || c.before)!.date;
    const lines: any[] = [{ type: 'text', text: md2(d), weight: 'bold', size: 'md' }];
    if (c.before && c.after && c.before.date !== c.after.date) lines[0].text = `${md2(c.before.date)} → ${md2(c.after.date)}`;
    if (c.before) lines.push({ type: 'text', text: c.after ? snapText(c.before) : `${snapText(c.before)}`, size: 'sm', color: '#999999', decoration: 'line-through', wrap: true });
    lines.push(c.after
      ? { type: 'text', text: `${c.before ? '→ ' : '追加 '}${snapText(c.after)}`, size: 'md', weight: 'bold', color: c.before ? '#1C7ED6' : '#2F9E44', wrap: true }
      : { type: 'text', text: 'この日はお休みになりました', size: 'md', weight: 'bold', color: '#E03131', wrap: true });
    return { type: 'box', layout: 'vertical', spacing: 'xs', contents: lines };
  });
  const first = (changes[0].after || changes[0].before)!.date;
  const card = {
    type: 'flex',
    altText: `【シフトログ】シフトが変わりました（${changes.length}件）`,
    contents: {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'lg',
        contents: [
          { type: 'text', text: `${name}さんのシフトが変わりました`, weight: 'bold', size: 'md', wrap: true },
          ...rows,
          ...(changes.length > 12 ? [{ type: 'text', text: `ほか${changes.length - 12}件`, size: 'sm', color: '#888888' }] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: '#1C7ED6', action: { type: 'uri', label: 'シフトを見る', uri: requestLinkUrl(userId, companyId, Number(first.slice(0, 4)), Number(first.slice(5, 7)), 'shifts') } }],
      },
    },
  };
  return sendLineMessage(s.channel_access_token, to.line_user_id, card);
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

  // トーク画面のメニューも付けておく（失敗しても保存は成功扱い）
  if (token && secret) {
    try {
      const rm = await installRichMenu(companyId);
      (check as any).menu = rm.ok ? 'トーク画面のメニューを付けました' : rm.error;
    } catch { /* メニューの失敗は保存を止めない */ }
  }

  res.json({ message: 'LINE設定を保存しました', check });
});

// POST /api/line/absence-rule { days, phone } - 休みを電話でしか受けない日と、その電話番号（管理者）
router.post('/absence-rule', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const raw = req.body?.days;
  const days = raw === null || raw === '' || raw === undefined ? null : Number(raw);
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 7)) { res.status(400).json({ error: '日数が正しくありません' }); return; }
  const phone = String(req.body?.phone || '').trim() || null;
  db.prepare('INSERT INTO line_settings (company_id) VALUES (?) ON CONFLICT(company_id) DO NOTHING').run(req.companyId!);
  db.prepare('UPDATE line_settings SET absence_phone_days = ?, absence_phone = ? WHERE company_id = ?').run(days, phone, req.companyId!);
  res.json({ message: '休みの連絡のルールを保存しました' });
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

// ---- 招待リンク（ログインなしで LINE 連携まで済ませる）----
// 管理者がスタッフごとの招待QR/リンクを出す → スタッフが開く → 「○○さんですか？」→ 友だち追加 → コードを送る
const INVITE_SECRET = `${JWT_SECRET}:line-invite`;
const INVITE_DAYS = 60;

const inviteUrl = (userId: number, companyId: number) =>
  `${APP_URL}/i/${jwt.sign({ iu: userId, ic: companyId }, INVITE_SECRET, { expiresIn: `${INVITE_DAYS}d` })}`;

function verifyInvite(token: string): { uid: number; cid: number } | null {
  try {
    const d = jwt.verify(token, INVITE_SECRET) as any;
    if (!d?.iu || !d?.ic) return null;
    // 退職などで会社から外れた人の招待は使えない
    const ok = db.prepare(`
      SELECT 1 FROM user_companies uc JOIN users u ON u.id = uc.user_id AND u.is_active = 1
      WHERE uc.user_id = ? AND uc.company_id = ?
    `).get(d.iu, d.ic);
    return ok ? { uid: Number(d.iu), cid: Number(d.ic) } : null;
  } catch { return null; }
}

function issueLinkCode(userId: number, companyId: number): string {
  db.prepare("DELETE FROM line_link_codes WHERE expires_at < datetime('now') OR (user_id = ? AND company_id = ?)").run(userId, companyId);
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = String(crypto.randomInt(100000, 1000000));
    if (!db.prepare('SELECT 1 FROM line_link_codes WHERE code = ?').get(code)) break;
  }
  db.prepare(`INSERT INTO line_link_codes (code, user_id, company_id, expires_at) VALUES (?, ?, ?, datetime('now', '+${LINK_CODE_MINUTES} minutes'))`)
    .run(code, userId, companyId);
  return code;
}

// POST /api/line/invite-links { user_ids? } - スタッフごとの招待リンク（管理者）。省略時は全員分
router.post('/invite-links', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const only: number[] | null = Array.isArray(req.body?.user_ids) ? req.body.user_ids.map(Number) : null;
  const members = membersWithLink(req.companyId!).filter(m => !only || only.includes(m.id));
  const company = db.prepare('SELECT name FROM companies WHERE id = ?').get(req.companyId!) as any;
  res.json({
    company_name: company?.name || '',
    links: members.map(m => ({ user_id: m.id, name: m.name, role: m.role, linked: !!m.linked, url: inviteUrl(m.id, req.companyId!) })),
  });
});

// GET /api/line/invite/:token - 招待を開いた人に見せる情報（ログイン不要）
router.get('/invite/:token', (req: Request, res: Response): void => {
  const inv = verifyInvite(req.params.token);
  if (!inv) { res.status(404).json({ error: 'この招待は期限切れか無効です。お店の人に新しい招待をもらってください' }); return; }
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(inv.uid) as any;
  const c = db.prepare('SELECT name FROM companies WHERE id = ?').get(inv.cid) as any;
  const s = db.prepare('SELECT bot_basic_id, bot_name, channel_secret FROM line_settings WHERE company_id = ? AND channel_access_token IS NOT NULL').get(inv.cid) as any;
  const linked = !!db.prepare('SELECT 1 FROM user_line_ids WHERE user_id = ?').get(inv.uid);
  res.json({
    name: u?.name || '', company_name: c?.name || '',
    configured: !!(s?.bot_basic_id && s?.channel_secret), bot_name: s?.bot_name || null,
    add_friend_url: s?.bot_basic_id ? addFriendUrl(s.bot_basic_id) : null,
    linked,
  });
});

// POST /api/line/invite/:token/code - 連携コードを発行して、コード入りのトークを開くリンクを返す（ログイン不要）
router.post('/invite/:token/code', (req: Request, res: Response): void => {
  const inv = verifyInvite(req.params.token);
  if (!inv) { res.status(404).json({ error: 'この招待は期限切れか無効です' }); return; }
  const s = db.prepare('SELECT bot_basic_id FROM line_settings WHERE company_id = ? AND channel_access_token IS NOT NULL').get(inv.cid) as any;
  if (!s?.bot_basic_id) { res.status(409).json({ error: 'このお店はまだ LINE の設定をしていません' }); return; }
  const code = issueLinkCode(inv.uid, inv.cid);
  res.json({ code, minutes: LINK_CODE_MINUTES, send_code_url: sendCodeUrl(s.bot_basic_id, code) });
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
      if (event.type === 'postback' && event.replyToken) {
        const data = String(event.postback?.data || '');
        if (data.startsWith('menu=')) await replyMenu(data.replace('menu=', ''), companyId, lineUserId, s.channel_access_token, event.replyToken);
        else await handleAbsencePostback(new URLSearchParams(data), companyId, lineUserId, s.channel_access_token, event.replyToken);
      } else if (event.type === 'follow' && event.replyToken) {
        await replyLine(s.channel_access_token, event.replyToken,
          '友だち追加ありがとうございます。\nシフトの通知を受け取るには、シフトログの「LINEで通知を受け取る」に表示される6桁の連携コードを、このトークに送ってください。');
      } else if (event.type === 'unfollow') {
        db.prepare('DELETE FROM user_line_ids WHERE line_user_id = ?').run(lineUserId);
      } else if (event.type === 'message' && event.message?.type === 'text' && event.replyToken) {
        const text = String(event.message.text);
        const m = text.match(/\d{6}/);
        if (!m) {
          const what = /希望/.test(text) ? 'requests' : /休み|欠勤|休む/.test(text) ? 'absent' : /シフト|予定/.test(text) ? 'shifts' : /打刻|出勤|退勤|QR/i.test(text) ? 'howto' : '';
          if (what) await replyMenu(what, companyId, lineUserId, s.channel_access_token, event.replyToken);
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
        await replyLine(s.channel_access_token, event.replyToken,
          `${row.name}さん、連携できました🎉\n\nこれからはこのLINEで\n・シフトの公開\n・希望の受付\nをお知らせします。\n\nトーク画面の下のメニューから、いつでも「シフトを見る」「希望を出す」ができます。`);
      }
    } catch (err) {
      console.error('[line] webhook 処理失敗:', (err as Error).message);
    }
  }
});

// メニュー（またはキーワード）への返信
async function replyMenu(what: string, companyId: number, lineUserId: string, token: string, replyToken: string) {
  if (what === 'requests') return replyRequestLink(companyId, lineUserId, token, replyToken);
  if (what === 'absent') return replyAbsentPicker(companyId, lineUserId, token, replyToken);
  if (what === 'howto') {
    const liff = (db.prepare('SELECT liff_id FROM line_settings WHERE company_id = ?').get(companyId) as any)?.liff_id;
    return replyLine(token, replyToken, liff
      ? `【打刻のしかた】\n① このトーク画面の下のメニュー「打刻する」を押す\n②「ブースのQRを読む」を押して、ブースに貼ってあるQRを読む\n③「出勤」「休憩開始」「休憩終了」「退勤」を押す\n\nLINEで本人を確かめるので、名前を選ぶ必要はありません。自分の分しか打刻できません。\nhttps://liff.line.me/${liff}`
      : '【打刻のしかた】\n① 会場のブースに貼ってある「打刻用QR」をスマホのカメラで読み取る\n② 初めてのときだけ自分の名前を選ぶ\n③「出勤」「休憩」「休憩終わり」「退勤」の大きなボタンを押す\n\n押した時刻と会場が記録されます。今日の予定と違う会場のQRだと注意が出ますが、ヘルプで入るときはそのまま押してOKです。');
  }
  if (what !== 'shifts') return;
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
  // 今月と、公開済みなら来月
  const t = jstToday();
  const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7));
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
  const months = [{ year: y, month: m }];
  const nextPublished = db.prepare('SELECT 1 FROM shift_publications WHERE company_id = ? AND year = ? AND month = ? AND is_published = 1').get(companyId, ny, nm);
  if (nextPublished) months.push({ year: ny, month: nm });
  await replyLine(token, replyToken, shiftsCard(companyId, who.id, who.name, `${who.name}さんのシフト`, months));
}

// ---- 休みの連絡と代わりの募集（すべて LINE の中で完結）----
// スタッフ: メニュー「休みの連絡」→ 休むシフトを選ぶ → 理由を選ぶ → 管理者に届く
// 管理者: 「代わりを募集」→ その日空いている人に「入れます」ボタン付きで届く → 手を挙げた人から選ぶ → シフトが差し替わり、本人たちに届く
const REASONS = ['体調不良', '急用', 'その他'];

db.exec(`
  CREATE TABLE IF NOT EXISTS cover_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    absence_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(absence_id, user_id)
  );
`);

function lineMember(companyId: number, lineUserId: string) {
  return db.prepare(`
    SELECT u.id, u.name, u.role, uc.role AS company_role FROM user_line_ids uli
    JOIN users u ON u.id = uli.user_id AND u.is_active = 1
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    WHERE uli.line_user_id = ?
  `).get(companyId, lineUserId) as { id: number; name: string; role: string; company_role: string } | undefined;
}
const isAdminMember = (m?: { role: string; company_role: string }) =>
  !!m && (['admin', 'super_admin'].includes(m.role) || m.company_role === 'admin');

function shiftWithStore(shiftId: number) {
  return db.prepare(`
    SELECT s.*, st.name AS store_name, u.name AS user_name FROM shifts s
    LEFT JOIN stores st ON st.id = s.store_id JOIN users u ON u.id = s.user_id WHERE s.id = ?
  `).get(shiftId) as any;
}
const shiftLabel = (s: any) => `${md2(s.date)} ${s.store_name ? s.store_name + ' ' : ''}${String(s.start_time).slice(0, 5)}–${String(s.end_time).slice(0, 5)}`;

function buttonsCard(altText: string, title: string, lines: string[], buttons: { label: string; data?: string; uri?: string; primary?: boolean; color?: string }[]) {
  return {
    type: 'flex', altText,
    contents: {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'md', wrap: true },
          ...lines.map(t => ({ type: 'text', text: t, size: 'sm', color: '#555555', wrap: true })),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: buttons.map(b => ({
          type: 'button', style: b.primary ? 'primary' : 'secondary', height: 'sm',
          ...(b.primary ? { color: b.color || '#1C7ED6' } : {}),
          action: b.uri ? { type: 'uri', label: b.label.slice(0, 40), uri: b.uri } : { type: 'postback', label: b.label.slice(0, 40), data: b.data, displayText: b.label },
        })),
      },
    },
  };
}

function adminLineIds(companyId: number): string[] {
  return (db.prepare(`
    SELECT uli.line_user_id FROM user_line_ids uli
    JOIN users u ON u.id = uli.user_id AND u.is_active = 1
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    WHERE uc.role = 'admin' OR u.role IN ('admin', 'super_admin')
  `).all(companyId) as { line_user_id: string }[]).map(r => r.line_user_id);
}

// メニュー「休みの連絡」: これからの自分のシフト（公開済み・30日以内）をボタンで出す
async function replyAbsentPicker(companyId: number, lineUserId: string, token: string, replyToken: string) {
  const me = lineMember(companyId, lineUserId);
  if (!me) { await replyLine(token, replyToken, 'まだシフトログと連携されていません。お店の人からもらった招待QRを読んでください。'); return; }
  const today = jstToday();
  const limit = new Date(Date.now() + 9 * 3600 * 1000 + 30 * 86400 * 1000).toISOString().slice(0, 10);
  const shifts = db.prepare(`
    SELECT s.id, s.date, s.start_time, s.end_time, s.store_id, st.name AS store_name FROM shifts s
    LEFT JOIN stores st ON st.id = s.store_id
    JOIN shift_publications p ON p.company_id = s.company_id AND p.is_published = 1
      AND p.year = CAST(substr(s.date, 1, 4) AS INTEGER) AND p.month = CAST(substr(s.date, 6, 2) AS INTEGER)
    WHERE s.company_id = ? AND s.user_id = ? AND s.date >= ? AND s.date <= ?
    ORDER BY s.date, s.start_time LIMIT 8
  `).all(companyId, me.id, today, limit) as any[];
  if (shifts.length === 0) { await replyLine(token, replyToken, 'この先30日に、公開済みのシフトはありません。'); return; }
  // 前日・当日など電話でしか受けない日は、押すと電話がかかるボタンにする
  const rule = absenceRule(companyId);
  const anyPhone = shifts.some(x => phoneOnly(companyId, x.date, x.store_id));
  await replyLine(token, replyToken, buttonsCard('休みの連絡', 'どのシフトを休みますか？',
    ['押すと、理由を選ぶ画面になります。', ...(anyPhone ? [phoneOnlyMessage(companyId).split('\n')[0]] : [])],
    shifts.map(x => {
      if (!phoneOnly(companyId, x.date, x.store_id)) return { label: shiftLabel(x), data: `a=pick&s=${x.id}` };
      const tel = absenceRule(companyId, x.store_id).phone || rule.phone;
      return tel
        ? { label: `📞 ${shiftLabel(x)}`, uri: `tel:${tel.replace(/[^0-9+]/g, '')}` }
        : { label: `📞 ${shiftLabel(x)}`, data: `a=phone&s=${x.id}` };
    })));
}

async function handleAbsencePostback(q: URLSearchParams, companyId: number, lineUserId: string, token: string, replyToken: string) {
  const a = q.get('a');
  const me = lineMember(companyId, lineUserId);
  if (!me) { await replyLine(token, replyToken, 'まだシフトログと連携されていません。'); return; }

  // 電話でしか受けない日（番号が未設定のとき）
  if (a === 'phone') {
    const sh = shiftWithStore(Number(q.get('s')));
    await replyLine(token, replyToken, phoneOnlyMessage(companyId, sh?.store_id));
    return;
  }

  // スタッフ: 休むシフトを選んだ → 理由を選ぶ
  if (a === 'pick') {
    const sh = shiftWithStore(Number(q.get('s')));
    if (!sh || sh.user_id !== me.id || sh.company_id !== companyId) { await replyLine(token, replyToken, 'このシフトは見つかりませんでした。'); return; }
    if (phoneOnly(companyId, sh.date, sh.store_id)) { await replyLine(token, replyToken, phoneOnlyMessage(companyId, sh.store_id)); return; }
    await replyLine(token, replyToken, buttonsCard('休みの理由', `${shiftLabel(sh)} を休みます`, ['理由を選ぶと、店長に届きます。'],
      [...REASONS.map((r, i) => ({ label: r, data: `a=report&s=${sh.id}&r=${i}`, primary: i === 0, color: '#E03131' }))]));
    return;
  }

  // スタッフ: 理由を選んだ → 記録して管理者に知らせる
  if (a === 'report') {
    const sh = shiftWithStore(Number(q.get('s')));
    if (!sh || sh.user_id !== me.id || sh.company_id !== companyId) { await replyLine(token, replyToken, 'このシフトは見つかりませんでした。'); return; }
    // 古いカードを後から押した場合も、前日・当日になっていたら電話へ
    if (phoneOnly(companyId, sh.date, sh.store_id)) { await replyLine(token, replyToken, phoneOnlyMessage(companyId, sh.store_id)); return; }
    const reason = REASONS[Number(q.get('r'))] || 'その他';
    let ab = db.prepare("SELECT * FROM absence_reports WHERE shift_id = ? AND status IN ('pending','recruiting')").get(sh.id) as any;
    if (!ab) {
      const r = db.prepare('INSERT INTO absence_reports (company_id, user_id, shift_id, date, reason) VALUES (?, ?, ?, ?, ?)').run(companyId, me.id, sh.id, sh.date, reason);
      ab = { id: Number(r.lastInsertRowid) };
    }
    await replyLine(token, replyToken, `${shiftLabel(sh)} のお休みを店長に伝えました。\n代わりが決まったら、このLINEでお知らせします。お大事にしてください。`);
    const card = buttonsCard(`${me.name}さんから休みの連絡`, `${me.name}さんが休みます`, [shiftLabel(sh), `理由: ${reason}`],
      [{ label: '代わりを募集する', data: `a=recruit&ab=${ab.id}`, primary: true }, { label: 'シフト画面を開く', uri: `${APP_URL}/shifts` }]);
    for (const id of adminLineIds(companyId)) await sendLineMessage(token, id, card);
    return;
  }

  // 管理者: 代わりを募集 → その日空いている人に「入れます」
  if (a === 'recruit') {
    if (!isAdminMember(me)) { await replyLine(token, replyToken, 'この操作は店長だけができます。'); return; }
    const ab = db.prepare('SELECT * FROM absence_reports WHERE id = ? AND company_id = ?').get(Number(q.get('ab')), companyId) as any;
    const sh = ab?.shift_id ? shiftWithStore(ab.shift_id) : null;
    if (!ab || !sh) { await replyLine(token, replyToken, 'このお休みの連絡は見つかりませんでした。'); return; }
    if (ab.status === 'covered') { await replyLine(token, replyToken, 'もう代わりが決まっています。'); return; }
    // その日にシフトがない・「出られない」と出していない・LINE連携済みのスタッフ
    const cands = db.prepare(`
      SELECT u.id, u.name, uli.line_user_id FROM user_companies uc
      JOIN users u ON u.id = uc.user_id AND u.is_active = 1
      JOIN user_line_ids uli ON uli.user_id = u.id
      WHERE uc.company_id = ? AND uc.role = 'staff' AND u.id != ?
        AND NOT EXISTS (SELECT 1 FROM shifts x WHERE x.company_id = uc.company_id AND x.user_id = u.id AND x.date = ?
          AND NOT (x.end_time <= ? OR x.start_time >= ?))
        AND NOT EXISTS (SELECT 1 FROM shift_requests r WHERE r.company_id = uc.company_id AND r.user_id = u.id AND r.date = ? AND r.availability = 'unavailable')
      ORDER BY u.name
    `).all(companyId, sh.user_id, sh.date, sh.start_time, sh.end_time, sh.date) as any[];
    if (cands.length === 0) { await replyLine(token, replyToken, `${shiftLabel(sh)} に入れそうな人（LINE連携済み・その日空いている人）がいません。電話などで探してください。`); return; }
    db.prepare("UPDATE absence_reports SET status = 'recruiting', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(ab.id);
    const card = buttonsCard('代わりに入れる人を探しています', '代わりに入れる人を探しています', [shiftLabel(sh), '入れる場合はボタンを押してください。店長が決めたらお知らせします。'],
      [{ label: '入れます', data: `a=offer&ab=${ab.id}`, primary: true, color: '#2F9E44' }]);
    let sent = 0;
    for (const c of cands) if (await sendLineMessage(token, c.line_user_id, card)) sent++;
    await replyLine(token, replyToken, `${sent}人に募集を送りました（${cands.map(c => c.name).join('、')}）。\n手を挙げた人がいたら、ここに届きます。`);
    return;
  }

  // スタッフ: 入れます → 管理者に「この人に決める」
  if (a === 'offer') {
    const ab = db.prepare('SELECT * FROM absence_reports WHERE id = ? AND company_id = ?').get(Number(q.get('ab')), companyId) as any;
    const sh = ab?.shift_id ? shiftWithStore(ab.shift_id) : null;
    if (!ab || !sh || ab.status === 'covered') { await replyLine(token, replyToken, 'ありがとうございます。この募集はもう締め切られました。'); return; }
    db.prepare('INSERT OR IGNORE INTO cover_offers (absence_id, user_id) VALUES (?, ?)').run(ab.id, me.id);
    await replyLine(token, replyToken, `ありがとうございます！店長に伝えました。\n${shiftLabel(sh)} に入るかどうか、決まったらお知らせします。`);
    const card = buttonsCard(`${me.name}さんが入れます`, `${me.name}さんが入れます`, [`${shiftLabel(sh)}（${sh.user_name}さんの代わり）`],
      [{ label: `${me.name}さんに決める`, data: `a=decide&ab=${ab.id}&u=${me.id}`, primary: true, color: '#2F9E44' }]);
    for (const id of adminLineIds(companyId)) await sendLineMessage(token, id, card);
    return;
  }

  // 管理者: この人に決める → シフトを差し替えて、本人たちに知らせる
  if (a === 'decide') {
    if (!isAdminMember(me)) { await replyLine(token, replyToken, 'この操作は店長だけができます。'); return; }
    const ab = db.prepare('SELECT * FROM absence_reports WHERE id = ? AND company_id = ?').get(Number(q.get('ab')), companyId) as any;
    const sh = ab?.shift_id ? shiftWithStore(ab.shift_id) : null;
    const cover = db.prepare('SELECT u.id, u.name FROM users u JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ? WHERE u.id = ?').get(companyId, Number(q.get('u'))) as any;
    if (!ab || !sh || !cover) { await replyLine(token, replyToken, '見つかりませんでした。'); return; }
    if (ab.status === 'covered') { await replyLine(token, replyToken, 'もう代わりが決まっています。'); return; }
    const absentUser = sh.user_id;
    db.prepare('UPDATE shifts SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(cover.id, sh.id);
    db.prepare("UPDATE absence_reports SET status = 'covered', cover_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(cover.id, ab.id);
    await replyLine(token, replyToken, `${shiftLabel(sh)} は ${cover.name}さんに決めました。シフトを差し替えて、2人に知らせました。`);
    const coverLine = db.prepare('SELECT line_user_id FROM user_line_ids WHERE user_id = ?').get(cover.id) as any;
    const absentLine = db.prepare('SELECT line_user_id FROM user_line_ids WHERE user_id = ?').get(absentUser) as any;
    if (coverLine) {
      await sendLineMessage(token, coverLine.line_user_id, buttonsCard('シフトに入ることになりました', 'シフトに入ることになりました', [shiftLabel(sh), 'ありがとうございます！'],
        [{ label: 'シフトを見る', uri: requestLinkUrl(cover.id, companyId, Number(sh.date.slice(0, 4)), Number(sh.date.slice(5, 7)), 'shifts'), primary: true }]));
    }
    if (absentLine) await sendLineMessage(token, absentLine.line_user_id, `${shiftLabel(sh)} は ${cover.name}さんが代わりに入ってくれることになりました。`);
    return;
  }
}

// トーク画面の下のメニューを付ける（画像は backend/assets/richmenu.png、2500x843 の4分割）
export async function installRichMenu(companyId: number): Promise<{ ok: boolean; error?: string }> {
  const s = db.prepare('SELECT channel_access_token, rich_menu_id, liff_id FROM line_settings WHERE company_id = ?').get(companyId) as any;
  if (!s?.channel_access_token) return { ok: false, error: 'LINE 通知の設定がまだです' };
  const token = s.channel_access_token;
  const W = 2500, H = 843, w = Math.floor(W / 4);
  const bounds = (i: number) => ({ x: i * w, y: 0, width: i === 3 ? W - 3 * w : w, height: H });
  const area = (i: number, data: string, label: string) => ({
    bounds: bounds(i),
    action: { type: 'postback', data: `menu=${data}`, displayText: label },
  });
  // 「打刻する」は LIFF があれば本人専用の打刻画面を開く。なければ打刻のしかたを返す
  const punchArea = s.liff_id
    ? { bounds: bounds(3), action: { type: 'uri', uri: `https://liff.line.me/${s.liff_id}` } }
    : area(3, 'howto', '打刻のしかた');
  const created = await lineApi(token, '/v2/bot/richmenu', {
    method: 'POST',
    body: {
      size: { width: W, height: H }, selected: true, name: 'shiftlog-menu', chatBarText: 'シフトのメニュー',
      areas: [area(0, 'shifts', 'シフトを見る'), area(1, 'requests', '希望を出す'), area(2, 'absent', '休みの連絡'), punchArea],
    },
  });
  const id = created.data?.richMenuId;
  if (!created.ok || !id) return { ok: false, error: `メニューを作れませんでした（${created.status} ${JSON.stringify(created.data).slice(0, 120)}）` };
  const image = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'richmenu.png'));
  const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${id}/content`, {
    method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` }, body: image,
  });
  if (!up.ok) return { ok: false, error: `メニュー画像を送れませんでした（${up.status}）` };
  const def = await lineApi(token, `/v2/bot/user/all/richmenu/${id}`, { method: 'POST' });
  if (!def.ok) return { ok: false, error: `メニューを既定にできませんでした（${def.status}）` };
  // 前のメニューは消す（作り直しのたびに増えないように）
  if (s.rich_menu_id && s.rich_menu_id !== id) await lineApi(token, `/v2/bot/richmenu/${s.rich_menu_id}`, { method: 'DELETE' }).catch(() => null);
  db.prepare('UPDATE line_settings SET rich_menu_id = ? WHERE company_id = ?').run(id, companyId);
  return { ok: true };
}

// POST /api/line/richmenu - メニューを付け直す（管理者）
router.post('/richmenu', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  try {
    const r = await installRichMenu(req.companyId!);
    if (!r.ok) { res.status(400).json({ error: r.error }); return; }
    res.json({ message: 'LINEのトーク画面にメニューを付けました' });
  } catch (err: any) {
    res.status(500).json({ error: `メニューを付けられませんでした: ${err?.message || err}` });
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
