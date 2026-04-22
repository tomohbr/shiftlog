import { Router, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';

const router = Router();

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
    stores,
    plan: {
      name: subscription?.plan || 'free',
      max_stores: subscription?.max_stores || 1,
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
  res.json({ store });
});

// POST /api/stores
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
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
  const maxStores = subscription?.max_stores || 1;

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

  const result = db.prepare(
    'INSERT INTO stores (company_id, name, address, phone) VALUES (?, ?, ?, ?)'
  ).run(companyId, name, address || null, phone || null);

  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(result.lastInsertRowid);
  logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'store', entityId: Number(result.lastInsertRowid), summary: `店舗「${name}」を追加` });
  res.status(201).json({ store });
});

// PUT /api/stores/:id
router.put('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
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

  db.prepare(
    'UPDATE stores SET name = ?, address = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?'
  ).run(name, address || null, phone || null, req.params.id, companyId);

  const updated = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  logAudit({ userId: req.user!.id, companyId, action: 'update', entity: 'store', entityId: Number(req.params.id), summary: `店舗「${name}」を更新` });
  res.json({ store: updated });
});

// DELETE /api/stores/:id
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;

  if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
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

export default router;
