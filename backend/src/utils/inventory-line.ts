import db from '../db';
import { buttonsCard } from '../routes/line';
import { COMPANY_LOC, InvItem, addMove, businessDate, getSettings, invRole, items, stockAt } from './inventory';

// LINE の一言で会社在庫に入庫する（担当者＝管理者だけ。11/7 芝原「LINEで入れたら入るように」）。
//  - 「シモジマ届いた」… 入荷待ち（inv_pending）に登録してある注文をまとめて入庫の案にする
//  - 「テイクアウトカップ 500」「PFP 18袋」… 品目名のだいたいの一致＋数。袋・箱・セットは品目のメモ（例「50個/袋」）で換算
// どちらも確認カードを返し、「入庫する」を押したときだけ記録する（打ち間違いで在庫が動かないように）。

type Line = { item_id: number; qty: number };
type Draft = { lines: Line[]; pending_ids: number[]; label: string };

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s　・,，、。（）()「」\-ー→/]/g, '');
const bigrams = (s: string) => { const out: string[] = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out.length ? out : [s]; };
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (b.includes(a) || a.includes(b)) return Math.min(1, 0.75 + Math.min(a.length, b.length) / Math.max(a.length, b.length) / 4);
  const A = bigrams(a); const B = bigrams(b); const pool = [...B]; let hit = 0;
  for (const g of A) { const i = pool.indexOf(g); if (i >= 0) { hit++; pool.splice(i, 1); } }
  return (2 * hit) / (A.length + B.length);
}

/** 品目名のだいたいの一致。いちばん近いものと点数を返す */
export function matchItem(list: InvItem[], word: string): { item: InvItem; score: number } | null {
  const q = norm(word);
  if (!q) return null;
  let best: { item: InvItem; score: number } | null = null;
  for (const it of list) {
    const base = it.name.replace(/[（(].*?[）)]/g, '');
    const inner = (it.name.match(/[（(](.*?)[）)]/)?.[1] || '').split(/[・→]/);
    const score = Math.max(dice(q, norm(it.name)), dice(q, norm(base)), ...inner.filter(Boolean).map(x => dice(q, norm(x)) * 0.9));
    if (!best || score > best.score) best = { item: it, score };
  }
  return best;
}

const PACK_UNITS = ['袋', '箱', 'セット', 'ケース', 'パック', '束'];
/** 「3袋」などを数え単位に直す。品目のメモの「50個/袋」から換算。直せなければ null */
function toCountUnit(it: InvItem, qty: number, unit: string | undefined): number | null {
  if (!unit || unit === it.count_unit) return qty;
  if (unit === 'キロ' && it.count_unit === 'kg') return qty;
  if (!PACK_UNITS.includes(unit)) return qty; // 個・枚・本などは数え単位とみなす
  const m = (it.note || '').normalize('NFKC').match(new RegExp(`([0-9][0-9,]*)\\s*(?:個|枚|本|セット)\\s*/\\s*${unit}`));
  return m ? qty * Number(m[1].replace(/,/g, '')) : null;
}

/** 文から「品目＋数」を取り出す。1行・読点ごとに1品目 */
export function parseLines(list: InvItem[], text: string): { lines: Line[]; problems: string[]; unknown: string[] } {
  const lines: Line[] = []; const problems: string[] = []; const unknown: string[] = [];
  const parts = text.normalize('NFKC').split(/[\n、,，;／]+/).map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^(.*?)[\s:：=]*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(個|枚|本|袋|箱|セット|ケース|パック|束|kg|キロ|房)?\s*(?:入庫|入れて|追加|あります|ある)?\s*$/);
    if (!m) continue;
    const word = m[1].replace(/^(入庫|在庫|追加)\s*/, '').trim();
    const qty = Number(m[2].replace(/,/g, ''));
    if (!word || !(qty > 0)) continue;
    const hit = matchItem(list, word);
    if (!hit || hit.score < 0.45) { unknown.push(`「${word}」に近い品目が見つかりません`); continue; }
    const q = toCountUnit(hit.item, qty, m[3]);
    if (q == null) { problems.push(`${hit.item.name}の1${m[3]}あたりの数が分かりません（${hit.item.count_unit}で送ってください）`); continue; }
    const prev = lines.find(l => l.item_id === hit.item.id);
    if (prev) prev.qty += q; else lines.push({ item_id: hit.item.id, qty: q });
  }
  return { lines, problems, unknown };
}

function saveDraft(companyId: number, userId: number, d: Draft): number {
  db.prepare("DELETE FROM inv_line_drafts WHERE created_at < datetime('now', '-3 days')").run();
  return Number(db.prepare('INSERT INTO inv_line_drafts (company_id, user_id, data) VALUES (?, ?, ?)').run(companyId, userId, JSON.stringify(d)).lastInsertRowid);
}

