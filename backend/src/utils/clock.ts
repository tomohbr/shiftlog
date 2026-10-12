import db from '../db';

// 出勤・退勤・休憩の打刻処理の本体。
//
// スタッフ用（/api/timecards）・キオスク（/api/auth/kiosk-clock）・会場QR（/api/qr）の
// 3経路が同じ規則で打刻するよう、ここに集めている。
//
// 休憩は time_breaks に何回でも記録する。従来の time_records.break_start / break_end は
// 既存の画面（タイムカード・キオスク・ヘッダーの「休憩中」表示）が状態判定に使っているため、
//   break_start = その日の最初の休憩開始
//   break_end   = 最後の休憩終了（休憩中は NULL に戻す → 従来どおり「start あり・end なし＝休憩中」）
// を書き続けて互換を保つ。break_minutes は全休憩の合計。

export type ClockAction = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';

export class ClockError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface PunchLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export interface PunchInput {
  companyId: number;
  userId: number;
  date: string;   // "YYYY-MM-DD"（JST）
  time: string;   // "HH:MM"（JST）
  storeId?: number | null;
  /** qr | app | offline | kiosk */
  source: string;
  location?: PunchLocation | null;
}

// 会場とみなす半径の既定値（m）
export const DEFAULT_GEOFENCE_M = 300;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** スタッフがその会社に所属しているか（他社のスタッフIDを指定させないため） */
export function userBelongsToCompany(userId: unknown, companyId: number): boolean {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return false;
  return !!db.prepare(`
    SELECT 1 FROM user_companies uc JOIN users u ON u.id = uc.user_id
    WHERE uc.user_id = ? AND uc.company_id = ? AND u.is_active = 1
  `).get(id, companyId);
}

export function findOpenRecord(companyId: number, userId: number, date: string): any | null {
  return db.prepare(
    'SELECT * FROM time_records WHERE company_id = ? AND user_id = ? AND date = ? AND status = ?'
  ).get(companyId, userId, date, 'open') || null;
}

export function listBreaks(timeRecordId: number): { id: number; start_time: string; end_time: string | null; store_id: number | null }[] {
  return db.prepare(
    'SELECT id, start_time, end_time, store_id FROM time_breaks WHERE time_record_id = ? ORDER BY start_time ASC, id ASC'
  ).all(timeRecordId) as any[];
}

/** 終わった休憩の合計（分）。休憩の記録が1件も無ければ null（＝手入力の break_minutes を尊重する） */
function sumBreakMinutes(timeRecordId: number): number | null {
  const breaks = listBreaks(timeRecordId);
  if (breaks.length === 0) return null;
  return breaks.reduce((sum, b) => b.end_time ? sum + Math.max(0, toMinutes(b.end_time) - toMinutes(b.start_time)) : sum, 0);
}

function findOpenBreak(timeRecordId: number): any | null {
  return db.prepare(
    'SELECT * FROM time_breaks WHERE time_record_id = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1'
  ).get(timeRecordId) || null;
}

