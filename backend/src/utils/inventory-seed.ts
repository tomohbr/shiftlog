import db from '../db';

// ひばり工房のクリスマスマーケット2026用の初期データ（2026-10-24 芝原と決めた内容）。
// 品目・メニュー・1食あたりの使用数・去年の1日平均を入れる。画面からいつでも直せる。
// チキン単品は蓋付きパック、フォークはチキン系に1本ずつ、ドッグ・スープはおしぼりだけ、スープは基本蓋なしでテイクアウトだけ蓋付き（10/24 本人）。「仮」と書いたものは未確認（フォーク等の割り当て、カレー・冷凍野菜の1袋あたり、カレードッグの割合）。

type ItemSeed = {
  key: string; name: string; category: 'food' | 'container'; count_unit: string; use_unit: string; per_count?: number;
  half_ok?: boolean; source?: 'kobo' | 'purchase'; lead_days?: number; tolerance?: number; note?: string;
};

const ITEMS: ItemSeed[] = [
  { key: 'chicken', name: 'スモークチキン', category: 'food', count_unit: '本', use_unit: '本' },
  { key: 'sausage', name: 'ドッグ用ソーセージ', category: 'food', count_unit: '本', use_unit: '本' },
  { key: 'bun', name: 'バンズ', category: 'food', count_unit: '個', use_unit: '個' },
  { key: 'soup', name: 'スープ', category: 'food', count_unit: '袋', use_unit: '食', per_count: 35, half_ok: true, note: '2袋で70食' },
  { key: 'curry', name: 'カレー', category: 'food', count_unit: '袋', use_unit: '食', per_count: 20, half_ok: true, note: '1袋の食数は仮（実績から直す）' },
  { key: 'frank', name: 'フランクフルト（プレート用）', category: 'food', count_unit: '本', use_unit: '本' },
  { key: 'yamauchi', name: 'ヤマウチ（ハム）', category: 'food', count_unit: '袋', use_unit: '枚', per_count: 100, half_ok: true, note: '1袋100枚。催事専用で商品登録なし' },
  { key: 'bacon', name: 'ベーコンスライス', category: 'food', count_unit: 'パック', use_unit: '枚', per_count: 16, tolerance: 1, note: '1パック16〜17枚。1パック分のずれは差にしない' },
  { key: 'veg', name: '温野菜（冷凍）', category: 'food', count_unit: '袋', use_unit: '食', per_count: 20, half_ok: true, source: 'purchase', lead_days: 3, note: '1袋の食数・届くまでの日数は仮。足りなければ業務スーパー' },
  { key: 'tray', name: '黒トレー', category: 'container', count_unit: '枚', use_unit: '枚', source: 'purchase', lead_days: 5 },
  { key: 'pack', name: '蓋付きフードパック', category: 'container', count_unit: '個', use_unit: '個', source: 'purchase', lead_days: 5 },
  { key: 'sleeve', name: 'ホットドッグスリーブ', category: 'container', count_unit: '枚', use_unit: '枚', source: 'purchase', lead_days: 5 },
  { key: 'cup', name: 'スープカップ（蓋なし）', category: 'container', count_unit: '個', use_unit: '個', source: 'purchase', lead_days: 5, note: 'その場で飲むお客さん用' },
  { key: 'lid', name: 'テイクアウト用スープカップ（蓋付き）', category: 'container', count_unit: 'セット', use_unit: 'セット', source: 'purchase', lead_days: 5, note: 'テイクアウトのお客さんだけ。割合は仮で2割（メニューの使用数で直す）' },
  { key: 'fork', name: 'フォーク', category: 'container', count_unit: '本', use_unit: '本', source: 'purchase', lead_days: 5 },
  { key: 'oshibori', name: 'おしぼり', category: 'container', count_unit: '個', use_unit: '個', source: 'purchase', lead_days: 5 },
];

type MenuSeed = { key: string; name: string; label: string; stores: 'both' | 'eki' | 'hanabata'; price?: number; parts: [string, number][]; base: Partial<Record<'eki' | 'hanabata', [number, number, number]>> };

