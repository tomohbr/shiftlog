import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { getJSTDate } from '../utils/jst';
import {
  ResolvedPunchTime,
  PunchAction,
  findProcessedPunch,
  markOfflinePunch,
  recordPunchReceipt,
  resolvePunchTime,
} from '../utils/punch';
import { ClockError, applyPunch, listBreaks, locationChecks, parseLocation, userBelongsToCompany } from '../utils/clock';

const router = Router();

// 打刻変更履歴の記録（編集/削除の前後スナップショット）
function snapshotRecord(rec: any): string | null {
  if (!rec) return null;
  return JSON.stringify({
    date: rec.date,
    clock_in: rec.clock_in ?? null,
    clock_out: rec.clock_out ?? null,
    break_minutes: rec.break_minutes ?? 0,
    notes: rec.notes ?? null,
  });
}

function logTimeRecordEdit(opts: {
  companyId: number;
  timeRecordId: number | bigint;
  action: 'create' | 'update' | 'delete';
  before: any;
  after: any;
  editor: { id: number; name: string } | undefined;
}): void {
  try {
    const target = opts.after || opts.before || {};
    const targetUser = target.user_id
      ? (db.prepare('SELECT name FROM users WHERE id = ?').get(target.user_id) as any)
      : null;
    db.prepare(`
      INSERT INTO time_record_edits
        (company_id, time_record_id, target_user_id, target_user_name, target_date, action, before_json, after_json, edited_by, edited_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      opts.companyId,
      Number(opts.timeRecordId),
      target.user_id ?? null,
      targetUser?.name ?? null,
      target.date ?? null,
      opts.action,
      snapshotRecord(opts.before),
      snapshotRecord(opts.after),
      opts.editor?.id ?? null,
      opts.editor?.name ?? null
    );
  } catch (e) {
    console.error('[time_record_edits] 記録失敗:', (e as Error).message);
  }
}

// 打刻リクエストの共通前処理。
// 1) 同じ client_uuid が処理済みなら、そのときの結果をそのまま返す（オフラインキューの再送対策）
// 2) recorded_at があれば端末が打った時刻を採用する（オフライン打刻）
// 返り値が null のときは、すでにレスポンスを返しているので呼び出し側は即 return する。
function preparePunch(
  req: AuthRequest,
  res: Response,
  userId: number,
  action: PunchAction
): ResolvedPunchTime | null {
  try {
    const already = findProcessedPunch(req.body?.client_uuid, userId, action);
    if (already) {
      res.json({ record: already, duplicate: true });
      return null;
    }
    return resolvePunchTime(req.body);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return null;
  }
}

// GET /api/timecards - 月別タイムカード一覧
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month, user_id } = req.query;

  let query = `
    SELECT tr.*, u.name as user_name, uc.color as user_color,
           s_in.name as store_name, s_out.name as clock_out_store_name
    FROM time_records tr
    JOIN users u ON tr.user_id = u.id
    LEFT JOIN user_companies uc ON tr.user_id = uc.user_id AND tr.company_id = uc.company_id
    LEFT JOIN stores s_in ON s_in.id = tr.store_id
    LEFT JOIN stores s_out ON s_out.id = tr.clock_out_store_id
    WHERE tr.company_id = ?
  `;
  const params: (string | number)[] = [companyId];

  // 会場で絞り込む（出勤・退勤のどちらかがその会場なら含める）
  if (req.query.store_id) {
    query += ' AND (tr.store_id = ? OR tr.clock_out_store_id = ?)';
    const storeId = parseInt(req.query.store_id as string);
    params.push(storeId, storeId);
  }

  if (year && month) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
    query += ' AND tr.date >= ? AND tr.date <= ?';
    params.push(startDate, endDate);
  }

  // Staff can only see their own
  if (!['admin','super_admin'].includes(req.user!.role)) {
    query += ' AND tr.user_id = ?';
    params.push(req.user!.id);
  } else if (user_id) {
    query += ' AND tr.user_id = ?';
    params.push(parseInt(user_id as string));
  }

  query += ' ORDER BY tr.date DESC, tr.clock_in ASC';

  // 休憩の内訳と、位置付き打刻の会場からの距離を添える
  const records = (db.prepare(query).all(...params) as any[]).map(rec => ({
    ...rec,
    breaks: listBreaks(rec.id),
    locations: locationChecks(rec.id),
  }));
  res.json({ records });
});

// 出勤・退勤・休憩の4つの打刻ルートの共通処理。
// user_id が指定されていればそのスタッフの打刻（ログイン済み端末をキオスクとして使う場合）。
// ただし他社のスタッフは指定できない。
function punchHandler(action: PunchAction) {
  return (req: AuthRequest, res: Response): void => {
    const companyId = req.companyId!;
    const userId = req.body.user_id ? Number(req.body.user_id) : req.user!.id;
    if (req.body.user_id && !userBelongsToCompany(userId, companyId)) {
      res.status(403).json({ error: 'このスタッフは会社に所属していません' });
      return;
    }

    const resolved = preparePunch(req, res, userId, action);
    if (!resolved) return;

    let recordId: number;
    try {
      recordId = applyPunch(action, {
        companyId, userId,
        date: resolved.date, time: resolved.time,
        source: resolved.source,
        location: parseLocation(req.body),
      });
    } catch (e) {
      if (e instanceof ClockError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw e;
    }

    markOfflinePunch(recordId, resolved);
    recordPunchReceipt({
      clientUuid: req.body?.client_uuid,
      companyId, userId, action,
      timeRecordId: recordId, resolved,
    });

    const record = db.prepare('SELECT * FROM time_records WHERE id = ?').get(recordId);
    res.status(action === 'clock_in' ? 201 : 200).json({ record });
  };
}

// POST /api/timecards/clock-in - 出勤打刻
router.post('/clock-in', authenticateToken, requireCompany, punchHandler('clock_in'));

// POST /api/timecards/clock-out - 退勤打刻（休憩中なら退勤時刻で休憩も閉じる）
router.post('/clock-out', authenticateToken, requireCompany, punchHandler('clock_out'));

// POST /api/timecards/break-start - 休憩開始（1日に何回でも可）
router.post('/break-start', authenticateToken, requireCompany, punchHandler('break_start'));

// POST /api/timecards/break-end - 休憩終了（break_minutes は全休憩の合計）
router.post('/break-end', authenticateToken, requireCompany, punchHandler('break_end'));

// GET /api/timecards/today - 今日のステータス
router.get('/today', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const userId = req.query.user_id ? parseInt(req.query.user_id as string) : req.user!.id;
  const date = getJSTDate();

  const record = db.prepare(
    'SELECT * FROM time_records WHERE company_id = ? AND user_id = ? AND date = ? ORDER BY id DESC LIMIT 1'
  ).get(companyId, userId, date) as any;

  res.json({ record: record ? { ...record, breaks: listBreaks(record.id) } : null });
});

// PUT /api/timecards/:id - 管理者による手動編集
router.put('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (!['admin','super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const record = db.prepare(
    'SELECT * FROM time_records WHERE id = ? AND company_id = ?'
  ).get(req.params.id, companyId) as any;

  if (!record) {
    res.status(404).json({ error: 'タイムカードが見つかりません' });
    return;
  }

  const { clock_in, clock_out, break_minutes, notes, date } = req.body;

  db.prepare(`
    UPDATE time_records
    SET date = ?, clock_in = ?, clock_out = ?, break_minutes = ?, notes = ?,
        status = CASE WHEN ? IS NOT NULL THEN 'closed' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    date || record.date,
    clock_in || record.clock_in,
    clock_out !== undefined ? clock_out : record.clock_out,
    break_minutes !== undefined ? break_minutes : record.break_minutes,
    notes !== undefined ? notes : record.notes,
    clock_out !== undefined ? clock_out : record.clock_out,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM time_records WHERE id = ?').get(req.params.id);
  logTimeRecordEdit({
    companyId,
    timeRecordId: Number(req.params.id),
    action: 'update',
    before: record,
    after: updated,
    editor: req.user ? { id: req.user.id, name: req.user.name } : undefined,
  });
  res.json({ record: updated });
});

// DELETE /api/timecards/:id
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (!['admin','super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const record = db.prepare(
    'SELECT * FROM time_records WHERE id = ? AND company_id = ?'
  ).get(req.params.id, companyId);

  if (!record) {
    res.status(404).json({ error: 'タイムカードが見つかりません' });
    return;
  }

  db.prepare('DELETE FROM time_records WHERE id = ? AND company_id = ?').run(req.params.id, companyId);
  logTimeRecordEdit({
    companyId,
    timeRecordId: Number(req.params.id),
    action: 'delete',
    before: record,
    after: null,
    editor: req.user ? { id: req.user.id, name: req.user.name } : undefined,
  });
  res.json({ message: 'タイムカードを削除しました' });
});

