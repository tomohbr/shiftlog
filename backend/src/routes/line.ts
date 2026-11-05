import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest, JWT_SECRET } from '../middleware/auth';
import { absenceRule, phoneOnly, phoneOnlyMessage } from '../utils/absenceRule';
import { canAddStaff } from '../utils/billing';
import { daysLeft, forUser, isAccepting, campaignPreferences } from '../utils/requestCampaign';
import { computeShortages } from '../utils/shortages';
import { recordShiftChange, snapOf, pendingChanges, markNotified } from '../utils/shiftChanges';
import { mergeBlocks, partNameOf, PART_NAME, ShiftBlock } from '../utils/shiftParts';

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
//   6. トーク画面の下にメニュー（シフトを見る・希望を出す・打刻／休みの連絡・シフトの相談・質問）を付ける。押すと本人専用の
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

export type LinkPage = 'requests' | 'shifts' | 'campaign';

export function requestLinkUrl(userId: number, companyId: number, year: number, month: number, page: LinkPage = 'requests'): string {
  const t = jwt.sign({ uid: userId, cid: companyId, y: year, m: month, ...(page === 'shifts' ? { p: 's' } : {}) }, LINK_SECRET, { expiresIn: `${REQUEST_LINK_DAYS}d` });
  return `${APP_URL}/l/${t}`;
}

// 期間の募集（request_campaigns）の本人専用リンク。開くとその募集の回答画面に入る。
// 締切が先の募集でも途中で切れないよう、締切の3日後まで（最低でも21日）有効にする
export function campaignLinkUrl(userId: number, companyId: number, c: { id: number; start_date: string; deadline: string | null }): string {
  const left = daysLeft(c.deadline);
  const days = Math.max(REQUEST_LINK_DAYS, (left ?? 0) + 3);
  const t = jwt.sign({ uid: userId, cid: companyId, y: Number(c.start_date.slice(0, 4)), m: Number(c.start_date.slice(5, 7)), p: 'c', k: c.id }, LINK_SECRET, { expiresIn: `${days}d` });
  return `${APP_URL}/l/${t}`;
}

