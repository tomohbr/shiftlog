import db from '../db';

// ひばり工房のクリスマスマーケット2026用の初期データ（2026-10-24 設計、2026-11-07 に 11/2〜11/6 のメニュー・容器へ更新）。
// 品目・メニュー・1食あたりの使用数・去年の1日平均を入れる。画面からいつでも直せる。
// 会場とメニュー（11/2 芝原）: 熊本駅＝ひばりドッグ・カレードッグ（ライダードッグもあるかも）＋スープ付きのセット・スープ単品／
//   光の森＝ひばりドッグ・ライダードッグ＋セット／花畑＝チキン単品・チキンプレート・ひばりロック（スープ付き1,200、頼まれたら単品1,000）。
// 容器（11/1〜11/5 芝原）: 蓋付きはやめ、チキン単品・プレートは店内も持ち帰りも茶皿（在庫2,000）→ 深型L。ひばりロックは PFP-350＋フォーク＋ナイフ。
//   ドッグはスリーブ。スープは店内が二重断熱カップ、テイクアウトだけ蓋付きカップ（駅・光の森2割、花畑1割）。ドッグ・スープ・ひばりロックにおしぼり。
// 野菜（11/7 芝原）: 温野菜はやめ、プレートもブロッコリーとキャロット（ひばりロックと同じ品目）。
// 「仮」: ライダードッグの中身（ソーセージ1・バンズ1で計算）と値段、カレーの1袋あたり、プレートのブロッコリー・キャロットの数（各1）、袋の入り数。

type ItemSeed = {
  key: string; name: string; category: 'food' | 'container'; count_unit: string; use_unit: string; per_count?: number;
  half_ok?: boolean; source?: 'kobo' | 'purchase'; lead_days?: number; tolerance?: number; note?: string;
};

const ITEMS: ItemSeed[] = [
  { key: 'chicken', name: 'スモークチキン', category: 'food', count_unit: '本', use_unit: '本' },
  { key: 'sausage', name: 'ドッグ用ソーセージ', category: 'food', count_unit: '本', use_unit: '本', note: 'ライダードッグも1本で仮に計算' },
  { key: 'bun', name: 'バンズ', category: 'food', count_unit: '個', use_unit: '個', source: 'purchase', lead_days: 7, note: 'パン屋に発注。1週間前に頼む' },
  { key: 'soup', name: 'スープ', category: 'food', count_unit: '袋', use_unit: '食', per_count: 35, half_ok: true, note: '2袋で70食' },
  { key: 'curry', name: 'カレー', category: 'food', count_unit: '袋', use_unit: '食', per_count: 20, half_ok: true, note: '1袋の食数は仮（実績から直す）' },
  { key: 'frank', name: 'フランクフルト（プレート用）', category: 'food', count_unit: '本', use_unit: '本' },
  { key: 'yamauchi', name: 'ヤマウチ（ハム）', category: 'food', count_unit: '袋', use_unit: '枚', per_count: 100, half_ok: true, note: '1袋100枚。催事専用で商品登録なし' },
  { key: 'bacon', name: 'ベーコンスライス（プレート用）', category: 'food', count_unit: 'パック', use_unit: '枚', per_count: 16, tolerance: 1, note: '1パック16〜17枚。1パック分のずれは差にしない' },
  { key: 'rock_bacon', name: 'ベーコン（ひばりロック用）', category: 'food', count_unit: 'kg', use_unit: 'g', per_count: 1000, half_ok: true, note: '工房で作る。1食100g。重さ（kg）で数える' },
  { key: 'cheese', name: 'ミックスチーズ（ひばりロック用）', category: 'food', count_unit: 'kg', use_unit: 'g', per_count: 1000, half_ok: true, source: 'purchase', lead_days: 7, note: '1食20g。重さ（kg）で数える' },
  { key: 'broc', name: '冷凍ブロッコリー', category: 'food', count_unit: '房', use_unit: '房', source: 'purchase', lead_days: 7, note: '西原商会。花畑のプレートとひばりロックに1房ずつ（プレートの数は仮）。袋の入り数が分かったら「袋」に直す。足りなければ業務スーパー' },
  { key: 'carrot', name: '冷凍キャロット', category: 'food', count_unit: '本', use_unit: '本', source: 'purchase', lead_days: 7, note: '西原商会。花畑のプレートとひばりロックに1本ずつ（プレートの数は仮）。袋の入り数が分かったら「袋」に直す。足りなければ業務スーパー' },
  { key: 'dish', name: 'チキン用の皿（茶皿→深型L）', category: 'container', count_unit: '枚', use_unit: '枚', source: 'purchase', lead_days: 7, note: '在庫の耐油茶皿2,000を先に使い、なくなったら HEIKO クラフトフードトレー深型L（シモジマ・100枚/袋）。蓋なし・持ち帰りも同じ' },
  { key: 'pfp', name: 'フードパック PFP-350（ひばりロック用）', category: 'container', count_unit: '個', use_unit: '個', source: 'purchase', lead_days: 7, note: 'シモジマ・50個/袋' },
  { key: 'sleeve', name: 'ホットドッグスリーブL', category: 'container', count_unit: '枚', use_unit: '枚', source: 'purchase', lead_days: 7, note: 'シモジマ・100枚/袋。ひばり・カレー・ライダーとも' },
  { key: 'cup', name: 'スープカップ（店内・二重断熱）', category: 'container', count_unit: '個', use_unit: '個', source: 'purchase', lead_days: 7, note: 'その場で飲むお客さん用。シモジマ・25個/袋' },
  { key: 'lid', name: 'テイクアウト用スープカップ（蓋付き）', category: 'container', count_unit: 'セット', use_unit: 'セット', source: 'purchase', lead_days: 7, note: 'テイクアウトのお客さんだけ。駅・光の森2割・花畑1割（メニューの使用数で直せる）' },
  { key: 'fork', name: 'フォーク', category: 'container', count_unit: '本', use_unit: '本', source: 'purchase', lead_days: 7, note: 'アスクル 黒・個包装・3,000本/セット' },
  { key: 'knife', name: 'ナイフ（ひばりロック用）', category: 'container', count_unit: '本', use_unit: '本', source: 'purchase', lead_days: 7, note: '会社の在庫＋アスクル 黒・個包装・100本/袋' },
  { key: 'oshibori', name: 'おしぼり', category: 'container', count_unit: '枚', use_unit: '枚', source: 'purchase', lead_days: 7, note: 'アスクル・1,200枚/箱' },
];

