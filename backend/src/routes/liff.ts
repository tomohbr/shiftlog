import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db';
import { JWT_SECRET, authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { getJSTDate, getJSTTime } from '../utils/jst';
import { applyPunch, ClockError, parseLocation } from '../utils/clock';
import { ACTIONS, INVALID_QR, findStoreByToken, todayStatus } from './qr-clock';
import { installRichMenu } from './line';

// LINE の中で開く本人専用の打刻画面（LIFF）用の API。
// 1. 画面が LIFF の ID トークンを送る → LINE に問い合わせて本人の LINE userId を確かめる
// 2. その LINE と連携しているスタッフに、打刻専用の短い鍵（12時間）を渡す
// 3. 打刻は「鍵＋読み取った会場QR」で行う。会場QRだけでは誰の打刻もできない
// 名前を選ぶ画面がないので、ほかの人の打刻はできない。

const router = Router();
const PUNCH_SECRET = `${JWT_SECRET}:liff-punch`;

function settings(companyId: number) {
  return db.prepare('SELECT liff_id, login_channel_id FROM line_settings WHERE company_id = ?').get(companyId) as { liff_id: string | null; login_channel_id: string | null } | undefined;
}

function verifyPunchKey(key: string): { uid: number; cid: number } | null {
  try {
    const d = jwt.verify(key, PUNCH_SECRET) as any;
    return d?.pu && d?.pc ? { uid: Number(d.pu), cid: Number(d.pc) } : null;
  } catch { return null; }
}

function todayShifts(companyId: number, userId: number) {
  const today = getJSTDate();
  const published = db.prepare('SELECT 1 FROM shift_publications WHERE company_id = ? AND year = ? AND month = ? AND is_published = 1')
    .get(companyId, Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  if (!published) return [];
  return db.prepare(`
    SELECT s.start_time, s.end_time, s.store_id, st.name AS store_name FROM shifts s
    LEFT JOIN stores st ON st.id = s.store_id
    WHERE s.company_id = ? AND s.user_id = ? AND s.date = ? ORDER BY s.start_time
  `).all(companyId, userId, today);
}

// GET /api/liff/config/:companyId - 画面が LIFF を初期化するための ID（ログイン不要）
router.get('/config/:companyId', (req: Request, res: Response): void => {
  const s = settings(Number(req.params.companyId));
  if (!s?.liff_id) { res.status(404).json({ error: 'このお店はまだLINEの打刻を設定していません' }); return; }
  const c = db.prepare('SELECT name FROM companies WHERE id = ?').get(Number(req.params.companyId)) as any;
  res.json({ liff_id: s.liff_id, company_name: c?.name || '' });
});

// POST /api/liff/session { companyId, idToken } - 本人確認して打刻の鍵を渡す
router.post('/session', async (req: Request, res: Response): Promise<void> => {
  const companyId = Number(req.body?.companyId);
  const idToken = String(req.body?.idToken || '');
  const s = settings(companyId);
  if (!s?.login_channel_id || !idToken) { res.status(400).json({ error: 'LINEの打刻の設定がまだです' }); return; }

  let sub = '';
  try {
    const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: s.login_channel_id }).toString(),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data?.sub) { res.status(401).json({ error: 'LINEの本人確認ができませんでした。画面を閉じて、もう一度メニューから開いてください' }); return; }
    sub = String(data.sub);
  } catch {
    res.status(502).json({ error: 'LINEに接続できませんでした。電波の良い所でもう一度開いてください' });
    return;
  }

  const user = db.prepare(`
    SELECT u.id, u.name FROM user_line_ids uli
    JOIN users u ON u.id = uli.user_id AND u.is_active = 1
    JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = ?
    WHERE uli.line_user_id = ?
  `).get(companyId, sub) as { id: number; name: string } | undefined;
  if (!user) { res.json({ linked: false }); return; }

  const key = jwt.sign({ pu: user.id, pc: companyId }, PUNCH_SECRET, { expiresIn: '12h' });
  res.json({ linked: true, key, user, today_shifts: todayShifts(companyId, user.id), ...todayStatus(companyId, user.id) });
});