function draftCard(companyId: number, id: number, d: Draft, problems: string[] = []) {
  const map = new Map(items(companyId).map(i => [i.id, i]));
  const stock = stockAt(companyId, COMPANY_LOC);
  const rows = d.lines.map(l => { const it = map.get(l.item_id)!; return `${it.name} ＋${fmt(l.qty)}${it.count_unit}（今 ${fmt(stock.get(l.item_id) || 0)} → ${fmt((stock.get(l.item_id) || 0) + l.qty)}）`; });
  return buttonsCard('会社在庫に入れますか', `${d.label}：会社在庫に入れますか`, [...rows, ...problems.map(p => `※${p}`)],
    [{ label: '入庫する', data: `inv=ok&d=${id}`, primary: true, color: '#06C755' }, { label: 'やめる', data: `inv=no&d=${id}` }]);
}

const isAdmin = (companyId: number, userId: number) => invRole(companyId, userId) === 'admin' && !!getSettings(companyId)?.enabled;

/**
 * 管理者が送った文が入庫の話なら確認カードを返す。関係ない文なら null（いつもの処理へ）。
 */
export function inventoryTextReply(companyId: number, userId: number, text: string): Record<string, unknown> | string | null {
  if (!isAdmin(companyId, userId)) return null;
  const t = text.normalize('NFKC').trim();

  if (/^(入荷待ち|発注済み|注文中)$/.test(t)) {
    const rows = db.prepare("SELECT p.supplier, p.qty, p.note, i.name, i.count_unit FROM inv_pending p JOIN inv_items i ON i.id = p.item_id WHERE p.company_id = ? AND p.status = 'open' ORDER BY p.id").all(companyId) as any[];
    return rows.length ? `【入荷待ち】\n${rows.map(r => `・${r.supplier} ${r.name} ${fmt(r.qty)}${r.count_unit}`).join('\n')}\n\n届いたら「${rows[0].supplier}届いた」と送ってください。` : '入荷待ちの注文はありません。';
  }

  // 「シモジマ届いた」
  const arrived = t.match(/^(.+?)(?:の分|分)?(?:が|も)?(?:届いた|届きました|着いた|着きました|来た|来ました|きた|到着)/);
  if (arrived) {
    const word = norm(arrived[1]);
    const pend = (db.prepare("SELECT * FROM inv_pending WHERE company_id = ? AND status = 'open'").all(companyId) as any[])
      .filter(p => { const s = norm(p.supplier); return s && (word.includes(s) || s.includes(word)); });
    if (pend.length) {
      const lines: Line[] = [];
      for (const p of pend) { const prev = lines.find(l => l.item_id === p.item_id); if (prev) prev.qty += p.qty; else lines.push({ item_id: p.item_id, qty: p.qty }); }
      const d: Draft = { lines, pending_ids: pend.map(p => p.id), label: `${pend[0].supplier}の注文` };
      return draftCard(companyId, saveDraft(companyId, userId, d), d);
    }
  }

  // 「テイクアウトカップ 500」など（数字が入っている文だけ）
  if (!/[0-9]/.test(t) || t.length > 300) return null;
  const { lines, problems, unknown } = parseLines(items(companyId), t);
  // 品目に1つも当たらない文はいつもの処理へ（シフトの連絡などを横取りしない）
  if (!lines.length) return problems.length ? `入庫できませんでした。\n${problems.join('\n')}` : null;
  const d: Draft = { lines, pending_ids: [], label: 'LINEで入力' };
  return draftCard(companyId, saveDraft(companyId, userId, d), d, [...problems, ...unknown]);
}

/** 確認カードのボタン（inv=ok / inv=no） */
export function inventoryPostback(companyId: number, userId: number, p: URLSearchParams): string {
  if (!isAdmin(companyId, userId)) return 'この操作は担当の人だけができます。';
  const id = Number(p.get('d'));
  const row = db.prepare('SELECT * FROM inv_line_drafts WHERE id = ? AND company_id = ?').get(id, companyId) as any;
  if (!row) return 'この確認は期限が切れました。もう一度送ってください。';
  if (row.done_at) return 'これはもう処理済みです。';
  db.prepare("UPDATE inv_line_drafts SET done_at = datetime('now') WHERE id = ?").run(id);
  if (p.get('inv') !== 'ok') return '入庫をやめました。';
  const d = JSON.parse(row.data) as Draft;
  const map = new Map(items(companyId, true).map(i => [i.id, i]));
  const date = businessDate();
  db.transaction(() => {
    for (const l of d.lines) addMove(companyId, COMPANY_LOC, date, l.item_id, l.qty, 'purchase', `LINE: ${d.label}`, userId);
    if (d.pending_ids.length) db.prepare(`UPDATE inv_pending SET status = 'received', received_at = datetime('now') WHERE id IN (${d.pending_ids.map(() => '?').join(',')}) AND company_id = ?`).run(...d.pending_ids, companyId);
  })();
  const stock = stockAt(companyId, COMPANY_LOC);
  return `会社在庫に入れました。\n${d.lines.map(l => { const it = map.get(l.item_id)!; return `・${it.name} ＋${fmt(l.qty)} → ${fmt(stock.get(l.item_id) || 0)}${it.count_unit}`; }).join('\n')}`;
}
