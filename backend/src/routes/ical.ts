import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/ical/token - 認証済みユーザーが購読URL用トークンを発行（冪等）
router.post('/token', authenticateToken, (req: AuthRequest, res: Response): void => {
  const userId = req.user!.id;
  let row = db.prepare('SELECT token FROM ical_tokens WHERE user_id = ?').get(userId) as any;
  if (!row) {
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO ical_tokens (user_id, token) VALUES (?, ?)').run(userId, token);
    row = { token };
  }
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const url = `${proto}://${host}/api/ical/${row.token}.ics`;
  res.json({ url, token: row.token });
});

// DELETE /api/ical/token - トークン失効
router.delete('/token', authenticateToken, (req: AuthRequest, res: Response): void => {
  db.prepare('DELETE FROM ical_tokens WHERE user_id = ?').run(req.user!.id);
  res.json({ message: '失効しました' });
});

// GET /api/ical/:token.ics - 認証不要（トークンで識別）
router.get('/:token.ics', (req: Request, res: Response): void => {
  const token = req.params.token;
  const row = db.prepare('SELECT user_id FROM ical_tokens WHERE token = ?').get(token) as any;
  if (!row) {
    res.status(404).send('not found');
    return;
  }
  const userId = row.user_id;
  // 今月〜3か月先までのシフト
  const shifts = db.prepare(`
    SELECT s.*, c.name as company_name
    FROM shifts s
    JOIN companies c ON s.company_id = c.id
    WHERE s.user_id = ?
    AND date(s.date) >= date('now', '-30 days')
    AND date(s.date) <= date('now', '+180 days')
    ORDER BY s.date, s.start_time
  `).all(userId) as any[];

  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}T${String(now.getUTCHours()).padStart(2,'0')}${String(now.getUTCMinutes()).padStart(2,'0')}${String(now.getUTCSeconds()).padStart(2,'0')}Z`;

  const escape = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShiftLog//JP',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:シフトログ',
    'X-WR-TIMEZONE:Asia/Tokyo',
  ];

  for (const s of shifts) {
    // date: "YYYY-MM-DD", start_time/end_time: "HH:MM" (assumed JST)
    const [y, m, d] = s.date.split('-');
    const [sh, sm] = s.start_time.split(':');
    const [eh, em] = s.end_time.split(':');
    // JST (+09:00) → UTC は -9 時間シフト
    const startJst = new Date(Date.UTC(+y, +m - 1, +d, +sh - 9, +sm || 0, 0));
    let endJst = new Date(Date.UTC(+y, +m - 1, +d, +eh - 9, +em || 0, 0));
    if (endJst <= startJst) {
      // 終了が翌日にまたがるシフトに対応
      endJst = new Date(endJst.getTime() + 24 * 3600 * 1000);
    }
    const fmt = (dt: Date) => `${dt.getUTCFullYear()}${String(dt.getUTCMonth()+1).padStart(2,'0')}${String(dt.getUTCDate()).padStart(2,'0')}T${String(dt.getUTCHours()).padStart(2,'0')}${String(dt.getUTCMinutes()).padStart(2,'0')}00Z`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:shiftlog-${s.id}@shiftlog-production.up.railway.app`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${fmt(startJst)}`);
    lines.push(`DTEND:${fmt(endJst)}`);
    lines.push(`SUMMARY:${escape(s.company_name)} シフト`);
    const parts: string[] = [];
    if (s.break_minutes) parts.push(`休憩${s.break_minutes}分`);
    if (s.notes) parts.push(s.notes);
    if (parts.length) lines.push(`DESCRIPTION:${escape(parts.join(' / '))}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(lines.join('\r\n'));
});

export default router;