export function verifyRequestLink(token: string): { uid: number; cid: number; y: number; m: number; page: LinkPage; campaign_id?: number } | null {
  try {
    const d = jwt.verify(token, LINK_SECRET) as any;
    if (!d?.uid || !d?.cid || !d?.y || !d?.m) return null;
    if (d.p === 'c' && d.k) return { uid: Number(d.uid), cid: Number(d.cid), y: Number(d.y), m: Number(d.m), page: 'campaign', campaign_id: Number(d.k) };
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
  const nb = next ? myBlocks(companyId, userId, next.date, next.date)[0] : null;
  const nextBox = nb
    ? [
        { type: 'text', text: '次の勤務', size: 'xs', color: '#888888' },
        { type: 'text', text: `${md2(nb.date)} ${hm5(nb.start_time)}–${hm5(nb.end_time)}`, size: 'lg', weight: 'bold', wrap: true },
        ...(nb.part ? [{ type: 'text', text: blockPartText(nb), size: 'sm', weight: 'bold', color: '#1C7ED6', wrap: true }] : []),
        ...(nb.store_name ? [{ type: 'text', text: `📍 ${nb.store_name}`, size: 'md', weight: 'bold', color: '#E8590C', wrap: true }] : []),
      ]
    : [{ type: 'text', text: `まだシフトは決まっていません。決まったら、このLINEでお知らせします。`, size: 'sm', color: '#888888', wrap: true }];
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
type Snap = { date: string; start_time: string; end_time: string; store_name: string | null; store_id?: number | null };
const snapText = (companyId: number, x: Snap) => {
  const part = partNameOf(companyId, { date: x.date, start_time: x.start_time, end_time: x.end_time, store_id: x.store_id ?? null });
  return `${x.store_name ? x.store_name + ' ' : ''}${part ? part + ' ' : ''}${hm5(x.start_time)}–${hm5(x.end_time)}`;
};
const hm5 = (t: string) => String(t).slice(0, 5);
// 同じ日・同じ会場で、つながった「追加」どうし・「お休み」どうしは1つにまとめる（昼の部＋夜の部 → 1日通し）
function mergeChanges(changes: { before: Snap | null; after: Snap | null }[]) {
  const key = (c: { before: Snap | null; after: Snap | null }) => { const x = (c.after || c.before)!; return `${x.date} ${hm5(x.start_time)}`; };
  const out: { before: Snap | null; after: Snap | null }[] = [];
  for (const c of [...changes].sort((a, b) => key(a).localeCompare(key(b)))) {
    const last = out[out.length - 1];
    const joins = (x: Snap | null, y: Snap | null) => !!x && !!y && x.date === y.date && (x.store_name ?? '') === (y.store_name ?? '') && hm5(x.end_time) === hm5(y.start_time);
    if (last && !last.before && !c.before && joins(last.after, c.after)) { last.after = { ...last.after!, end_time: c.after!.end_time }; continue; }
    if (last && !last.after && !c.after && joins(last.before, c.before)) { last.before = { ...last.before!, end_time: c.before!.end_time }; continue; }
    out.push({ before: c.before && { ...c.before }, after: c.after && { ...c.after } });
  }
  return out;
}

export async function sendShiftChangeCard(companyId: number, userId: number, name: string, changes: { before: Snap | null; after: Snap | null }[]): Promise<boolean> {
  const s = db.prepare('SELECT channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any;
  const to = db.prepare('SELECT line_user_id FROM user_line_ids WHERE user_id = ?').get(userId) as any;
  if (!s?.channel_access_token || !to) return false;
  changes = mergeChanges(changes);
  const rows = changes.slice(0, 12).map(c => {
    const d = (c.after || c.before)!.date;
    const lines: any[] = [{ type: 'text', text: md2(d), weight: 'bold', size: 'md' }];
    if (c.before && c.after && c.before.date !== c.after.date) lines[0].text = `${md2(c.before.date)} → ${md2(c.after.date)}`;
    if (c.before) lines.push({ type: 'text', text: snapText(companyId, c.before), size: 'sm', color: '#999999', decoration: 'line-through', wrap: true });
    lines.push(c.after
      ? { type: 'text', text: `${c.before ? '→ ' : '追加 '}${snapText(companyId, c.after)}`, size: 'md', weight: 'bold', color: c.before ? '#1C7ED6' : '#2F9E44', wrap: true }
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

// ---- 期間の募集（request_campaigns）の案内カード ----
// 「【クリスマスマーケット】シフトの希望を教えてください」「期間 11/20〜12/25」「締切 11/10（あと7日）」「担当の○○」＋「希望を出す」
export type CampaignCard = { id: number; title: string; start_date: string; end_date: string; deadline: string | null; sent_at?: string | null };

export type CampaignKind = 'open' | 'remind' | 'reply' | 'more';
export function campaignHeading(c: CampaignCard, kind: CampaignKind) {
  if (kind === 'more') return `【${c.title}】人が足りない日の希望を教えてください`;
  return kind === 'remind' ? `【${c.title}】シフトの希望がまだ届いていません` : `【${c.title}】シフトの希望を教えてください`;
}

function campaignBubble(companyId: number, heading: string, name: string, c: CampaignCard, url: string, note?: string) {
  const left = daysLeft(c.deadline);
  const rows: [string, string][] = [['期間', `${md(c.start_date)}〜${md(c.end_date)}`]];
  if (c.deadline) rows.push(['締切', `${md2(c.deadline)}${left !== null && left >= 0 ? `（${left === 0 ? '今日まで' : `あと${left}日`}）` : ''}`]);
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        { type: 'text', text: heading, weight: 'bold', size: 'md', wrap: true },
        {
          type: 'box', layout: 'vertical', spacing: 'xs',
          contents: rows.map(([k, v]) => ({
            type: 'box', layout: 'baseline',
            contents: [
              { type: 'text', text: k, size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: v, size: 'sm', weight: 'bold', flex: 6, wrap: true },
            ],
          })),
        },
        ...(note ? [{ type: 'text', text: note, size: 'sm', color: '#333333', wrap: true }] : []),
        { type: 'text', text: `${W(companyId)}より`, size: 'sm', color: '#555555', wrap: true },
        { type: 'text', text: `${name}さん専用のボタンです。名前を選ばずに開けます。`, size: 'xs', color: '#888888', wrap: true },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'button', style: 'primary', color: '#06C755', action: { type: 'uri', label: '希望を出す', uri: url } }],
    },
  };
}

const MORE_NOTE = 'まだ人が足りない日（白い日）だけ選べます。入れる日があれば、1日でも助かります🙏 すでに出した希望はそのまま残っています。';
export function campaignCard(companyId: number, userId: number, name: string, c: CampaignCard, kind: CampaignKind) {
  const heading = campaignHeading(c, kind);
  const left = daysLeft(c.deadline);
  const alt = `${heading} 期間 ${md(c.start_date)}〜${md(c.end_date)}${c.deadline ? `・締切 ${md(c.deadline)}${left !== null && left >= 0 ? `（あと${left}日）` : ''}` : ''}`;
  return { type: 'flex', altText: alt.slice(0, 400), contents: campaignBubble(companyId, heading, name, c, campaignLinkUrl(userId, companyId, c), kind === 'more' ? MORE_NOTE : undefined) };
}

/**
 * 期間の募集を、LINE 連携済みの人へ本人専用リンク付きで1人1通送る。
 * onlyUserIds を渡すとその人だけ（未回答の人への催促用）。送った人の id を返す
 */
export async function sendCampaignLinks(
  companyId: number, c: CampaignCard, kind: 'open' | 'remind' | 'more', onlyUserIds?: number[],
): Promise<{ sent: number; targets: number; failed: string[] }> {
  const settings = db.prepare('SELECT channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any;
  if (!settings?.channel_access_token) return { sent: 0, targets: 0, failed: [] };
  let rows = linkedMembers(companyId);
  if (onlyUserIds) {
    const only = new Set(onlyUserIds);
    rows = rows.filter(r => only.has(r.user_id));
  }
  let sent = 0;
  const failed: string[] = [];
  for (const r of rows) {
    // 締切は本人の締切（あとから入った人は延びている）で出す
    if (await sendLineMessage(settings.channel_access_token, r.line_user_id, campaignCard(companyId, r.user_id, r.name, forUser(companyId, c, r.user_id), kind))) sent++;
    else failed.push(r.name);
  }
  return { sent, targets: rows.length, failed };
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
  // 担当者の名前（スタッフへの文面で「担当の○○」と出す）。送られたときだけ変える
  if ('contact_name' in (req.body || {})) {
    const contact = String(req.body.contact_name || '').trim().slice(0, 20) || null;
    db.prepare('UPDATE line_settings SET contact_name = ? WHERE company_id = ?').run(contact, req.companyId!);
  }
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

// スタッフから公式LINEに届いた文字のメッセージ（店長への転送は残らないので、ここに控える）
db.exec(`
  CREATE TABLE IF NOT EXISTS line_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    line_user_id TEXT NOT NULL,
    user_id INTEGER,
    name TEXT,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_line_inbox_company ON line_inbox(company_id, created_at);
`);

// GET /api/line/inbox?days=14  届いたメッセージ（新しい順・最大200件）
router.get('/inbox', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 120);
  const rows = db.prepare(`
    SELECT i.id, i.user_id, COALESCE(u.name, i.name) AS name, i.text, i.created_at FROM line_inbox i
    LEFT JOIN users u ON u.id = i.user_id
    WHERE i.company_id = ? AND i.created_at >= datetime('now', ?)
    ORDER BY i.id DESC LIMIT 200
  `).all(req.companyId!, `-${days} days`);
  res.json({ messages: rows });
});

// POST /api/line/message  { user_ids, texts }  管理者から選んだ人へ、文章を1人ずつ送る（最大5通。{名前} はその人の名前に置き換える）
router.post('/message', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const companyId = req.companyId!;
  const settings = db.prepare('SELECT channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any;
  if (!settings?.channel_access_token) { res.status(400).json({ error: 'LINEが設定されていません' }); return; }
  const ids = new Set((Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(Number));
  const texts = (Array.isArray(req.body?.texts) ? req.body.texts : []).map((t: unknown) => String(t ?? '').trim()).filter(Boolean).slice(0, 5);
  if (ids.size === 0 || texts.length === 0) { res.status(400).json({ error: '送る人と文章を入れてください' }); return; }
  const rows = linkedMembers(companyId).filter(r => ids.has(r.user_id));
  let sent = 0;
  const failed: string[] = [];
  for (const r of rows) {
    const given = r.name.split(/[\s　]/)[0];
    try {
      const out = await lineApi(settings.channel_access_token, '/v2/bot/message/push', {
        method: 'POST',
        body: { to: r.line_user_id, messages: texts.map((t: string) => ({ type: 'text', text: t.replace(/\{名前\}/g, given).slice(0, 5000) })) },
      });
      if (out.ok) sent++; else failed.push(r.name);
    } catch { failed.push(r.name); }
  }
  res.json({ sent, targets: rows.length, failed });
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
        const known = lineMember(companyId, lineUserId);
        await replyLine(s.channel_access_token, event.replyToken, known
          ? `${known.name}さん、おかえりなさい。トーク画面の下のメニューから、シフトを見る・希望を出す・休みの連絡・シフトの相談・打刻ができます。`
          : `友だち追加ありがとうございます。\n\nシフトの連絡を受け取るために、このトークに【名前とふりがな】を送ってください。\n例：山田 花子 やまだ はなこ\n\n${W(companyId)}が確認したら「連携できました」とお知らせします。\n（お店からもらった招待QRがある人は、そちらを読んでもOKです）`);
      } else if (event.type === 'unfollow') {
        db.prepare('DELETE FROM user_line_ids WHERE line_user_id = ?').run(lineUserId);
      } else if (event.type === 'message' && event.message?.type === 'text' && event.replyToken) {
        const text = String(event.message.text);
        const who = lineMember(companyId, lineUserId);
        db.prepare('INSERT INTO line_inbox (company_id, line_user_id, user_id, name, text) VALUES (?, ?, ?, ?, ?)')
          .run(companyId, lineUserId, who?.id ?? null, who?.name ?? null, text.slice(0, 2000));
        const m = text.match(/\d{6}/);
        if (!m) {
          await handleText(text.trim(), companyId, lineUserId, s.channel_access_token, event.replyToken);
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
        unlinkOthers(companyId, row.user_id, lineUserId);
        db.prepare(`
          INSERT INTO user_line_ids (user_id, line_user_id) VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET line_user_id = excluded.line_user_id
        `).run(row.user_id, lineUserId);
        db.prepare('DELETE FROM line_link_codes WHERE code = ?').run(m[0]);
        await replyLine(s.channel_access_token, event.replyToken, linkedMsg(companyId, row.name));
      }
    } catch (err) {
      console.error('[line] webhook 処理失敗:', (err as Error).message);
    }
  }
});

// 同じ LINE が、この会社の別のスタッフにもつながっていたら外す（1つの LINE は1人だけ）。
// 先に名前を送って「新しいスタッフ」として作られ、そのあと本人用の招待で元の自分につないだ場合など、
// 作られたばかりで中身のない方（シフトも希望もない）は会社からも外す。
function unlinkOthers(companyId: number, userId: number, lineUserId: string) {
  const others = db.prepare(`
    SELECT uli.user_id FROM user_line_ids uli JOIN user_companies uc ON uc.user_id = uli.user_id AND uc.company_id = ?
    WHERE uli.line_user_id = ? AND uli.user_id != ?
  `).all(companyId, lineUserId, userId) as { user_id: number }[];
  for (const o of others) {
    db.prepare('DELETE FROM user_line_ids WHERE user_id = ?').run(o.user_id);
    const empty = !db.prepare('SELECT 1 FROM shifts WHERE user_id = ? AND company_id = ?').get(o.user_id, companyId)
      && !db.prepare('SELECT 1 FROM shift_requests WHERE user_id = ? AND company_id = ?').get(o.user_id, companyId)
      && !db.prepare('SELECT 1 FROM time_records WHERE user_id = ? AND company_id = ?').get(o.user_id, companyId);
    const madeByLine = db.prepare("SELECT 1 FROM line_registrations WHERE company_id = ? AND user_id = ? AND requested_name IS NOT NULL").get(companyId, o.user_id);
    if (empty && madeByLine) db.prepare('DELETE FROM user_companies WHERE user_id = ? AND company_id = ?').run(o.user_id, companyId);
  }
}

// ---- 文字のメッセージ: 名前で登録（店長が承認）／キーワード／質問を店長へ ----
// 社長がグループLINEに1通送るだけで始められるように、招待QRがなくても「フルネームを送る→店長が承認」で連携できる。
// 連携済みの人の短いキーワードはメニューと同じ返事、それ以外は質問として店長の LINE に転送する
// （店長は LINE 公式アカウントのアプリのチャットから返事する）。
db.exec(`
  CREATE TABLE IF NOT EXISTS line_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    line_user_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
// requested_name: まだスタッフに登録されていない名前で申し込まれたとき（user_id = 0）
try {
  const regCols = (db.prepare('PRAGMA table_info(line_registrations)').all() as any[]).map(c => c.name);
  if (!regCols.includes('requested_name')) db.exec('ALTER TABLE line_registrations ADD COLUMN requested_name TEXT');
  if (!regCols.includes('furigana')) db.exec('ALTER TABLE line_registrations ADD COLUMN furigana TEXT');
} catch { /* 起動を止めない */ }

// スタッフに見せる「誰に届くか」。LINE設定の担当者名があれば「担当の○○」、なければ「店長」
export function W(companyId: number): string {
  const n = (db.prepare('SELECT contact_name FROM line_settings WHERE company_id = ?').get(companyId) as any)?.contact_name;
  return n ? `担当の${n}` : '店長';
}

// 連携できたときの返事（招待リンク・承認のどちらでも同じ文面）
const linkedMsg = (companyId: number, name: string) =>
  `${name}さん、連携できました🎉\n\nこれからはこのLINEで、シフトの公開や希望の受付をお知らせします。\nトーク画面の下のメニューから、シフトを見る・希望を出す・休みの連絡・打刻ができます。\n\nシフトを変えたい・代わってほしいときは「シフトの相談」、そのほかは「質問・連絡」を押してください。${W(companyId)}に届きます。`;

// まだ連携していない人への案内（メニューを押したときなど）
const unlinkedMsg = (companyId: number) =>
  `まだシフトログと連携されていません。\nこのトークに【名前とふりがな】を送ってください。\n例：山田 花子 やまだ はなこ\n\n${W(companyId)}が確認したら「連携できました」とお知らせします。`;

const norm = (t: string) => t.replace(/[\s　・.]/g, '').toLowerCase();

// 「山田 花子 やまだ はなこ」「山田花子（ヤマダハナコ）」「山田 花子\nやまだはなこ」などを、名前とふりがなに分ける
const KANA = /^[ぁ-ゖァ-ヺー・\s　]+$/;
function splitNameKana(text: string): { name: string; kana: string } {
  const t = text.replace(/[()（）「」【】]/g, ' ').trim();
  const parts = t.split(/[\s　\n]+/).filter(Boolean);
  // 後ろから、かなだけの語をふりがなとして集める
  const kanaParts: string[] = [];
  while (parts.length > 1 && KANA.test(parts[parts.length - 1])) kanaParts.unshift(parts.pop()!);
  const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return { name: parts.join(' '), kana: toHira(kanaParts.join(' ')) };
}

async function lineDisplayName(token: string, lineUserId: string): Promise<string> {
  try { const r = await lineApi(token, `/v2/bot/profile/${lineUserId}`); return r.data?.displayName || ''; } catch { return ''; }
}

// 「シフトの相談」「質問・連絡」で選んだ内容。次に送られた文と一緒に担当者へ届ける（30分で消える）
db.exec(`
  CREATE TABLE IF NOT EXISTS line_consults (
    company_id INTEGER NOT NULL,
    line_user_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    label TEXT,
    expires_at DATETIME NOT NULL,
    PRIMARY KEY (company_id, line_user_id)
  );
`);
const CONSULT_TOPIC: Record<string, { name: string; example: string }> = {
  time: { name: '時間を変えたい', example: '例：「16時からにできますか？」「昼の部だけにしたいです」' },
  swap: { name: 'ほかの人と代わりたい', example: '例：「〇〇さんと代わってもいいですか？」「代わってくれる人を探してほしいです」' },
  add: { name: '入れる日を増やしたい', example: '例：「12/5と12/6も入れます」「土日の夜も入れます」' },
  less: { name: '入る日を減らしたい', example: '例：「12/10は入れなくなりました」' },
  other: { name: 'そのほかの相談', example: '例：「12/19の集合場所を知りたいです」' },
  ask: { name: '質問・連絡', example: '例：「駐車場はありますか？」「服装は何を着ればいいですか？」「少し遅れます」' },
};
function setConsult(companyId: number, lineUserId: string, topic: string, label: string | null) {
  db.prepare(`
    INSERT INTO line_consults (company_id, line_user_id, topic, label, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+30 minutes'))
    ON CONFLICT(company_id, line_user_id) DO UPDATE SET topic = excluded.topic, label = excluded.label, expires_at = excluded.expires_at
  `).run(companyId, lineUserId, topic, label);
}
function takeConsult(companyId: number, lineUserId: string): { topic: string; label: string | null } | null {
  const row = db.prepare("SELECT topic, label FROM line_consults WHERE company_id = ? AND line_user_id = ? AND expires_at >= datetime('now')").get(companyId, lineUserId) as any;
  db.prepare('DELETE FROM line_consults WHERE company_id = ? AND line_user_id = ?').run(companyId, lineUserId);
  return row || null;
}

// 担当者に「○○さんから相談／質問」を届ける（押すとその人とのトークが開く）
async function forwardToAdmins(companyId: number, token: string, me: { name: string }, lineUserId: string, heading: string, lines: string[], includeSelf = false) {
  const url = await chatUrl(companyId, token, lineUserId);
  const card = buttonsCard(`${me.name}さんから${heading}`, `${me.name}さんから${heading}`, [...lines, '返事は下のボタンから、このトークに送れます。'],
    [{ label: 'チャットで返事する', uri: url, primary: true, color: '#06C755' }]);
  for (const id of adminLineIds(companyId)) if (includeSelf || id !== lineUserId) await sendLineMessage(token, id, card);
}

async function handleText(text: string, companyId: number, lineUserId: string, token: string, replyToken: string) {
  const me = lineMember(companyId, lineUserId);

  // メニューの「シフトの相談」「質問・連絡」のあとに送った文は、選んだ内容と一緒に担当者へ
  if (me) {
    const c = takeConsult(companyId, lineUserId);
    if (c) {
      if (/^(やめる|やめます|キャンセル|取り消し|取消)$/.test(text)) { await replyLine(token, replyToken, '相談をやめました。また必要なときにメニューから押してください。'); return; }
      const t = CONSULT_TOPIC[c.topic] || CONSULT_TOPIC.other;
      const heading = c.topic === 'ask' ? '質問・連絡' : 'シフトの相談';
      await replyLine(token, replyToken, `${W(companyId)}に届けました。返事はこのトークでお知らせします。\n\n【${t.name}】${c.label ? `\n${c.label}` : ''}\n「${text.slice(0, 200)}」`);
      await forwardToAdmins(companyId, token, me, lineUserId, heading,
        [`【${t.name}】`, ...(c.label ? [c.label] : []), text.slice(0, 400)], true);
      return;
    }
  }

  // 「毎回届ける」にした人（新人など）は、短い言葉でもそのまま担当者に届ける（メニューの返事はそのあと普段どおり）
  const watched = !!me && !!(db.prepare('SELECT line_watch FROM user_companies WHERE user_id = ? AND company_id = ?').get(me.id, companyId) as any)?.line_watch;
  if (me && watched && !isAdminMember(me)) await forwardToAdmins(companyId, token, me, lineUserId, 'の連絡', [text.slice(0, 400)]);

  // 連携済み: 短いキーワードはメニューと同じ、それ以外は質問として店長へ
  if (me) {
    const short = text.length <= 10;
    const what = !short ? '' : /希望/.test(text) ? 'requests' : /変更|変え|代わ|交代|相談|ずら/.test(text) ? 'consult' : /休み|欠勤|休む/.test(text) ? 'absent' : /シフト|予定/.test(text) ? 'shifts' : /打刻|出勤|退勤|QR/i.test(text) ? 'howto' : /使い方|ヘルプ|help/i.test(text) ? 'help' : '';
    // 催事の在庫（閉店の締め・積み込み）の画面を開くボタン
    if (short && /在庫|締め|残り|積み込み|積込/.test(text) && stockLiffUrl(companyId)) {
      await replyLine(token, replyToken, buttonsCard('在庫の画面', '在庫・閉店の締め', ['残りの数え・レジ締め・買い足し・足りない連絡はここから。'], [{ label: '在庫の画面を開く', uri: stockLiffUrl(companyId)!, primary: true, color: '#06C755' }]));
      return;
    }
    if (what === 'help') {
      await replyLine(token, replyToken, `【使い方】トーク画面の下のメニューを押してください。\n・シフトを見る … 自分とみんなの予定\n・希望を出す … 出られる日を提出\n・打刻する … ブースのQRを読んで出勤・退勤\n・休みの連絡 … 休むシフトを${W(companyId)}に連絡\n・シフトの相談 … 時間を変えたい・代わりたい・日を増やしたい\n・質問・連絡 … そのほか何でも\n\nこのトークにそのまま書いて送っても、${W(companyId)}に届きます。`);
      return;
    }
    if (what) { await replyMenu(what, companyId, lineUserId, token, replyToken); return; }
    if (isAdminMember(me)) return; // 店長自身の書き込みは転送しない
    await replyLine(token, replyToken, `${W(companyId)}に届けました。返事はこのトークでお知らせします。\n（シフトを変えたいときは、下のメニューの「シフトの相談」からも送れます）`);
    if (!watched) await forwardToAdmins(companyId, token, me, lineUserId, '質問', [text.slice(0, 400)]);
    return;
  }

  // 未連携: 名前で登録を申し込む（スタッフ一覧にある、まだ LINE とつながっていない人と照合）
  const cands = db.prepare(`
    SELECT u.id, u.name, u.furigana FROM user_companies uc JOIN users u ON u.id = uc.user_id AND u.is_active = 1
    LEFT JOIN user_line_ids uli ON uli.user_id = u.id
    WHERE uc.company_id = ? AND uli.user_id IS NULL
  `).all(companyId) as { id: number; name: string; furigana: string | null }[];
  let { name: reqName, kana } = splitNameKana(text);
  const toHira = (t: string) => t.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  // ひらがな（カタカナ）だけで送られたら、登録済みのふりがなと照らし合わせる
  const kanaOnly = KANA.test(text.trim()) ? toHira(text.trim()) : '';
  let hit = cands.filter(c => norm(c.name) === norm(reqName) || (!!kanaOnly && !!c.furigana && norm(c.furigana) === norm(kanaOnly)));
  if (kanaOnly && hit.length === 1) { kana = kanaOnly; reqName = hit[0].name; }
  if (hit.length > 1) {
    await replyLine(token, replyToken, `同じ名前の方が複数います。お手数ですが、${W(companyId)}に直接連絡してください。`);
    return;
  }
  // 名前だけでふりがながないときは、ふりがなも頼む（文章の質問はこの先で担当者に届ける）
  if (!kana && reqName.length <= 12 && !/[0-9０-９?？!！。、,.@:/]/.test(text) && !KANA.test(reqName)) {
    await replyLine(token, replyToken, '【名前】と【ふりがな】を一緒に送ってください。\n例：山田 花子 やまだ はなこ');
    return;
  }
  if (hit.length === 0) {
    // 名前らしい短い文（数字や記号なし）なら、まだ登録されていない人として担当者に確認する
    const looksLikeName = reqName.length >= 2 && reqName.length <= 12 && text.length <= 40 && !/[0-9０-９?？!！。、,.@:/]/.test(text);
    const dn = await lineDisplayName(token, lineUserId);
    if (!looksLikeName) {
      await replyLine(token, replyToken, `メッセージを${W(companyId)}に届けました。\n\nシフトの連絡を受け取るには、このトークに【名前とふりがな】だけを送ってください。\n例：山田 花子 やまだ はなこ`);
      for (const id of adminLineIds(companyId)) await sendLineMessage(token, id, `【未登録の方からのメッセージ】LINE名「${dn || '不明'}」\n${text.slice(0, 300)}`);
      return;
    }
    const dup = db.prepare("SELECT id FROM line_registrations WHERE company_id = ? AND line_user_id = ? AND status = 'pending' AND requested_name = ?").get(companyId, lineUserId, reqName) as any;
    if (dup) { await replyLine(token, replyToken, `${reqName}さんとして${W(companyId)}に確認をお願いしています。もう少しお待ちください。`); return; }
    const reg = db.prepare('INSERT INTO line_registrations (company_id, line_user_id, user_id, display_name, requested_name, furigana) VALUES (?, ?, 0, ?, ?, ?)').run(companyId, lineUserId, dn, reqName, kana || null);
    await replyLine(token, replyToken, `${reqName}（${kana}）さんとして登録してよいか、${W(companyId)}に確認をお願いしました。\n承認されたら、このトークでお知らせします。`);
    const card = buttonsCard('LINEの登録の確認', 'LINEの登録の確認', [`LINE名「${dn || '不明'}」さんが`, `「${reqName}（${kana}）」さんとして登録したいそうです。`, 'まだスタッフに登録されていない名前です。本人で間違いなければ、この名前でスタッフに登録して承認します。'],
      [{ label: 'この名前で登録して承認', data: `a=reg_new&r=${reg.lastInsertRowid}`, primary: true, color: '#06C755' }, { label: '断る', data: `a=reg_ng&r=${reg.lastInsertRowid}` }]);
    for (const id of adminLineIds(companyId)) await sendLineMessage(token, id, card);
    return;
  }
  const target = hit[0];
  const pending = db.prepare("SELECT id FROM line_registrations WHERE company_id = ? AND line_user_id = ? AND user_id = ? AND status = 'pending'").get(companyId, lineUserId, target.id) as any;
  if (pending) { await replyLine(token, replyToken, `${target.name}さんとして${W(companyId)}に確認をお願いしています。もう少しお待ちください。`); return; }
  const dn = await lineDisplayName(token, lineUserId);
  const reg = db.prepare('INSERT INTO line_registrations (company_id, line_user_id, user_id, display_name, furigana) VALUES (?, ?, ?, ?, ?)').run(companyId, lineUserId, target.id, dn, kana || null);
  await replyLine(token, replyToken, `${target.name}さんとして登録してよいか、${W(companyId)}に確認をお願いしました。\n承認されたら、このトークでお知らせします。`);
  const card = buttonsCard('LINEの登録の確認', 'LINEの登録の確認', [`LINE名「${dn || '不明'}」さんが`, `「${target.name}${kana ? `（${kana}）` : ''}」さんとして登録したいそうです。`, '本人で間違いなければ承認してください。'],
    [{ label: '承認する', data: `a=reg_ok&r=${reg.lastInsertRowid}`, primary: true, color: '#06C755' }, { label: '違う人なので断る', data: `a=reg_ng&r=${reg.lastInsertRowid}` }]);
  for (const id of adminLineIds(companyId)) await sendLineMessage(token, id, card);
}

// メニュー（またはキーワード）への返信
async function replyMenu(what: string, companyId: number, lineUserId: string, token: string, replyToken: string) {
  // ほかのメニューを押したら、書きかけの相談はやめたことにする
  if (what !== 'ask') db.prepare('DELETE FROM line_consults WHERE company_id = ? AND line_user_id = ?').run(companyId, lineUserId);
  if (what === 'requests') return replyRequestLink(companyId, lineUserId, token, replyToken);
  if (what === 'absent') return replyAbsentPicker(companyId, lineUserId, token, replyToken);
  if (what === 'consult') return replyConsultPicker(companyId, lineUserId, token, replyToken);
  if (what === 'ask') {
    const me = lineMember(companyId, lineUserId);
    if (!me) return replyLine(token, replyToken, unlinkedMsg(companyId));
    setConsult(companyId, lineUserId, 'ask', null);
    return replyLine(token, replyToken, `聞きたいこと・伝えたいことを、このトークに書いて送ってください。${W(companyId)}に届きます。\n\n${CONSULT_TOPIC.ask.example}\n\n※シフトを変えたいときは「シフトの相談」、休むときは「休みの連絡」が早いです。`);
  }
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
    await replyLine(token, replyToken, unlinkedMsg(companyId));
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
const shiftLabel = (s: any) => {
  const part = s.company_id ? partNameOf(s.company_id, s) : '';
  return `${md2(s.date)} ${s.store_name ? s.store_name + ' ' : ''}${part ? part + ' ' : ''}${hm5(s.start_time)}–${hm5(s.end_time)}`;
};
// まとめたシフト（1日通しなど）の1行
const blockLabel = (b: ShiftBlock) =>
  `${md2(b.date)} ${b.store_name ? b.store_name + ' ' : ''}${b.part ? PART_NAME[b.part] + ' ' : ''}${hm5(b.start_time)}–${hm5(b.end_time)}`;
// 「1日通し（昼の部＋夜の部）」のような部の説明
const blockPartText = (b: ShiftBlock) => {
  if (!b.part) return '';
  if (b.pieces.length > 1) return `${PART_NAME[b.part]}（${b.pieces.map(x => `${hm5(x.start_time)}–${hm5(x.end_time)}`).join(' と ')}）`;
  return PART_NAME[b.part];
};

/** 本人の公開済みシフトを、つながったものはまとめて返す */
function myBlocks(companyId: number, userId: number, from: string, to: string): ShiftBlock[] {
  const rows = db.prepare(`
    SELECT s.id, s.user_id, s.date, s.start_time, s.end_time, s.store_id, st.name AS store_name FROM shifts s
    LEFT JOIN stores st ON st.id = s.store_id
    JOIN shift_publications p ON p.company_id = s.company_id AND p.is_published = 1
      AND p.year = CAST(substr(s.date, 1, 4) AS INTEGER) AND p.month = CAST(substr(s.date, 6, 2) AS INTEGER)
    WHERE s.company_id = ? AND s.user_id = ? AND s.date >= ? AND s.date <= ?
  `).all(companyId, userId, from, to) as any[];
  return mergeBlocks(companyId, rows);
}
const plusDays = (n: number) => new Date(Date.now() + 9 * 3600 * 1000 + n * 86400 * 1000).toISOString().slice(0, 10);

/** postback の s=1-2-3 から、本人のシフトだけを取り出す（1つでも他人のものがあれば null） */
function ownShifts(companyId: number, meId: number, ids: string | null): any[] | null {
  const list = String(ids || '').split(/[-,]/).map(Number).filter(n => n > 0);
  if (list.length === 0 || list.length > 6) return null;
  const rows = list.map(id => shiftWithStore(id));
  if (rows.some(r => !r || r.user_id !== meId || r.company_id !== companyId)) return null;
  return rows.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
}
// 何枚かのシフト（つながっていれば1日通し）を1行で
function shiftsLabel(companyId: number, rows: any[]): string {
  if (rows.length === 1) return shiftLabel(rows[0]);
  const b = mergeBlocks(companyId, rows);
  return b.map(blockLabel).join('／');
}

// LINE公式アカウントのチャットで、その人とのトークを直接開くURL
const botUserIds = new Map<number, string>();
async function chatUrl(companyId: number, token: string, lineUserId: string): Promise<string> {
  let bot = botUserIds.get(companyId);
  if (!bot) {
    try { const r = await lineApi(token, '/v2/bot/info'); bot = r.data?.userId; } catch { /* 一覧を開く */ }
    if (bot) botUserIds.set(companyId, bot);
  }
  return bot ? `https://chat.line.biz/${bot}/chat/${lineUserId}` : 'https://chat.line.biz/';
}

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

/** 在庫の画面（LINE の中で開く）の URL。在庫の機能が有効で、LINE の打刻（LIFF）が設定済みのときだけ */
export function stockLiffUrl(companyId: number, query = ''): string | null {
  const s = db.prepare('SELECT liff_id FROM line_settings WHERE company_id = ?').get(companyId) as { liff_id: string | null } | undefined;
  const inv = db.prepare('SELECT enabled FROM inv_settings WHERE company_id = ?').get(companyId) as { enabled: number } | undefined;
  if (!s?.liff_id || !inv?.enabled) return null;
  return `https://liff.line.me/${s.liff_id}/stock${query ? `?${query}` : ''}`;
}

/** 指定したスタッフの LINE に送る（連携していない人は飛ばす）。送れた人数を返す */
export async function pushToUsers(companyId: number, userIds: number[], message: LineMessage): Promise<number> {
  const token = (db.prepare('SELECT channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any)?.channel_access_token;
  if (!token || !userIds.length) return 0;
  const rows = db.prepare(`SELECT line_user_id FROM user_line_ids WHERE user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds) as { line_user_id: string }[];
  let sent = 0;
  for (const r of rows) if (await sendLineMessage(token, r.line_user_id, message)) sent++;
  return sent;
}

export { buttonsCard };

// スタッフからの相談・質問・休み・登録の確認が届く人（担当者）。
// 「時給を見られる人」を決めた会社では、その人と運営者だけ（社員を管理者にしていても、スタッフの相談が全員に届かないように）
function adminLineIds(companyId: number): string[] {
  return (db.prepare(`
    SELECT uli.line_user_id FROM user_line_ids uli
    JOIN users u ON u.id = uli.user_id AND u.is_active = 1
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    WHERE (uc.role = 'admin' OR u.role IN ('admin', 'super_admin'))
      AND (u.role = 'super_admin' OR uc.can_see_wages = 1
           OR NOT EXISTS (SELECT 1 FROM user_companies x WHERE x.company_id = uc.company_id AND x.can_see_wages = 1))
  `).all(companyId) as { line_user_id: string }[]).map(r => r.line_user_id);
}

// メニュー「休みの連絡」: これからの自分のシフト（公開済み・30日以内）をボタンで出す
async function replyAbsentPicker(companyId: number, lineUserId: string, token: string, replyToken: string) {
  const me = lineMember(companyId, lineUserId);
  if (!me) { await replyLine(token, replyToken, unlinkedMsg(companyId)); return; }
  const blocks = myBlocks(companyId, me.id, jstToday(), plusDays(30)).slice(0, 8);
  if (blocks.length === 0) { await replyLine(token, replyToken, 'この先30日に、公開済みのシフトはありません。'); return; }
  // 前日・当日など電話でしか受けない日は、押すと電話がかかるボタンにする
  const rule = absenceRule(companyId);
  const anyPhone = blocks.some(x => phoneOnly(companyId, x.date, x.store_id));
  await replyLine(token, replyToken, buttonsCard('休みの連絡', 'どのシフトを休みますか？',
    ['押すと、理由を選ぶ画面になります。', ...(blocks.some(b => b.pieces.length > 1) ? ['1日通しの日は、次に「1日ぜんぶ」「昼の部だけ」「夜の部だけ」を選べます。'] : []), ...(anyPhone ? [phoneOnlyMessage(companyId).split('\n')[0]] : [])],
    blocks.map(b => {
      if (!phoneOnly(companyId, b.date, b.store_id)) return { label: blockLabel(b), data: `a=${b.pieces.length > 1 ? 'pickday' : 'pick'}&s=${b.ids.join('-')}` };
      const tel = absenceRule(companyId, b.store_id).phone || rule.phone;
      return tel
        ? { label: `📞 ${blockLabel(b)}`, uri: `tel:${tel.replace(/[^0-9+]/g, '')}` }
        : { label: `📞 ${blockLabel(b)}`, data: `a=phone&s=${b.ids[0]}` };
    })));
}

// メニュー「シフトの相談」: これからのシフト（日ごと）と「シフトがない日のこと」を出す
async function replyConsultPicker(companyId: number, lineUserId: string, token: string, replyToken: string) {
  const me = lineMember(companyId, lineUserId);
  if (!me) { await replyLine(token, replyToken, unlinkedMsg(companyId)); return; }
  const blocks = myBlocks(companyId, me.id, jstToday(), plusDays(60)).slice(0, 9);
  await replyLine(token, replyToken, buttonsCard('シフトの相談', 'どのシフトの相談ですか？',
    [blocks.length ? '押すと「時間を変えたい」「代わりたい」などを選べます。' : 'これからのシフトはまだありません。', `選んだあとに書いた文が、${W(companyId)}に届きます。`],
    [...blocks.map(b => ({ label: blockLabel(b), data: `a=cs&s=${b.ids.join('-')}` })),
     { label: 'シフトがない日のこと（日を増やす・減らす）', data: 'a=cs&s=', primary: true, color: '#7048E8' }]));
}

async function handleAbsencePostback(q: URLSearchParams, companyId: number, lineUserId: string, token: string, replyToken: string) {
  const a = q.get('a');
  const me = lineMember(companyId, lineUserId);
  if (!me) { await replyLine(token, replyToken, unlinkedMsg(companyId)); return; }

  // 店長: 名前での登録を承認／断る
  if (a === 'reg_ok' || a === 'reg_ng' || a === 'reg_new') {
    if (!isAdminMember(me)) { await replyLine(token, replyToken, 'この操作は担当者（管理者）だけができます。'); return; }
    const reg = db.prepare('SELECT r.*, COALESCE(u.name, r.requested_name) AS name FROM line_registrations r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ? AND r.company_id = ?').get(Number(q.get('r')), companyId) as any;
    if (!reg || reg.status !== 'pending') { await replyLine(token, replyToken, 'この確認はもう済んでいます。'); return; }
    if (a === 'reg_ng') {
      db.prepare("UPDATE line_registrations SET status = 'rejected' WHERE id = ?").run(reg.id);
      await replyLine(token, replyToken, `断りました（${reg.name}さんとしては登録していません）。`);
      await sendLineMessage(token, reg.line_user_id, `${W(companyId)}が確認できなかったため、登録できませんでした。お手数ですが、お店に直接連絡してください。`);
      return;
    }
    // まだスタッフにいない名前: その名前でスタッフを作ってから連携する
    if (a === 'reg_new' || !reg.user_id) {
      const already = db.prepare('SELECT 1 FROM user_line_ids WHERE line_user_id = ? AND user_id IN (SELECT user_id FROM user_companies WHERE company_id = ?)').get(reg.line_user_id, companyId);
      if (already) { await replyLine(token, replyToken, 'このLINEは、もう別のスタッフとつながっています。'); return; }
      if (!canAddStaff(companyId, 1)) { await replyLine(token, replyToken, 'スタッフ数がプランの上限に達しています。管理画面からプランを確認してください。'); return; }
      const uid = Number(db.prepare("INSERT INTO users (name, furigana, role, is_active) VALUES (?, ?, 'staff', 1)").run(reg.requested_name, reg.furigana || null).lastInsertRowid);
      db.prepare("INSERT INTO user_companies (user_id, company_id, role, employment_type, color) VALUES (?, ?, 'staff', 'part_time', '#4A90E2')").run(uid, companyId);
      db.prepare('UPDATE line_registrations SET user_id = ? WHERE id = ?').run(uid, reg.id);
      reg.user_id = uid;
    }
    const taken = db.prepare('SELECT 1 FROM user_line_ids WHERE user_id = ?').get(reg.user_id);
    if (taken) { await replyLine(token, replyToken, `${reg.name}さんは、もう別のLINEとつながっています。`); return; }
    db.prepare('INSERT INTO user_line_ids (user_id, line_user_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET line_user_id = excluded.line_user_id').run(reg.user_id, reg.line_user_id);
    db.prepare("UPDATE line_registrations SET status = 'approved' WHERE id = ?").run(reg.id);
    if (reg.furigana) db.prepare("UPDATE users SET furigana = COALESCE(NULLIF(furigana, ''), ?) WHERE id = ?").run(reg.furigana, reg.user_id);
    db.prepare("UPDATE line_registrations SET status = 'rejected' WHERE company_id = ? AND user_id = ? AND status = 'pending'").run(companyId, reg.user_id);
    await replyLine(token, replyToken, a === 'reg_new' ? `${reg.name}さんをスタッフに登録して、承認しました。（時給などはスタッフ管理で入れてください）` : `${reg.name}さんを承認しました。`);
    await sendLineMessage(token, reg.line_user_id, linkedMsg(companyId, reg.name));
    return;
  }

  // スタッフ: 相談するシフトを選んだ → どうしたいかを選ぶ
  if (a === 'cs') {
    const ids = q.get('s') || '';
    if (!ids) {
      await replyLine(token, replyToken, buttonsCard('シフトの相談', 'シフトがない日のこと', ['どうしたいですか？'],
        [{ label: '入れる日を増やしたい', data: 'a=ct&k=add&s=', primary: true, color: '#7048E8' }, { label: '入る日を減らしたい', data: 'a=ct&k=less&s=' }, { label: 'そのほかの相談', data: 'a=ct&k=other&s=' }]));
      return;
    }
    const rows = ownShifts(companyId, me.id, ids);
    if (!rows) { await replyLine(token, replyToken, 'このシフトは見つかりませんでした。もう一度メニューから選んでください。'); return; }
    await replyLine(token, replyToken, buttonsCard('シフトの相談', shiftsLabel(companyId, rows), ['どうしたいですか？'],
      [{ label: '時間を変えたい', data: `a=ct&k=time&s=${ids}`, primary: true, color: '#7048E8' },
       { label: 'ほかの人と代わりたい', data: `a=ct&k=swap&s=${ids}` },
       { label: '休みたい（休みの連絡へ）', data: `a=${rows.length > 1 ? 'pickday' : 'pick'}&s=${ids}` },
       { label: 'そのほかの相談', data: `a=ct&k=other&s=${ids}` }]));
    return;
  }

  // スタッフ: 相談の中身を選んだ → 次に送る文を担当者へ届ける
  if (a === 'ct') {
    const k = CONSULT_TOPIC[q.get('k') || ''] ? q.get('k')! : 'other';
    const ids = q.get('s') || '';
    let label: string | null = null;
    if (ids) {
      const rows = ownShifts(companyId, me.id, ids);
      if (!rows) { await replyLine(token, replyToken, 'このシフトは見つかりませんでした。もう一度メニューから選んでください。'); return; }
      label = shiftsLabel(companyId, rows);
    }
    setConsult(companyId, lineUserId, k, label);
    await replyLine(token, replyToken, `【${CONSULT_TOPIC[k].name}】${label ? `\n${label}` : ''}\n\nどうしたいか、このトークに書いて送ってください。${W(companyId)}に届きます。\n${CONSULT_TOPIC[k].example}\n\n（やめるときは「やめる」と送ってください）`);
    return;
  }

  // スタッフ: 1日通しの日を選んだ → どこを休むか
  if (a === 'pickday') {
    const rows = ownShifts(companyId, me.id, q.get('s'));
    if (!rows) { await replyLine(token, replyToken, 'このシフトは見つかりませんでした。'); return; }
    if (phoneOnly(companyId, rows[0].date, rows[0].store_id)) { await replyLine(token, replyToken, phoneOnlyMessage(companyId, rows[0].store_id)); return; }
    await replyLine(token, replyToken, buttonsCard('休みの連絡', shiftsLabel(companyId, rows), ['どこを休みますか？'],
      [{ label: '1日ぜんぶ休む', data: `a=pick&s=${rows.map(r => r.id).join('-')}`, primary: true, color: '#E03131' },
       ...rows.map(r => ({ label: `${partNameOf(companyId, r) || '一部'}だけ休む（${hm5(r.start_time)}–${hm5(r.end_time)}）`, data: `a=pick&s=${r.id}` }))]));
    return;
  }

  // スタッフ: 人が足りない日に「入れます」
  if (a === 'fill') {
    const date = String(q.get('d') || '');
    const storeId = Number(q.get('s')) || null;
    const from = String(q.get('f') || ''), to = String(q.get('t') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || date <= jstToday()) {
      await replyLine(token, replyToken, 'この日はもう募集が終わっています。ありがとうございます！'); return;
    }
    if (db.prepare('SELECT 1 FROM shifts WHERE company_id = ? AND user_id = ? AND date = ?').get(companyId, me.id, date)) {
      await replyLine(token, replyToken, `${md2(date)} はもうシフトに入っています。ありがとうございます！`); return;
    }
    const st = storeId ? (db.prepare('SELECT name FROM stores WHERE id = ? AND company_id = ?').get(storeId, companyId) as any) : null;
    const label = `${md2(date)} ${st?.name ? st.name + ' ' : ''}${from}–${to}`;
    // 今もまだ丸ごと足りない枠か（埋まった・一部だけの枠なら、お礼だけ返す）
    const still = computeShortages(companyId, date, date).some(x => x.kind === 'full' && (x.store_id ?? 0) === (storeId ?? 0) && x.start_time === from && x.end_time === to);
    if (!still) {
      await replyLine(token, replyToken, `ありがとう！\n${label} は、人が足りたので大丈夫になりました。また足りない日が出たらお願いします🙏`); return;
    }
    db.prepare(`INSERT OR IGNORE INTO fill_offers (company_id, user_id, date, store_id, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)`).run(companyId, me.id, date, storeId, from, to);
    const o = db.prepare('SELECT id, status FROM fill_offers WHERE company_id = ? AND user_id = ? AND date = ? AND COALESCE(store_id, 0) = COALESCE(?, 0) AND start_time = ?').get(companyId, me.id, date, storeId, from) as any;
    if (o.status !== 'pending') { await replyLine(token, replyToken, `${label} はもう返事済みです。`); return; }
    await replyLine(token, replyToken, `ありがとう！\n${label} に入れることを、${W(companyId)}に伝えました。決まったらこのLINEでお知らせします。`);
    const card = buttonsCard(`${me.name}さんが入れます`, `${me.name}さんが入れます`, [label, '押すとシフトに入れて、本人に知らせます。'],
      [{ label: `${me.name}さんに決める`.slice(0, 40), data: `a=fdecide&o=${o.id}`, primary: true, color: '#2F9E44' }]);
    for (const id of adminLineIds(companyId)) await sendLineMessage(token, id, card);
    return;
  }

  // 管理者: 「入れます」の人に決める → シフトに入れて本人に知らせる
  if (a === 'fdecide') {
    if (!isAdminMember(me)) { await replyLine(token, replyToken, 'この操作は担当者（管理者）だけができます。'); return; }
    const o = db.prepare(`SELECT f.*, u.name FROM fill_offers f JOIN users u ON u.id = f.user_id WHERE f.id = ? AND f.company_id = ?`).get(Number(q.get('o')), companyId) as any;
    if (!o) { await replyLine(token, replyToken, '見つかりませんでした。'); return; }
    if (o.status !== 'pending') { await replyLine(token, replyToken, 'もう決めてあります。'); return; }
    if (db.prepare('SELECT 1 FROM shifts WHERE company_id = ? AND user_id = ? AND date = ?').get(companyId, o.user_id, o.date)) {
      db.prepare("UPDATE fill_offers SET status = 'skipped' WHERE id = ?").run(o.id);
      await replyLine(token, replyToken, `${o.name}さんは ${md2(o.date)} にもう別のシフトが入っています。シフト画面で確かめてください。`); return;
    }
    const r = db.prepare("INSERT INTO shifts (company_id, user_id, date, start_time, end_time, break_minutes, status, store_id) VALUES (?, ?, ?, ?, ?, 0, 'confirmed', ?)")
      .run(companyId, o.user_id, o.date, o.start_time, o.end_time, o.store_id);
    const shiftId = Number(r.lastInsertRowid);
    recordShiftChange(companyId, o.user_id, shiftId, null, snapOf(shiftId));
    db.prepare("UPDATE fill_offers SET status = 'accepted' WHERE id = ?").run(o.id);
    const p = pendingChanges(companyId).find(x => x.user_id === o.user_id);
    const mine = p ? p.changes.filter(c => c.shift_id === shiftId) : [];
    const sent = mine.length ? await sendShiftChangeCard(companyId, o.user_id, o.name, mine) : false;
    if (sent) markNotified(mine.flatMap(c => c.ids));
    const sh = shiftWithStore(shiftId);
    await replyLine(token, replyToken, `${shiftLabel(sh)} に ${o.name}さんを入れました。${sent ? '本人にLINEで知らせました。' : '（本人はLINE未連携なので、直接伝えてください）'}`);
    return;
  }

  // 電話でしか受けない日（番号が未設定のとき）
  if (a === 'phone') {
    const sh = shiftWithStore(Number(q.get('s')));
    await replyLine(token, replyToken, phoneOnlyMessage(companyId, sh?.store_id));
    return;
  }

  // スタッフ: 休むシフトを選んだ → 理由を選ぶ
  if (a === 'pick') {
    const rows = ownShifts(companyId, me.id, q.get('s'));
    if (!rows) { await replyLine(token, replyToken, 'このシフトは見つかりませんでした。'); return; }
    const sh = rows[0];
    if (phoneOnly(companyId, sh.date, sh.store_id)) { await replyLine(token, replyToken, phoneOnlyMessage(companyId, sh.store_id)); return; }
    const ids = rows.map(r => r.id).join('-');
    await replyLine(token, replyToken, buttonsCard('休みの理由', `${shiftsLabel(companyId, rows)} を休みます`, [`理由を選ぶと、${W(companyId)}に届きます。`],
      [...REASONS.map((r, i) => ({ label: r, data: `a=report&s=${ids}&r=${i}`, primary: i === 0, color: '#E03131' }))]));
    return;
  }

  // スタッフ: 理由を選んだ → 記録して管理者に知らせる
  if (a === 'report') {
    const rows = ownShifts(companyId, me.id, q.get('s'));
    if (!rows) { await replyLine(token, replyToken, 'このシフトは見つかりませんでした。'); return; }
    // 古いカードを後から押した場合も、前日・当日になっていたら電話へ
    if (phoneOnly(companyId, rows[0].date, rows[0].store_id)) { await replyLine(token, replyToken, phoneOnlyMessage(companyId, rows[0].store_id)); return; }
    const reason = REASONS[Number(q.get('r'))] || 'その他';
    const abs = rows.map(sh => {
      let ab = db.prepare("SELECT * FROM absence_reports WHERE shift_id = ? AND status IN ('pending','recruiting')").get(sh.id) as any;
      if (!ab) {
        const r = db.prepare('INSERT INTO absence_reports (company_id, user_id, shift_id, date, reason) VALUES (?, ?, ?, ?, ?)').run(companyId, me.id, sh.id, sh.date, reason);
        ab = { id: Number(r.lastInsertRowid) };
      }
      return { ab, sh };
    });
    const label = shiftsLabel(companyId, rows);
    await replyLine(token, replyToken, `${label} のお休みを${W(companyId)}に伝えました。\n代わりが決まったら、このLINEでお知らせします。お大事にしてください。`);
    // 代わりは部ごとに探す（昼の部と夜の部で別の人が入れるように）
    const card = buttonsCard(`${me.name}さんから休みの連絡`, `${me.name}さんが休みます`, [label, `理由: ${reason}`],
      [...abs.map(({ ab, sh }) => ({ label: abs.length > 1 ? `代わりを募集（${partNameOf(companyId, sh) || hm5(sh.start_time) + '〜'}）` : '代わりを募集する', data: `a=recruit&ab=${ab.id}`, primary: true })),
       { label: 'シフト画面を開く', uri: `${APP_URL}/shifts` }]);
    for (const id of adminLineIds(companyId)) await sendLineMessage(token, id, card);
    return;
  }

  // 管理者: 代わりを募集 → その日空いている人に「入れます」
  if (a === 'recruit') {
    if (!isAdminMember(me)) { await replyLine(token, replyToken, 'この操作は担当者（管理者）だけができます。'); return; }
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
    const card = buttonsCard('代わりに入れる人を探しています', '代わりに入れる人を探しています', [shiftLabel(sh), `入れる場合はボタンを押してください。${W(companyId)}が決めたらお知らせします。`],
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
    await replyLine(token, replyToken, `ありがとうございます！${W(companyId)}に伝えました。\n${shiftLabel(sh)} に入るかどうか、決まったらお知らせします。`);
    const card = buttonsCard(`${me.name}さんが入れます`, `${me.name}さんが入れます`, [`${shiftLabel(sh)}（${sh.user_name}さんの代わり）`],
      [{ label: `${me.name}さんに決める`, data: `a=decide&ab=${ab.id}&u=${me.id}`, primary: true, color: '#2F9E44' }]);
    for (const id of adminLineIds(companyId)) await sendLineMessage(token, id, card);
    return;
  }

  // 管理者: この人に決める → シフトを差し替えて、本人たちに知らせる
  if (a === 'decide') {
    if (!isAdminMember(me)) { await replyLine(token, replyToken, 'この操作は担当者（管理者）だけができます。'); return; }
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

// トーク画面の下のメニューを付ける（画像は backend/assets/richmenu.png、2500x1686 の 3列×2段）
//   上: シフトを見る／希望を出す／打刻する   下: 休みの連絡／シフトの相談／質問・連絡
export async function installRichMenu(companyId: number): Promise<{ ok: boolean; error?: string }> {
  const s = db.prepare('SELECT channel_access_token, rich_menu_id, liff_id FROM line_settings WHERE company_id = ?').get(companyId) as any;
  if (!s?.channel_access_token) return { ok: false, error: 'LINE 通知の設定がまだです' };
  const token = s.channel_access_token;
  const W = 2500, H = 1686, w = Math.floor(W / 3), h = H / 2;
  const bounds = (i: number) => ({ x: (i % 3) * w, y: Math.floor(i / 3) * h, width: i % 3 === 2 ? W - 2 * w : w, height: h });
  const area = (i: number, data: string, label: string) => ({
    bounds: bounds(i),
    action: { type: 'postback', data: `menu=${data}`, displayText: label },
  });
  // 「打刻する」は LIFF があれば本人専用の打刻画面を開く。なければ打刻のしかたを返す
  const punchArea = s.liff_id
    ? { bounds: bounds(2), action: { type: 'uri', uri: `https://liff.line.me/${s.liff_id}` } }
    : area(2, 'howto', '打刻のしかた');
  const created = await lineApi(token, '/v2/bot/richmenu', {
    method: 'POST',
    body: {
      size: { width: W, height: H }, selected: true, name: 'shiftlog-menu', chatBarText: 'シフトのメニュー',
      areas: [area(0, 'shifts', 'シフトを見る'), area(1, 'requests', '希望を出す'), punchArea,
        area(3, 'absent', '休みの連絡'), area(4, 'consult', 'シフトの相談'), area(5, 'ask', '質問・連絡')],
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
    await replyLine(token, replyToken, unlinkedMsg(companyId));
    return;
  }
  const open = db.prepare(`
    SELECT year, month, start_date, end_date, deadline FROM shift_request_periods
    WHERE company_id = ? AND status = 'open' ORDER BY year DESC, month DESC
  `).all(companyId) as any[];
  // 期間の募集（マーケットなど）が受付中なら、そのリンクを先に出す
  const campaigns = (db.prepare(`
    SELECT id, title, start_date, end_date, deadline, status, sent_at FROM request_campaigns
    WHERE company_id = ? AND status = 'open' ORDER BY start_date
  `).all(companyId) as any[]).map(c => forUser(companyId, c, who.id)).filter(isAccepting);
  if (campaigns.length > 0) {
    const bubbles = [
      ...campaigns.slice(0, 5).map(c => campaignCard(companyId, who.id, who.name, c, 'reply').contents),
      ...open.slice(0, 5).map(p => requestBubble('希望の提出はこちら', who.name, p, requestLinkUrl(who.id, companyId, p.year, p.month))),
    ];
    const first = campaignCard(companyId, who.id, who.name, campaigns[0], 'reply');
    await replyLine(token, replyToken, bubbles.length === 1 ? first : { type: 'flex', altText: first.altText, contents: { type: 'carousel', contents: bubbles } });
    return;
  }
  if (open.length === 0) {
    await replyLine(token, replyToken, `シフトの候補日は、${W(companyId)}がこれから出します。
出たらこのLINEでお知らせするので、それまでお待ちください。`);
    return;
  }
  await replyLine(token, replyToken, requestCard('希望の提出はこちら', who.name, open.slice(0, 10), p => requestLinkUrl(who.id, companyId, p.year, p.month)));
}

// ---- 人が足りない日の打診 ----
// バイトの人それぞれに、入れそうな足りない日（その日にシフトがない・希望で×にしていない・行ける会場・昼だけ／夜だけに合う）を
// ボタンで送る。「入れます」→ 担当者に届く →「この人に決める」でシフトに入り、本人に知らせる。
db.exec(`
  CREATE TABLE IF NOT EXISTS fill_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    store_id INTEGER,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, user_id, date, store_id, start_time)
  );
`);
const MAX_OFFERS = 10;
interface FillOffer { date: string; store_id: number | null; store_name: string; from: string; to: string; rank: number }
function fillOffersFor(companyId: number) {
  const from = plusDays(1), to = plusDays(60);
  const shorts = computeShortages(companyId, from, to);
  const staff = db.prepare(`
    SELECT u.id, u.name, COALESCE(NULLIF(uc.display_name, ''), u.name) AS dn, uli.line_user_id FROM users u
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    LEFT JOIN user_line_ids uli ON uli.user_id = u.id
    WHERE u.is_active = 1 AND uc.role = 'staff' AND u.role NOT IN ('admin', 'super_admin')
    ORDER BY uc.sort_order IS NULL, uc.sort_order, u.id
  `).all(companyId) as { id: number; name: string; dn: string; line_user_id: string | null }[];
  const busy = new Set((db.prepare('SELECT user_id, date FROM shifts WHERE company_id = ? AND date >= ? AND date <= ?').all(companyId, from, to) as any[]).map(r => `${r.user_id}|${r.date}`));
  const reqs = new Map((db.prepare('SELECT user_id, date, availability, part FROM shift_requests WHERE company_id = ? AND date >= ? AND date <= ?').all(companyId, from, to) as any[]).map(r => [`${r.user_id}|${r.date}`, r]));
  const prefs = campaignPreferences(companyId, from, to);
  const RANK: Record<string, number> = { preferred: 0, available: 1 };
  return staff.map(u => {
    const offers: FillOffer[] = [];
    // 打診するのは丸ごと足りない枠（赤）だけ。一部の時間だけ足りない枠（黄）は送らない
    for (const sh of shorts.filter(x => x.kind === 'full')) {
      const k = `${u.id}|${sh.date}`;
      if (busy.has(k)) continue;
      const rq = reqs.get(k);
      if (rq?.availability === 'unavailable') continue;
      if (!prefs.venueOk(u.id, sh.date, sh.store_id)) continue;
      for (const w of [{ from: sh.start_time, to: sh.end_time }]) {
        const part = w.from < '15:00' ? 'a' : 'b';
        if ((rq?.part === 'a' || rq?.part === 'b') && rq.part !== part) continue;
        offers.push({ date: sh.date, store_id: sh.store_id, store_name: sh.store_name, from: w.from, to: w.to, rank: rq ? (RANK[rq.availability] ?? 2) : 2 });
      }
    }
    // 希望で◎○を付けた日を先に、そのあと日付順。最後は日付順に並べ直す
    const picked = offers.sort((a, b) => a.rank - b.rank || a.date.localeCompare(b.date) || a.from.localeCompare(b.from)).slice(0, MAX_OFFERS)
      .sort((a, b) => a.date.localeCompare(b.date) || a.from.localeCompare(b.from));
    return { user_id: u.id, name: u.name, display_name: u.dn, linked: !!u.line_user_id, line_user_id: u.line_user_id, total: offers.length, offers: picked };
  });
}
const fillLabel = (o: FillOffer) => `${md2(o.date)} ${o.store_name ? o.store_name + ' ' : ''}${o.from}–${o.to}`;
function fillCard(companyId: number, dn: string, offers: FillOffer[]) {
  return buttonsCard('人が足りない日があります', `${dn}さん、入れる日はありますか？`,
    ['クリスマスマーケットで人が足りない日です。入れる日があれば押してください（いくつ押してもOK）。', `押すと${W(companyId)}に届きます。決まったら、このLINEでお知らせします。`],
    offers.map(o => ({ label: fillLabel(o), data: `a=fill&d=${o.date}&s=${o.store_id ?? 0}&f=${o.from}&t=${o.to}` })));
}

// POST /api/line/fill-offers { send?: boolean, user_ids?: number[] } - 打診の中身（send で送る）。管理者
router.post('/fill-offers', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const companyId = req.companyId!;
  const only: number[] | null = Array.isArray(req.body?.user_ids) ? req.body.user_ids.map(Number) : null;
  const list = fillOffersFor(companyId).filter(x => !only || only.includes(x.user_id));
  if (!req.body?.send) {
    res.json({ people: list.map(x => ({ user_id: x.user_id, name: x.display_name, linked: x.linked, total: x.total, offers: x.offers.map(fillLabel) })) });
    return;
  }
  const token = (db.prepare('SELECT channel_access_token FROM line_settings WHERE company_id = ?').get(companyId) as any)?.channel_access_token;
  if (!token) { res.status(409).json({ error: 'LINEの設定がまだです' }); return; }
  const sent: string[] = [], skipped: string[] = [];
  for (const x of list) {
    if (!x.line_user_id || x.offers.length === 0) { skipped.push(x.display_name); continue; }
    if (await sendLineMessage(token, x.line_user_id, fillCard(companyId, x.display_name, x.offers))) sent.push(x.display_name); else skipped.push(x.display_name);
  }
  res.json({ sent, skipped });
});

// POST /api/line/webhook - 旧URL（会社IDなし）。何もしない
router.post('/webhook', (_req, res) => { res.json({ status: 'ok' }); });

export default router;
