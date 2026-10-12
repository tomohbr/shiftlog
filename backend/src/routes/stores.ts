import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { isOperatorCompany } from '../utils/billing';
import { generateQrToken } from './qr-clock';

const router = Router();

const isAdminUser = (req: AuthRequest) => ['admin', 'super_admin'].includes(req.user!.role);

// 打刻用QRのトークンは管理者にだけ見せる（スタッフ画面の店舗一覧には出さない）
function forViewer(req: AuthRequest, store: any) {
  if (!store || isAdminUser(req)) return store;
  const { qr_token, ...rest } = store;
  void qr_token;
  return rest;
}

// 会場の位置（緯度・経度・許容半径）。未指定の項目は既存値のまま、空文字・null は未設定に戻す。
// 不正な値は 400 にする（打刻を止める設定ではないので、壊れた値を黙って保存しない）
function parseVenueLocation(body: any, current: any): { lat: number | null; lng: number | null; geofence_m: number | null } | string {
  const pick = (key: string, min: number, max: number): number | null | undefined | 'invalid' => {
    if (!(key in (body || {}))) return undefined;
    const v = body[key];
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return 'invalid';
    return n;
  };
  const lat = pick('lat', -90, 90);
  const lng = pick('lng', -180, 180);
  const geofence = pick('geofence_m', 10, 50000);
  if (lat === 'invalid' || lng === 'invalid') return '会場の緯度・経度が正しくありません';
  if (geofence === 'invalid') return '会場の範囲は10m〜50kmで指定してください';
  const next = {
    lat: lat === undefined ? (current?.lat ?? null) : lat,
    lng: lng === undefined ? (current?.lng ?? null) : lng,
    geofence_m: geofence === undefined ? (current?.geofence_m ?? null) : (geofence === null ? null : Math.round(geofence)),
  };
  if ((next.lat === null) !== (next.lng === null)) return '会場の緯度と経度は両方入力してください';
  return next;
}

// GET /api/stores
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const stores = db.prepare(
    'SELECT * FROM stores WHERE company_id = ? ORDER BY created_at DESC'
  ).all(companyId);
  const subscription = db.prepare(
    'SELECT * FROM subscriptions WHERE company_id = ?'
  ).get(companyId) as any;
  res.json({
    stores: (stores as any[]).map(st => forViewer(req, st)),
    plan: {
      name: isOperatorCompany(companyId) ? 'pro' : (subscription?.plan || 'free'),
      max_stores: isOperatorCompany(companyId) ? 99 : (subscription?.max_stores || 1),
      current_stores: stores.length,
    }
  });
});

// GET /api/stores/:id
router.get('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const store = db.prepare(
    'SELECT * FROM stores WHERE id = ? AND company_id = ?'
  ).get(req.params.id, companyId);
  if (!store) {
    res.status(404).json({ error: '店舗が見つかりません' });
    return;
  }
  res.json({ store: forViewer(req, store) });
});

// POST /api/stores
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (!['admin','super_admin'].includes(req.user!.role) && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const { name, address, phone } = req.body;
  if (!name) {
    res.status(400).json({ error: '店舗名を入力してください' });
    return;
  }

  // Check store limit based on subscription plan
  const subscription = db.prepare(
    'SELECT * FROM subscriptions WHERE company_id = ?'
  ).get(companyId) as any;
  const currentStoreCount = (db.prepare(
    'SELECT COUNT(*) as count FROM stores WHERE company_id = ?'
  ).get(companyId) as any).count;
  // 運営者の自社（クリスマスマーケット等の複数ブース運用）は店舗数の上限なし
  const maxStores = isOperatorCompany(companyId) ? 99 : (subscription?.max_stores || 1);

  if (currentStoreCount >= maxStores) {
    res.status(403).json({
      error: '店舗数の上限に達しています。プランをアップグレードしてください。',
      code: 'STORE_LIMIT_REACHED',
      current: currentStoreCount,
      max: maxStores,
      plan: subscription?.plan || 'free',
    });
    return;
  }

  const venue = parseVenueLocation(req.body, null);
  if (typeof venue === 'string') {
    res.status(400).json({ error: venue });
    return;
  }

  const result = db.prepare(
    'INSERT INTO stores (company_id, name, address, phone, lat, lng, geofence_m) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(companyId, name, address || null, phone || null, venue.lat, venue.lng, venue.geofence_m);

  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(result.lastInsertRowid);
  logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'store', entityId: Number(result.lastInsertRowid), summary: `店舗「${name}」を追加` });
  res.status(201).json({ store });
});

