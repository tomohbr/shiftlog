import { ReactNode } from 'react'
import { InvApi, InvItem, InvMe } from '../../api/client'

// 在庫画面の部品で共有するもの

export interface InvCtx {
  api: InvApi
  me: InvMe & { enabled: true; date: string; stores: { id: number; name: string }[]; items: InvItem[] }
  storeId: number
  date: string
  inLine: boolean
  onSaved: () => void
}

export const fmt = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '–'
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

export const md = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number)
  return `${m}/${dd}（${'日月火水木金土'[new Date(y, m - 1, dd).getDay()]}）`
}

export const hm = (ts: string | null | undefined) => {
  if (!ts) return ''
  // SQLite の CURRENT_TIMESTAMP は UTC。日本時間で出す
  const d = new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`)
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
}

export const errText = (e: any, fallback: string) => e?.response?.data?.error || fallback

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
      {(title || right) && <div className="flex items-center justify-between gap-2">{title && <h3 className="font-bold text-gray-900">{title}</h3>}{right}</div>}
      {children}
    </section>
  )
}

export function Msg({ kind, children }: { kind: 'ok' | 'err' | 'warn' | 'info'; children: ReactNode }) {
  const c = { ok: 'bg-green-50 border-green-200 text-green-900', err: 'bg-red-50 border-red-200 text-red-800', warn: 'bg-amber-50 border-amber-300 text-amber-900', info: 'bg-blue-50 border-blue-200 text-blue-900' }[kind]
  return <div className={`rounded-xl border px-4 py-3 text-sm ${c}`}>{children}</div>
}

/** 数の入力（− と ＋ つき）。step は 1 か 0.5 */
export function Stepper({ value, onChange, step = 1, big }: { value: number | ''; onChange: (v: number | '') => void; step?: number; big?: boolean }) {
  const n = value === '' ? 0 : value
  const btn = `${big ? 'w-12 h-12 text-2xl' : 'w-10 h-10 text-xl'} rounded-xl bg-gray-100 active:bg-gray-200 font-bold text-gray-700 shrink-0`
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={btn} onClick={() => onChange(Math.max(0, Math.round((n - step) * 10) / 10))}>−</button>
      <input
        type="number" inputMode="decimal" min={0} step={step}
        value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
        className={`${big ? 'w-20 h-12 text-xl' : 'w-16 h-10 text-lg'} text-center font-bold tabular-nums rounded-xl border-2 border-gray-300 focus:border-blue-500 outline-none`}
      />
      <button type="button" className={btn} onClick={() => onChange(Math.round((n + step) * 10) / 10)}>＋</button>
    </div>
  )
}

export function ItemSelect({ items, value, onChange }: { items: InvItem[]; value: number | ''; onChange: (id: number | '') => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value ? Number(e.target.value) : '')} className="w-full h-12 rounded-xl border-2 border-gray-300 px-3 text-base bg-white">
      <option value="">品目を選ぶ</option>
      <optgroup label="食材">{items.filter(i => i.category === 'food').map(i => <option key={i.id} value={i.id}>{i.name}（{i.count_unit}）</option>)}</optgroup>
      <optgroup label="容器">{items.filter(i => i.category !== 'food').map(i => <option key={i.id} value={i.id}>{i.name}（{i.count_unit}）</option>)}</optgroup>
    </select>
  )
}
