import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db';
import { getJSTDate, getJSTTime } from '../utils/jst';
import { ClockAction, ClockError, applyPunch, listBreaks, parseLocation, userBelongsToCompany } from '../utils/clock';

// 会場QRでの打刻（/q/<token> の画面から呼ぶ。ログイン不要）。
//
// ブースにQRポスターを貼り、スタッフが自分のスマホで読み取って打刻する。タブレットは置かない。
//
// 認証の考え方:
//   - QRトークンは「その会場で打刻してよい」という合言葉。既存キオスクの会社PINと同じ水準で、
//     トークンを知っていれば会社のスタッフを選んで打刻できる（それ以上のことはできない）。
//   - トークンはJWTではなく、ここの4エンドポイントでしか照合しない。通常のAPI（authenticateToken）には通らない。
//   - 指定された userId がトークンの会社に所属しているかを毎回確認する（他社のスタッフは指定できない）。
//   - 端末には長期のログイントークンを置かない。覚えるのは「選んだ名前（userId）」だけ。
//   - 管理者がトークンを再発行すれば、古いポスターのQRは即座に使えなくなる。
const router = Router();

/** 会場QRのトークン。24文字の URL セーフな乱数（144bit） */
export function generateQrToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

function findStoreByToken(token: string): any | null {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return db.prepare(`
    SELECT s.id, s.name, s.company_id, c.name AS company_name
    FROM stores s JOIN companies c ON c.id = s.company_id
    WHERE s.qr_token = ?
  `).get(token) || null;
}

const INVALID_QR = 'このQRコードは使えません。会場に貼られている最新のQRを読み取ってください';

const ACTIONS: Record<string, ClockAction> = {
  'clock-in': 'clock_in', 'clock-out': 'clock_out', 'break-start': 'break_start', 'break-end': 'break_end',
};

function todayStatus(companyId: number, userId: number) {
  const record = db.prepare(`
    SELECT tr.id, tr.date, tr.clock_in, tr.clock_out, tr.break_minutes, tr.status,
           s_in.name AS store_name, s_out.name AS clock_out_store_name
    FROM time_records tr
    LEFT JOIN stores s_in ON s_in.id = tr.store_id
    LEFT JOIN stores s_out ON s_out.id = tr.clock_out_store_id
    WHERE tr.company_id = ? AND tr.user_id = ? AND tr.date = ?
    ORDER BY tr.id DESC LIMIT 1
  `).get(companyId, userId, getJSTDate()) as any;
  if (!record) return { record: null, breaks: [], on_break: false };
  const breaks = listBreaks(record.id).map(b => ({ start_time: b.start_time, end_time: b.end_time }));
  const onBreak = record.status === 'open' && breaks.some(b => !b.end_time);
  return { record, breaks, on_break: onBreak };
}

// GET /api/qr/:token - 会場名・会社名・スタッフ一覧（名前選択用）
router.get('/:token', (req: Request, res: Response): void => {
  const store = findStoreByToken(req.params.token);
  if (!store) {
    res.status(404).json({ error: INVALID_QR });
    return;
  }
  const staff = db.prepare(`
    SELECT u.id, u.name, uc.color
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    WHERE u.is_active = 1
    ORDER BY u.name ASC
  `).all(store.company_id);
  res.json({
    store: { id: store.id, name: store.name },
    company: { id: store.company_id, name: store.company_name },
    staff,
  });
});

// GET /api/qr/:token/status?userId= - そのスタッフの今日の打刻状況
router.get('/:token/status', (req: Request, res: Response): void => {
  const store = findStoreByToken(req.params.token);
  if (!store) {
    res.status(404).json({ error: INVALID_QR });
    return;
  }
  const userId = Number(req.query.userId);
  if (!userBelongsToCompany(userId, store.company_id)) {
    res.status(403).json({ error: 'このスタッフは会社に所属していません' });
    return;
  }
  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
  res.json({ user, ...todayStatus(store.company_id, userId) });
});

// POST /api/qr/:token/punch - 打刻 { userId, action, lat?, lng?, accuracy? }
// 位置情報は取れたときだけ記録する（拒否・取得失敗でも打刻は通す）
router.post('/:token/punch', (req: Request, res: Response): void => {
  const store = findStoreByToken(req.params.token);
  if (!store) {
    res.status(404).json({ error: INVALID_QR });
    return;
  }
  const { userId, action } = req.body || {};
  const clockAction = ACTIONS[action];
  if (!clockAction) {
    res.status(400).json({ error: '打刻の種類が正しくありません' });
    return;
  }
  if (!userBelongsToCompany(userId, store.company_id)) {
    res.status(403).json({ error: 'このスタッフは会社に所属していません' });
    return;
  }

  const date = getJSTDate();
  const time = getJSTTime();
  try {
    applyPunch(clockAction, {
      companyId: store.company_id,
      userId: Number(userId),
      date, time,
      storeId: store.id,
      source: 'qr',
      location: parseLocation(req.body),
    });
  } catch (e) {
    if (e instanceof ClockError) {
      res.status(e.status).json({ error: e.message, ...todayStatus(store.company_id, Number(userId)) });
      return;
    }
    throw e;
  }

  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(Number(userId));
  res.json({
    ok: true,
    action,
    date, time,
    store_name: store.name,
    user,
    ...todayStatus(store.company_id, Number(userId)),
  });
});

export default router;
