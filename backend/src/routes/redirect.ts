import { Router } from 'express';
import { createHash } from 'crypto';
import db from '../db';
import { trackingLinks } from '../data/tracking-links';

const router = Router();

// HEADもGETと同じく記録し、UAによる除外は集計時に行う。
router.get('/:code', (req, res): void => {
  res.set('Cache-Control', 'no-store');
  const link = trackingLinks.find(item => item.code === req.params.code);
  if (!link) {
    res.redirect(302, '/');
    return;
  }
  try {
    const ipHash = createHash('sha256').update(req.ip || req.socket.remoteAddress || '').digest('hex').slice(0, 16);
    db.prepare('INSERT INTO tracking_clicks (code, ua, ip_hash, referrer) VALUES (?, ?, ?, ?)')
      .run(link.code, req.get('user-agent') || '', ipHash, req.get('referer') || '');
  } catch (error) {
    // 記録に失敗しても訪問者の遷移は止めない。
    console.error('流入クリックの保存に失敗しました', error);
  }
  const destination = new URL(link.to, 'http://localhost');
  destination.searchParams.set('utm_source', link.source);
  destination.searchParams.set('utm_medium', link.medium);
  destination.searchParams.set('utm_campaign', link.campaign);
  destination.searchParams.set('utm_content', link.code);
  res.redirect(302, destination.pathname + destination.search + destination.hash);
});

export default router;
