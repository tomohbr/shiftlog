import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';

// 閲覧用リンク（社長・オーナーなど、ログインせずにいつでもシフト表を見たい人向け）。
//   - 管理者が人ごとに発行する。URL を開くだけで、公開済みの月のシフト（全員・全会場）が見られる
//   - 見るだけ。時給・電話・打刻などは出さない。いつでも止められる（止めると URL は使えなくなる）
db.exec(`
  CREATE TABLE IF NOT EXISTS view_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER,
    label TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    last_viewed_at DATETIME
  );
`);

const router = Router();
const APP_URL = process.env.APP_URL || 'https://shiftlog-production.up.railway.app';
const isAdmin = (req: AuthRequest) => ['admin', 'super_admin'].includes(req.user!.role);
const urlOf = (token: string) => `${APP_URL}/v/${token}`;

// GET /api/view-links - 発行済みの閲覧用リンク（管理者）
router.get('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const rows = db.prepare('SELECT id, user_id, label, token, created_at, last_viewed_at FROM view_links WHERE company_id = ? AND revoked_at IS NULL ORDER BY id').all(req.companyId!) as any[];
  res.json({ links: rows.map(r => ({ ...r, url: urlOf(r.token) })) });
});

// POST /api/view-links { label, user_id? } - 発行（同じ人・同じ名前の有効なリンクがあればそれを返す）
router.post('/', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const companyId = req.companyId!;
  const label = String(req.body?.label || '').trim().slice(0, 30);
  const userId = req.body?.user_id ? Number(req.body.user_id) : null;
  if (!label) { res.status(400).json({ error: '誰用のリンクか（名前）を入れてください' }); return; }
  const existing = db.prepare('SELECT * FROM view_links WHERE company_id = ? AND revoked_at IS NULL AND label = ? AND COALESCE(user_id, 0) = COALESCE(?, 0)').get(companyId, label, userId) as any;
  if (existing) { res.json({ link: { ...existing, url: urlOf(existing.token) } }); return; }
  const token = crypto.randomBytes(18).toString('base64url');
  const r = db.prepare('INSERT INTO view_links (company_id, user_id, label, token) VALUES (?, ?, ?, ?)').run(companyId, userId, label, token);
  logAudit({ userId: req.user!.id, companyId, action: 'create', entity: 'view_link', entityId: Number(r.lastInsertRowid), summary: `「${label}」用の閲覧リンクを発行` });
  res.status(201).json({ link: { id: Number(r.lastInsertRowid), label, user_id: userId, token, url: urlOf(token) } });
});

// DELETE /api/view-links/:id - 止める
router.delete('/:id', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  if (!isAdmin(req)) { res.status(403).json({ error: '管理者権限が必要です' }); return; }
  const r = db.prepare('UPDATE view_links SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND revoked_at IS NULL').run(Number(req.params.id), req.companyId!);
  if (r.changes) logAudit({ userId: req.user!.id, companyId: req.companyId!, action: 'delete', entity: 'view_link', entityId: Number(req.params.id), summary: '閲覧リンクを止めた' });
  res.json({ ok: r.changes > 0 });
});

// GET /api/view-links/public/:token?year=&month= - ログインなしで見る（公開済みの月だけ）
router.get('/public/:token', (req: Request, res: Response): void => {
  const link = db.prepare('SELECT * FROM view_links WHERE token = ? AND revoked_at IS NULL').get(String(req.params.token)) as any;
  if (!link) { res.status(404).json({ error: 'このリンクは使えません。担当者に新しいリンクをもらってください。' }); return; }
  const companyId = link.company_id;
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const year = Number(req.query.year) || jst.getUTCFullYear();
  const month = Number(req.query.month) || jst.getUTCMonth() + 1;
  if (month < 1 || month > 12 || year < 2000 || year > 2100) { res.status(400).json({ error: '月が正しくありません' }); return; }
  const company = db.prepare('SELECT name FROM companies WHERE id = ?').get(companyId) as any;
  const stores = db.prepare('SELECT id, name FROM stores WHERE company_id = ? ORDER BY id').all(companyId);
  const published = !!db.prepare('SELECT 1 FROM shift_publications WHERE company_id = ? AND year = ? AND month = ? AND is_published = 1').get(companyId, year, month);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const shifts = published ? db.prepare(`
    SELECT s.id, s.user_id, s.date, s.start_time, s.end_time, s.store_id,
           COALESCE(NULLIF(uc.display_name, ''), u.name) AS user_name, uc.sort_order AS user_order, st.name AS store_name
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN user_companies uc ON uc.user_id = s.user_id AND uc.company_id = s.company_id
    LEFT JOIN stores st ON st.id = s.store_id
    WHERE s.company_id = ? AND substr(s.date, 1, 7) = ?
    ORDER BY s.date, s.start_time
  `).all(companyId, ym) : [];
  // 公開済みの月（前後の月に送るボタン用）
  const months = db.prepare('SELECT year, month FROM shift_publications WHERE company_id = ? AND is_published = 1 ORDER BY year, month').all(companyId);
  db.prepare('UPDATE view_links SET last_viewed_at = CURRENT_TIMESTAMP WHERE id = ?').run(link.id);
  res.json({ company_name: company?.name || '', label: link.label, year, month, published, stores, shifts, months });
});

export default router;
