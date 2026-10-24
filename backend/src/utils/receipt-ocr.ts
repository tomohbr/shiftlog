import Anthropic from '@anthropic-ai/sdk';

// 締めレシート（部門別の集計）の写真から、部門ごとの数と金額を読み取る。
// レジは3種類あり書式が違うので、決まった位置ではなく「メニューの一覧」と照らし合わせて読ませる。
// 読み取った結果は保存せずに返すだけ。スタッフが画面で確かめてから保存する。
// ANTHROPIC_API_KEY が無いときは使えない（手入力だけになる）。

export const receiptOcrAvailable = () => !!process.env.ANTHROPIC_API_KEY;

export interface ReceiptMenu { id: number; name: string; register_label: string | null; price: number | null }
export interface ReceiptResult {
  lines: { menu_id: number; qty: number; amount: number | null }[];
  total_amount: number | null;
  unmatched: { label: string; qty: number | null; amount: number | null }[];
  receipt_date: string | null;
  note: string | null;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines', 'total_amount', 'unmatched', 'receipt_date', 'note'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['menu_id', 'qty', 'amount'],
        properties: { menu_id: { type: 'integer' }, qty: { type: 'number' }, amount: { type: ['integer', 'null'] } },
      },
    },
    total_amount: { type: ['integer', 'null'] },
    unmatched: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['label', 'qty', 'amount'],
        properties: { label: { type: 'string' }, qty: { type: ['number', 'null'] }, amount: { type: ['integer', 'null'] } },
      },
    },
    receipt_date: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
  },
};

let client: Anthropic | null = null;

export async function readReceipt(imageBase64: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp', menus: ReceiptMenu[]): Promise<ReceiptResult> {
  client ??= new Anthropic();
  const menuList = menus.map(m => `- menu_id ${m.id}: ${m.name}${m.register_label && m.register_label !== m.name ? `（レジの表示: ${m.register_label}）` : ''}${m.price ? ` 単価${m.price}円` : ''}`).join('\n');

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: [
      '屋台のレジの締めレシート（精算・点検レポート）の写真から、部門ごとの販売数と金額を読み取ります。',
      'レジは機種が複数あり、書式が違います。部門の名前は省略・カタカナ・番号（部門1など）で出ることがあります。',
      '下のメニューの一覧と照らし合わせ、対応する部門の「点数（個数）」を qty、「金額」を amount に入れてください。',
      '確信が持てない行は lines に入れず unmatched に、レシートに書いてある表記のまま入れてください。',
      '取消・返品・値引きの行は数に含めず note に書いてください。総売上（合計）があれば total_amount に入れてください。',
      'レシートの日付が読めれば receipt_date に YYYY-MM-DD で入れてください。',
      '写真が締めレシートでない、または読めない場合は lines を空にして note に理由を書いてください。',
    ].join('\n'),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: `メニューの一覧:\n${menuList}` },
      ],
    }],
  });

  if (response.stop_reason === 'refusal') throw new Error('レシートを読み取れませんでした。数を手で入れてください');
  const text = response.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
  let parsed: ReceiptResult;
  try { parsed = JSON.parse(text) as ReceiptResult; } catch { throw new Error('レシートを読み取れませんでした。数を手で入れてください'); }
  const known = new Set(menus.map(m => m.id));
  parsed.lines = (parsed.lines || []).filter(l => known.has(l.menu_id) && Number.isFinite(l.qty) && l.qty >= 0);
  return parsed;
}