// base は [平日, 土曜, 日曜・祝日] の1日平均（2025年の実績。12/24・25は土曜扱い）
// カレードッグは駅だけの新メニュー。仮に「ドッグの2割がカレードッグに移る」として、駅のドッグを8割にしてある
const MENUS: MenuSeed[] = [
  { key: 'chicken', name: 'チキン単品', label: 'チキン', stores: 'both', price: 900, parts: [['chicken', 1], ['pack', 1], ['fork', 1]],
    base: { eki: [45.5, 206.0, 236.0], hanabata: [53.4, 89.4, 149.0] } },
  { key: 'plate', name: 'チキンプレート', label: 'チキンプレート', stores: 'hanabata',
    parts: [['chicken', 1], ['veg', 1], ['frank', 1], ['yamauchi', 2], ['bacon', 1], ['pack', 1], ['fork', 1]],
    base: { hanabata: [49.4, 143.6, 170.3] } },
  { key: 'set', name: 'ドッグセット', label: 'ドッグセット', stores: 'both', price: 1000, parts: [['sausage', 1], ['bun', 1], ['soup', 1], ['sleeve', 1], ['cup', 0.8], ['lid', 0.2], ['oshibori', 1]],
    base: { eki: [36.6, 145.4, 158.6], hanabata: [80.1, 165.8, 179.0] } },
  { key: 'dog', name: 'ドッグ単品', label: 'ドッグ単品', stores: 'both', price: 800, parts: [['sausage', 1], ['bun', 1], ['sleeve', 1], ['oshibori', 1]],
    base: { eki: [6.6, 40.8, 42.2], hanabata: [17.6, 58.2, 51.3] } },
  { key: 'curry', name: 'カレードッグ', label: 'カレードッグ', stores: 'eki', parts: [['sausage', 1], ['bun', 1], ['curry', 1], ['sleeve', 1], ['oshibori', 1]],
    base: { eki: [10.8, 46.5, 50.2] } },
  { key: 'soup', name: 'スープ単品', label: 'スープ', stores: 'both', price: 300, parts: [['soup', 1], ['cup', 0.8], ['lid', 0.2], ['oshibori', 1]],
    base: { eki: [14.9, 36.0, 31.0], hanabata: [10.1, 12.2, 53.3] } },
];

function findStore(companyId: number, words: string[]): number | null {
  const stores = db.prepare('SELECT id, name FROM stores WHERE company_id = ?').all(companyId) as { id: number; name: string }[];
  return stores.find(s => words.some(w => s.name.includes(w)))?.id ?? null;
}

/** 品目が1つもない会社にだけ入れる。入れた件数を返す */
export function seedHibariMarket(companyId: number): { items: number; menus: number; stores: { eki: number | null; hanabata: number | null } } {
  const exists = db.prepare('SELECT 1 FROM inv_items WHERE company_id = ?').get(companyId);
  if (exists) throw new Error('品目がすでにあります（初期データは空のときだけ入れられます）');
  const eki = findStore(companyId, ['熊本駅', '駅']);
  const hanabata = findStore(companyId, ['花畑']);

  const tx = db.transaction(() => {
    const itemIds = new Map<string, number>();
    const insItem = db.prepare(`
      INSERT INTO inv_items (company_id, name, category, count_unit, use_unit, per_count, half_ok, source, track_company, lead_days, tolerance, note, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    ITEMS.forEach((it, i) => {
      const purchase = it.source === 'purchase';
      const r = insItem.run(companyId, it.name, it.category, it.count_unit, it.use_unit, it.per_count ?? 1, it.half_ok ? 1 : 0,
        it.source || 'kobo', purchase ? 1 : 0, it.lead_days ?? null, it.tolerance ?? 0, it.note ?? null, (i + 1) * 10);
      itemIds.set(it.key, Number(r.lastInsertRowid));
    });

    const insMenu = db.prepare('INSERT INTO inv_menus (company_id, name, register_label, store_ids, price, sort) VALUES (?, ?, ?, ?, ?, ?)');
    const insPart = db.prepare('INSERT INTO inv_menu_parts (menu_id, item_id, qty) VALUES (?, ?, ?)');
    const insBase = db.prepare('INSERT INTO inv_baselines (company_id, store_id, menu_id, daytype, qty) VALUES (?, ?, ?, ?, ?)');
    MENUS.forEach((m, i) => {
      const storeIds = m.stores === 'both' ? null : m.stores === 'eki' ? (eki ? [eki] : []) : (hanabata ? [hanabata] : []);
      const r = insMenu.run(companyId, m.name, m.label, storeIds ? JSON.stringify(storeIds) : null, m.price ?? null, (i + 1) * 10);
      const menuId = Number(r.lastInsertRowid);
      for (const [k, q] of m.parts) insPart.run(menuId, itemIds.get(k)!, q);
      for (const [where, sid] of [['eki', eki], ['hanabata', hanabata]] as const) {
        const b = m.base[where];
        if (!b || !sid) continue;
        (['weekday', 'sat', 'sun'] as const).forEach((dt, j) => insBase.run(companyId, sid, menuId, dt, b[j]));
      }
    });

    const storeIds = [eki, hanabata].filter((x): x is number => !!x);
    db.prepare(`
      INSERT INTO inv_settings (company_id, enabled, store_ids, margin_pct, special_days, active_from, active_to)
      VALUES (?, 1, ?, 15, ?, '2026-11-15', '2026-12-26')
      ON CONFLICT(company_id) DO UPDATE SET store_ids = excluded.store_ids, special_days = excluded.special_days,
        active_from = COALESCE(inv_settings.active_from, excluded.active_from), active_to = COALESCE(inv_settings.active_to, excluded.active_to)
    `).run(companyId, JSON.stringify(storeIds), JSON.stringify({ '2026-12-24': 'sat', '2026-12-25': 'sat' }));
  });
  tx();
  return { items: ITEMS.length, menus: MENUS.length, stores: { eki, hanabata } };
}
