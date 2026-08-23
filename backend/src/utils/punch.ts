import db from '../db';
import { getJSTDate, getJSTTime, jstNow } from './jst';

// オフライン打刻のサーバー側処理。
//
// iOS アプリは圏外でも打刻できる（厨房・バックヤード・地下店舗は電波が入らない）。
// 圏外の打刻は端末のキューに溜まり、通信が戻ったときにまとめて送られてくるため、
// サーバーは「いつ受け取ったか」ではなく「端末がいつ打ったか」を正としなければならない。
//
// そのぶん時刻をクライアントが指定できてしまうので、以下で歯止めをかける:
//   - 未来の時刻、および古すぎる時刻は受け付けない
//   - 端末が申告した時刻とサーバーの受信時刻の両方を punch_receipts に残す
//   - オフライン由来の打刻が含まれる日は time_records.has_offline_punch を立て、管理者が見分けられるようにする
//   - client_uuid で冪等化し、再送で二重打刻にならないようにする

export type PunchAction = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
export type PunchSource = 'app' | 'offline' | 'kiosk';

// 未来方向の許容幅。端末時計の進みを吸収する。
const FUTURE_TOLERANCE_MINUTES = 5;
// 遡れる上限。長期のオフラインを装った改ざんを防ぐ。
const MAX_BACKDATE_DAYS = 14;

export interface ResolvedPunchTime {
  date: string;   // "YYYY-MM-DD"
  time: string;   // "HH:MM"
  source: PunchSource;
  /** 端末が申告した打刻時刻（オフライン時のみ。オンラインは null） */
  deviceRecordedAt: string | null;
}

export class PunchTimeError extends Error {}

/**
 * リクエストの recorded_at（端末が打刻した時刻）を検証して採用する。
 * 指定が無ければ従来どおりサーバーのJST現在時刻を使う。
 *
 * recorded_at の形式: "YYYY-MM-DDTHH:mm" または "YYYY-MM-DD HH:mm"（JST）
 */
export function resolvePunchTime(body: any): ResolvedPunchTime {
  const raw = body?.recorded_at;
  if (!raw || typeof raw !== 'string') {
    return { date: getJSTDate(), time: getJSTTime(), source: 'app', deviceRecordedAt: null };
  }

  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) {
    throw new PunchTimeError('打刻時刻の形式が正しくありません');
  }

  const [, y, mo, d, h, mi] = m;
  // JST の壁時計をそのまま UTC として解釈し、同じ基準の jstNow() と比較する
  const recorded = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(recorded)) {
    throw new PunchTimeError('打刻時刻の形式が正しくありません');
  }

  const now = jstNow().getTime();
  if (recorded - now > FUTURE_TOLERANCE_MINUTES * 60 * 1000) {
    throw new PunchTimeError('未来の時刻では打刻できません。端末の時計を確認してください。');
  }
  if (now - recorded > MAX_BACKDATE_DAYS * 24 * 60 * 60 * 1000) {
    throw new PunchTimeError(`${MAX_BACKDATE_DAYS}日より前の打刻は同期できません。管理者に手動で登録してもらってください。`);
  }

  return {
    date: `${y}-${mo}-${d}`,
    time: `${h}:${mi}`,
    source: 'offline',
    deviceRecordedAt: `${y}-${mo}-${d} ${h}:${mi}`,
  };
}

/** 既に処理済みの client_uuid なら、そのときの打刻レコードを返す（再送の冪等化） */
export function findProcessedPunch(clientUuid: unknown, userId: number): any | null {
  if (!clientUuid || typeof clientUuid !== 'string') return null;
  const receipt = db.prepare(
    'SELECT * FROM punch_receipts WHERE client_uuid = ?'
  ).get(clientUuid) as any;
  if (!receipt) return null;
  // 他人の client_uuid を投げられても、そのユーザーの打刻は返さない
  if (receipt.user_id !== userId) return null;
  if (!receipt.time_record_id) return null;
  return db.prepare('SELECT * FROM time_records WHERE id = ?').get(receipt.time_record_id) || null;
}

/** 打刻の受領を記録する。client_uuid が無い（＝Webからの通常打刻）ときは何もしない */
export function recordPunchReceipt(opts: {
  clientUuid: unknown;
  companyId: number;
  userId: number;
  action: PunchAction;
  timeRecordId: number | bigint;
  resolved: ResolvedPunchTime;
}): void {
  if (!opts.clientUuid || typeof opts.clientUuid !== 'string') return;
  try {
    db.prepare(`
      INSERT OR REPLACE INTO punch_receipts
        (client_uuid, company_id, user_id, action, time_record_id, recorded_date, recorded_time, device_recorded_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      opts.clientUuid,
      opts.companyId,
      opts.userId,
      opts.action,
      Number(opts.timeRecordId),
      opts.resolved.date,
      opts.resolved.time,
      opts.resolved.deviceRecordedAt,
      opts.resolved.source,
    );
  } catch (e) {
    console.error('[punch_receipts] 記録失敗:', (e as Error).message);
  }
}

/** オフライン由来の打刻が含まれる日に印を付ける */
export function markOfflinePunch(timeRecordId: number | bigint, resolved: ResolvedPunchTime): void {
  if (resolved.source !== 'offline') return;
  try {
    db.prepare('UPDATE time_records SET has_offline_punch = 1 WHERE id = ?').run(Number(timeRecordId));
  } catch (e) {
    console.error('[punch] オフライン印の付与に失敗:', (e as Error).message);
  }
}