// PUT /api/stores/:id
router.put('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (!['admin','super_admin'].includes(req.user!.role) && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const { name, address, phone } = req.body;
  const store = db.prepare(
    'SELECT * FROM stores WHERE id = ? AND company_id = ?'
  ).get(req.params.id, companyId);
  if (!store) {
    res.status(404).json({ error: '店舗が見つかりません' });
    return;
  }

  const venue = parseVenueLocation(req.body, store);
  if (typeof venue === 'string') {
    res.status(400).json({ error: venue });
    return;
  }

  db.prepare(
    'UPDATE stores SET name = ?, address = ?, phone = ?, lat = ?, lng = ?, geofence_m = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?'
  ).run(name, address || null, phone || null, venue.lat, venue.lng, venue.geofence_m, req.params.id, companyId);

  const updated = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  logAudit({ userId: req.user!.id, companyId, action: 'update', entity: 'store', entityId: Number(req.params.id), summary: `店舗「${name}」を更新` });
  res.json({ store: updated });
});

// DELETE /api/stores/:id
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (!['admin','super_admin'].includes(req.user!.role) && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }

  const store = db.prepare(
    'SELECT * FROM stores WHERE id = ? AND company_id = ?'
  ).get(req.params.id, companyId);
  if (!store) {
    res.status(404).json({ error: '店舗が見つかりません' });
    return;
  }

  db.prepare('DELETE FROM stores WHERE id = ? AND company_id = ?').run(req.params.id, companyId);
  logAudit({ userId: req.user!.id, companyId, action: 'delete', entity: 'store', entityId: Number(req.params.id), summary: `店舗「${(store as any).name}」を削除` });
  res.json({ message: '店舗を削除しました' });
});

// GET /api/stores/:id/qr - 会場の打刻用QR（管理者）。未発行ならここで発行する
router.get('/:id/qr', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  if (!isAdminUser(req)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const store = db.prepare(
    'SELECT s.*, c.name AS company_name FROM stores s JOIN companies c ON c.id = s.company_id WHERE s.id = ? AND s.company_id = ?'
  ).get(req.params.id, companyId) as any;
  if (!store) {
    res.status(404).json({ error: '店舗が見つかりません' });
    return;
  }
  let token = store.qr_token as string | null;
  if (!token) {
    token = generateQrToken();
    db.prepare('UPDATE stores SET qr_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(token, store.id);
    logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'store', entityId: store.id, summary: `「${store.name}」の打刻用QRを発行` });
  }
  res.json({ token, store: { id: store.id, name: store.name }, company_name: store.company_name });
});

// POST /api/stores/:id/qr/reissue - 打刻用QRの再発行（管理者）。古いポスターのQRは使えなくなる
router.post('/:id/qr/reissue', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  if (!isAdminUser(req)) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND company_id = ?').get(req.params.id, companyId) as any;
  if (!store) {
    res.status(404).json({ error: '店舗が見つかりません' });
    return;
  }
  const token = generateQrToken();
  db.prepare('UPDATE stores SET qr_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(token, store.id);
  logAudit({ userId: req.user!.id, companyId, action: 'update', entity: 'store', entityId: store.id, summary: `「${store.name}」の打刻用QRを再発行（旧QRは無効）` });
  res.json({ token });
});

export default router;
