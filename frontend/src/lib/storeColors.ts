// 会場の色分け。どの画面でも同じ会場は同じ色にして、文字を読まなくても会場が分かるようにする。
// 色は登録順（id 昇順）で割り当てる。色だけに頼らないよう、会場名も必ず一緒に出すこと。

export interface StoreColor {
  solid: string   // 帯・ドット・塗り
  soft: string    // 薄い背景
  text: string    // 薄い背景の上の文字
}

const PALETTE: StoreColor[] = [
  { solid: '#E8590C', soft: '#FFF4E6', text: '#B8440A' }, // オレンジ
  { solid: '#2F9E44', soft: '#EBFBEE', text: '#237A34' }, // 緑
  { solid: '#1C7ED6', soft: '#E7F5FF', text: '#1864AB' }, // 青
  { solid: '#AE3EC9', soft: '#F8F0FC', text: '#862E9C' }, // 紫
  { solid: '#C2255C', soft: '#FFF0F6', text: '#A61E4D' }, // 赤紫
  { solid: '#0C8599', soft: '#E3FAFC', text: '#0B7285' }, // 青緑
]
const NONE: StoreColor = { solid: '#868E96', soft: '#F1F3F5', text: '#495057' }

export function storeColorMap(stores: { id: number }[]): (storeId?: number | null) => StoreColor {
  const order = [...stores].sort((a, b) => a.id - b.id).map(s => s.id)
  return (storeId?: number | null) => {
    const i = storeId ? order.indexOf(storeId) : -1
    return i < 0 ? NONE : PALETTE[i % PALETTE.length]
  }
}