/** リクエスト本文の lat/lng/accuracy を検証して取り出す。無い・不正なら null（打刻は止めない） */
export function parseLocation(body: any): PunchLocation | null {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (body?.lat === undefined || body?.lat === null || body?.lng === undefined || body?.lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const acc = Number(body?.accuracy);
  return { lat, lng, accuracy: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null };
}

/** 2点間の距離（m）。ハバーサイン */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (d: number) => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function logPunchEvent(input: PunchInput, action: ClockAction, timeRecordId: number): void {
  try {
    db.prepare(`
      INSERT INTO punch_events
        (company_id, user_id, time_record_id, action, punched_date, punched_time, store_id, source, lat, lng, accuracy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.companyId, input.userId, timeRecordId, action, input.date, input.time,
      input.storeId ?? null, input.source,
      input.location?.lat ?? null, input.location?.lng ?? null, input.location?.accuracy ?? null,
    );
  } catch (e) {
    console.error('[punch_events] 記録失敗:', (e as Error).message);
  }
}

/**
 * 打刻を1件適用し、対象の time_records.id を返す。
 * 規則に合わない打刻は ClockError（status と日本語メッセージ付き）を投げる。
 */
export function applyPunch(action: ClockAction, input: PunchInput): number {
  const { companyId, userId, date, time } = input;
  const storeId = input.storeId ?? null;

  const run = db.transaction((): number => {
    if (action === 'clock_in') {
      if (findOpenRecord(companyId, userId, date)) {
        throw new ClockError(409, '既に出勤打刻済みです');
      }
      const result = db.prepare(
        'INSERT INTO time_records (company_id, user_id, date, clock_in, status, has_offline_punch, store_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(companyId, userId, date, time, 'open', input.source === 'offline' ? 1 : 0, storeId);
      return Number(result.lastInsertRowid);
    }

    const record = findOpenRecord(companyId, userId, date);
    if (!record) throw new ClockError(404, '出勤打刻がありません');
    const openBreak = findOpenBreak(record.id);

    if (action === 'break_start') {
      if (openBreak) throw new ClockError(409, '既に休憩中です');
      if (record.clock_in && time < record.clock_in) {
        throw new ClockError(400, '休憩開始が出勤時刻より前です');
      }
      const last = db.prepare(
        'SELECT end_time FROM time_breaks WHERE time_record_id = ? AND end_time IS NOT NULL ORDER BY end_time DESC LIMIT 1'
      ).get(record.id) as any;
      if (last && time < last.end_time) {
        throw new ClockError(400, '休憩開始が前の休憩の終了より前です');
      }
      db.prepare('INSERT INTO time_breaks (time_record_id, start_time, store_id) VALUES (?, ?, ?)')
        .run(record.id, time, storeId);
      // 従来列: 最初の休憩開始を保ち、休憩中は break_end を空にする
      db.prepare(
        'UPDATE time_records SET break_start = COALESCE(break_start, ?), break_end = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(time, record.id);
      return record.id;
    }

    if (action === 'break_end') {
      if (!openBreak) throw new ClockError(400, '休憩中ではありません');
      if (time < openBreak.start_time) throw new ClockError(400, '休憩終了が休憩開始より前です');
      db.prepare('UPDATE time_breaks SET end_time = ? WHERE id = ?').run(time, openBreak.id);
      const total = sumBreakMinutes(record.id) ?? 0;
      db.prepare(
        'UPDATE time_records SET break_end = ?, break_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(time, total, record.id);
      return record.id;
    }

    // clock_out
    if (record.clock_in && time < record.clock_in) {
      throw new ClockError(400, '退勤時刻が出勤時刻より前です');
    }
    // 休憩を終えずに退勤した場合は、退勤時刻で休憩を閉じる
    let breakEnd: string | null = record.break_end ?? null;
    if (openBreak) {
      db.prepare('UPDATE time_breaks SET end_time = ? WHERE id = ?')
        .run(time < openBreak.start_time ? openBreak.start_time : time, openBreak.id);
      breakEnd = time;
    }
    const summed = sumBreakMinutes(record.id);
    const breakMins = summed ?? Math.max(0, record.break_minutes || 0);
    db.prepare(`
      UPDATE time_records
      SET clock_out = ?, break_minutes = ?, break_end = ?, status = 'closed', clock_out_store_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(time, breakMins, breakEnd, storeId, record.id);
    return record.id;
  });

  const recordId = run();
  logPunchEvent(input, action, recordId);
  return recordId;
}

/** 管理画面向け: 位置付きの打刻を会場の位置と比べ、離れていたものを返す */
export function locationChecks(timeRecordId: number): {
  action: string; time: string | null; store_name: string | null;
  distance_m: number; accuracy_m: number | null; radius_m: number; far: boolean;
}[] {
  const events = db.prepare(`
    SELECT pe.action, pe.punched_time, pe.lat, pe.lng, pe.accuracy, s.name AS store_name, s.lat AS store_lat, s.lng AS store_lng, s.geofence_m
    FROM punch_events pe JOIN stores s ON s.id = pe.store_id
    WHERE pe.time_record_id = ? AND pe.lat IS NOT NULL AND s.lat IS NOT NULL AND s.lng IS NOT NULL
    ORDER BY pe.id ASC
  `).all(timeRecordId) as any[];
  return events.map(e => {
    const radius = e.geofence_m || DEFAULT_GEOFENCE_M;
    const distance = distanceMeters(e.lat, e.lng, e.store_lat, e.store_lng);
    // GPSの誤差（accuracy）を差し引いても半径の外にいるときだけ「離れている」とする（屋内の誤差で誤検知しないため）
    const far = distance - (e.accuracy || 0) > radius;
    return {
      action: e.action, time: e.punched_time, store_name: e.store_name,
      distance_m: distance, accuracy_m: e.accuracy ?? null, radius_m: radius, far,
    };
  });
}