// POST /api/liff/venue { key, qr } - 読み取った QR がこのお店の会場か確かめる
router.post('/venue', (req: Request, res: Response): void => {
  const me = verifyPunchKey(String(req.body?.key || ''));
  if (!me) { res.status(401).json({ error: '時間が経ったので、画面を閉じてもう一度開いてください' }); return; }
  const token = String(req.body?.qr || '').split('/q/')[1]?.split(/[/?#]/)[0] || '';
  const store = findStoreByToken(decodeURIComponent(token));
  if (!store || store.company_id !== me.cid) { res.status(404).json({ error: INVALID_QR }); return; }
  res.json({ store: { id: store.id, name: store.name } });
});

// POST /api/liff/punch { key, qr, action, lat?, lng?, accuracy? } - 打刻
router.post('/punch', (req: Request, res: Response): void => {
  const me = verifyPunchKey(String(req.body?.key || ''));
  if (!me) { res.status(401).json({ error: '時間が経ったので、画面を閉じてもう一度開いてください' }); return; }
  const token = String(req.body?.qr || '').split('/q/')[1]?.split(/[/?#]/)[0] || '';
  const store = findStoreByToken(decodeURIComponent(token));
  if (!store || store.company_id !== me.cid) { res.status(404).json({ error: INVALID_QR }); return; }
  const action = ACTIONS[String(req.body?.action)];
  if (!action) { res.status(400).json({ error: '打刻の種類が正しくありません' }); return; }
  const active = db.prepare('SELECT 1 FROM user_companies uc JOIN users u ON u.id = uc.user_id AND u.is_active = 1 WHERE uc.user_id = ? AND uc.company_id = ?').get(me.uid, me.cid);
  if (!active) { res.status(403).json({ error: 'このお店のスタッフではありません' }); return; }

  const date = getJSTDate();
  const time = getJSTTime();
  try {
    applyPunch(action, { companyId: me.cid, userId: me.uid, date, time, storeId: store.id, source: 'liff', location: parseLocation(req.body) });
  } catch (e) {
    if (e instanceof ClockError) { res.status(e.status).json({ error: e.message, ...todayStatus(me.cid, me.uid) }); return; }
    throw e;
  }
  res.json({ ok: true, action: req.body.action, time, store_name: store.name, ...todayStatus(me.cid, me.uid) });
});

// POST /api/liff/settings { liff_id, login_channel_id, punch_line_only } - 設定（管理者）
router.post('/settings', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!['admin', 'super_admin'].includes(req.user!.role)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const liffId = String(req.body?.liff_id || '').trim() || null;
  const channelId = String(req.body?.login_channel_id || '').trim() || null;
  if (liffId && !/^\d{6,}-[A-Za-z0-9]+$/.test(liffId)) { res.status(400).json({ error: 'LIFF IDの形が違います（1234567890-AbCdEfGh のような形です）' }); return; }
  if (channelId && !/^\d{6,}$/.test(channelId)) { res.status(400).json({ error: 'チャネルIDは数字です' }); return; }
  const lineOnly = req.body?.punch_line_only ? 1 : 0;
  if (lineOnly && !(liffId && channelId)) { res.status(400).json({ error: '「LINEからだけ」にするには、LIFF IDとチャネルIDが必要です' }); return; }
  db.prepare('INSERT INTO line_settings (company_id) VALUES (?) ON CONFLICT(company_id) DO NOTHING').run(req.companyId!);
  db.prepare('UPDATE line_settings SET liff_id = ?, login_channel_id = ?, punch_line_only = ? WHERE company_id = ?').run(liffId, channelId, lineOnly, req.companyId!);
  // メニューの「打刻する」を LIFF に向け直す（失敗しても保存は成功扱い）
  try { await installRichMenu(req.companyId!); } catch { /* メニューは LINE設定から付け直せる */ }
  res.json({ message: 'LINEの打刻の設定を保存しました', endpoint_url: `${process.env.APP_URL || 'https://shiftlog-production.up.railway.app'}/liff/punch/${req.companyId}` });
});

export default router;