type StoreKey = 'eki' | 'hikari' | 'hanabata';
type Base = [number, number, number];
type MenuSeed = { key: string; name: string; label: string; stores: StoreKey[] | 'all'; price?: number; parts: [string, number][]; base: Partial<Record<StoreKey, Base>> };

// base は [平日, 土曜, 日曜・祝日] の1日平均（2025年の実績。12/24・25は土曜扱い）。予想はこれに15%足す（設定の上乗せ）。
// 熊本駅のドッグ（セット・単品）は去年の駅のドッグを「ひばりドッグとカレードッグで半々」（10/24 本人）。ライダードッグは駅では未定なので土台なし（売れたら締めで数える）。
// 光の森は去年の光の森のドッグを「ひばりドッグとライダードッグで半々」。花畑のひばりロックは去年の花畑のドッグセットの数（11/5 本人OK）。
const DOG_SET: [string, number][] = [['sausage', 1], ['bun', 1], ['soup', 1], ['sleeve', 1], ['cup', 0.8], ['lid', 0.2], ['oshibori', 1]];
const DOG: [string, number][] = [['sausage', 1], ['bun', 1], ['sleeve', 1], ['oshibori', 1]];
const ROCK: [string, number][] = [['rock_bacon', 100], ['cheese', 20], ['broc', 1], ['carrot', 1], ['pfp', 1], ['fork', 1], ['knife', 1], ['oshibori', 1]];
const MENUS: MenuSeed[] = [
  { key: 'set', name: 'ひばりドッグセット', label: 'ドッグセット', stores: ['eki', 'hikari'], price: 1000, parts: DOG_SET,
    base: { eki: [22.9, 90.9, 99.1], hikari: [65.1, 105.6, 105.6] } },
  { key: 'dog', name: 'ひばりドッグ', label: 'ドッグ単品', stores: ['eki', 'hikari'], price: 800, parts: DOG,
    base: { eki: [4.2, 25.5, 26.4], hikari: [14.2, 27.6, 27.6] } },
  { key: 'curry_set', name: 'カレードッグセット', label: 'カレードッグセット', stores: ['eki'], price: 1000, parts: [...DOG_SET, ['curry', 1]],
    base: { eki: [22.9, 90.9, 99.1] } },
  { key: 'curry', name: 'カレードッグ', label: 'カレードッグ', stores: ['eki'], price: 800, parts: [...DOG, ['curry', 1]],
    base: { eki: [4.2, 25.5, 26.4] } },
  { key: 'rider_set', name: 'ライダードッグセット', label: 'ライダードッグセット', stores: ['eki', 'hikari'], parts: DOG_SET,
    base: { hikari: [65.1, 105.6, 105.6] } },
  { key: 'rider', name: 'ライダードッグ', label: 'ライダードッグ', stores: ['eki', 'hikari'], parts: DOG,
    base: { hikari: [14.2, 27.6, 27.6] } },
  { key: 'soup', name: 'スープ単品', label: 'スープ', stores: ['eki', 'hikari'], price: 300, parts: [['soup', 1], ['cup', 0.8], ['lid', 0.2], ['oshibori', 1]],
    base: { eki: [14.9, 36.0, 31.0], hikari: [12.5, 21.8, 21.8] } },
  { key: 'chicken', name: 'チキン単品', label: 'チキン', stores: ['hanabata'], price: 900, parts: [['chicken', 1], ['dish', 1], ['fork', 1]],
    base: { hanabata: [53.4, 89.4, 149.0] } },
  { key: 'plate', name: 'チキンプレート', label: 'チキンプレート', stores: ['hanabata'], price: 1300,
    parts: [['chicken', 1], ['broc', 1], ['carrot', 1], ['frank', 1], ['yamauchi', 2], ['bacon', 1], ['dish', 1], ['fork', 1]],
    base: { hanabata: [49.4, 143.6, 170.3] } },
  { key: 'rock_set', name: 'ひばりロック（スープ付き）', label: 'ひばりロック', stores: ['hanabata'], price: 1200,
    parts: [...ROCK, ['soup', 1], ['cup', 0.9], ['lid', 0.1]],
    base: { hanabata: [80.1, 165.8, 179.0] } },
  { key: 'rock', name: 'ひばりロック単品', label: 'ひばりロック単品', stores: ['hanabata'], price: 1000, parts: ROCK, base: {} },
];