// GET /api/timecards/:id/edits - 打刻変更履歴（管理者）
router.get('/:id/edits', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (!['admin','super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const edits = db.prepare(`
    SELECT id, time_record_id, target_user_name, target_date, action, before_json, after_json, edited_by_name, created_at
    FROM time_record_edits
    WHERE company_id = ? AND time_record_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(companyId, parseInt(req.params.id));

  res.json({ edits });
});

// GET /api/timecards/summary - 月別集計
router.get('/summary', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const { year, month, store_id } = req.query;

  if (!year || !month) {
    res.status(400).json({ error: '年と月を指定してください' });
    return;
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  let query = `
    SELECT
      u.id as user_id,
      u.name as user_name,
      uc.color as user_color,
      uc.hourly_wage,
      uc.employment_type,
      COUNT(tr.id) as work_days,
      SUM(
        CASE WHEN tr.clock_out IS NOT NULL THEN
          (CAST(substr(tr.clock_out, 1, 2) AS INTEGER) * 60 + CAST(substr(tr.clock_out, 4, 2) AS INTEGER))
          - (CAST(substr(tr.clock_in, 1, 2) AS INTEGER) * 60 + CAST(substr(tr.clock_in, 4, 2) AS INTEGER))
          - COALESCE(tr.break_minutes, 0)
        ELSE 0 END
      ) as total_minutes
    FROM users u
    JOIN user_companies uc ON u.id = uc.user_id AND uc.company_id = ?
    LEFT JOIN time_records tr ON u.id = tr.user_id AND tr.company_id = ? AND tr.date >= ? AND tr.date <= ?
      ${store_id ? 'AND (tr.store_id = ? OR tr.clock_out_store_id = ?)' : ''}
    WHERE u.is_active = 1
  `;
  const params: (string | number)[] = [companyId, companyId, startDate, endDate];
  // 会場で絞り込む（出勤・退勤のどちらかがその会場の日を数える）
  if (store_id) {
    const storeId = parseInt(store_id as string);
    params.push(storeId, storeId);
  }

  if (!['admin','super_admin'].includes(req.user!.role)) {
    query += ' AND u.id = ?';
    params.push(req.user!.id);
  }

  query += ' GROUP BY u.id, u.name, uc.color, uc.hourly_wage, uc.employment_type ORDER BY u.name ASC';

  const summary = db.prepare(query).all(...params);

  const result = (summary as any[]).map(row => ({
    ...row,
    total_hours: row.total_minutes ? Math.floor(row.total_minutes / 60) : 0,
    total_minutes_remainder: row.total_minutes ? row.total_minutes % 60 : 0,
    total_wage: row.total_minutes ? Math.floor((row.total_minutes / 60) * row.hourly_wage) : 0,
  }));

  res.json({ summary: result });
});

export default router;