function findStore(companyId: number, words: string[]): number | null {
  const stores = db.prepare('SELECT id, name FROM stores WHERE company_id = ?').all(companyId) as { id: number; name: string }[];
  return stores.find(s => words.some(w => s.name.includes(w)))?.id ?? null;
}

/** 締め・積み込み・数えなどの記録が1件でもあるか（あれば入れ直しはしない） */
export function hasInventoryRecords(companyId: number): boolean {
  return ['inv_moves', 'inv_counts', 'inv_sales', 'inv_loads', 'inv_requests']
    .some(t => !!db.prepare(`SELECT 1 FROM ${t} WHERE company_id = ? LIMIT 1`).get(companyId));
}

/**
 * 初期データを入れる。品目が1つもない会社にだけ入れる。
 * replace=true のときは、記録がまだ1件もない場合に限り、今の品目・メニュー・土台を消してから入れ直す。
 */
export function seedHibariMarket(companyId: number, replace = false): { items: number; menus: number; stores: Record<StoreKey, number | null> } {
  const exists = db.prepare('SELECT 1 FROM inv_items WHERE company_id = ?').get(companyId);
  if (exists && !replace) throw new Error('品目がすでにあります（初期データは空のときだけ入れられます）');
  if (exists && hasInventoryRecords(companyId)) throw new Error('締めや積み込みの記録があるので入れ直せません。品目・メニューは画面で直してください');
  const ids: Record<StoreKey, number | null> = {
    eki: findStore(companyId, ['熊本駅', '駅']),
    hikari: findStore(companyId, ['光の森']),
    hanabata: findStore(companyId, ['花畑']),
  };

  const tx = db.transaction(() => {
    if (exists) {
      db.prepare('DELETE FROM inv_baselines WHERE company_id = ?').run(companyId);
      db.prepare('DELETE FROM inv_menu_parts WHERE menu_id IN (SELECT id FROM inv_menus WHERE company_id = ?)').run(companyId);
      db.prepare('DELETE FROM inv_menu_parts WHERE item_id IN (SELECT id FROM inv_items WHERE company_id = ?)').run(companyId);
      db.prepare('DELETE FROM inv_menus WHERE company_id = ?').run(companyId);
      db.prepare('DELETE FROM inv_items WHERE company_id = ?').run(companyId);
    }
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
      const storeIds = m.stores === 'all' ? null : m.stores.map(k => ids[k]).filter((x): x is number => !!x);
      const r = insMenu.run(companyId, m.name, m.label, storeIds ? JSON.stringify(storeIds) : null, m.price ?? null, (i + 1) * 10);
      const menuId = Number(r.lastInsertRowid);
      for (const [k, q] of m.parts) insPart.run(menuId, itemIds.get(k)!, q);
      for (const where of Object.keys(m.base) as StoreKey[]) {
        const b = m.base[where], sid = ids[where];
        if (!b || !sid) continue;
        (['weekday', 'sat', 'sun'] as const).forEach((dt, j) => insBase.run(companyId, sid, menuId, dt, b[j]));
      }
    });

    const storeIds = [ids.eki, ids.hikari, ids.hanabata].filter((x): x is number => !!x);
    db.prepare(`
      INSERT INTO inv_settings (company_id, enabled, store_ids, margin_pct, special_days, active_from, active_to)
      VALUES (?, 1, ?, 15, ?, '2026-11-15', '2026-12-26')
      ON CONFLICT(company_id) DO UPDATE SET store_ids = excluded.store_ids, special_days = excluded.special_days,
        active_from = COALESCE(inv_settings.active_from, excluded.active_from), active_to = COALESCE(inv_settings.active_to, excluded.active_to)
    `).run(companyId, JSON.stringify(storeIds), JSON.stringify({ '2026-12-24': 'sat', '2026-12-25': 'sat' }));
  });
  tx();
  return { items: ITEMS.length, menus: MENUS.length, stores: ids };
}
