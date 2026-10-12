import { Shift, Store } from '../api/client'
import { storeColorMap } from '../lib/storeColors'

// 管理者向けの月カレンダー（スタッフの「みんなの予定」と同じ見た目）。
// 月曜はじまり・マスの中に名前ラベルを会場の色で積む。予定が多い日はマスが伸びる。

const WEEK = ['月', '火', '水', '木', '金', '土', '日']
const fmt = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const surname = (n?: string) => (n || '').split(/[\s　（(]/)[0].slice(0, 4)
const given1 = (n?: string) => ((n || '').split(/[\s　]/)[1] || '').slice(0, 1)

export default function TeamCalendar({ year, month, shifts, stores, today, onPick, maxChips = 6 }: {
  year: number
  month: number
  shifts: Shift[]
  stores: Store[]
  today: string
  onPick: (date: string) => void
  maxChips?: number
}) {
  const colorOf = storeColorMap(stores)
  const sorted = [...stores].sort((a, b) => a.id - b.id)
  const storeIdx = (id?: number | null) => { const i = sorted.findIndex(s => s.id === id); return i < 0 ? 99 : i }

  // 同じ名字が複数いるときだけ名前の1文字目を足す
  const byName = new Map<string, Set<number>>()
  for (const s of shifts) {
    const k = surname(s.user_name)
    if (!byName.has(k)) byName.set(k, new Set())
    byName.get(k)!.add(s.user_id)
  }
  const label = (n?: string) => ((byName.get(surname(n))?.size || 0) > 1 ? `${surname(n)}${given1(n)}` : surname(n))

  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const cells: { date: string; inMonth: boolean }[] = []
  for (let i = lead; i > 0; i--) {
    const d = new Date(year, month - 1, 1 - i)
    cells.push({ date: fmt(d.getFullYear(), d.getMonth() + 1, d.getDate()), inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: fmt(year, month, d), inMonth: true })
  while (cells.length % 7) {
    const d = new Date(year, month - 1, daysInMonth + (cells.length - lead - daysInMonth) + 1)
    cells.push({ date: fmt(d.getFullYear(), d.getMonth() + 1, d.getDate()), inMonth: false })
  }

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-gray-200">
        {WEEK.map((l, i) => (
          <div key={l} className={`text-center text-xs font-semibold py-2 ${i === 5 ? 'text-blue-500' : i === 6 ? 'text-red-500' : 'text-gray-500'}`}>{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map(({ date, inMonth }, i) => {
          const col = i % 7
          const day = inMonth ? shifts.filter(s => s.date === date)
            .sort((a, b) => storeIdx(a.store_id) - storeIdx(b.store_id) || a.start_time.localeCompare(b.start_time)) : []
          const people = new Set(day.map(s => s.user_id)).size
          return (
            <button
              key={date}
              disabled={!inMonth}
              onClick={() => onPick(date)}
              className={`min-h-[110px] pb-1.5 flex flex-col items-stretch text-left border-b border-r border-gray-100 ${inMonth ? 'hover:bg-blue-50/40' : 'bg-gray-50/60'}`}
            >
              <div className="flex items-center justify-between px-1.5 pt-1">
                <span className={`text-[13px] font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                  date === today ? 'bg-red-500 text-white' : !inMonth ? 'text-gray-300' : col === 5 ? 'text-blue-500' : col === 6 ? 'text-red-500' : 'text-gray-800'
                }`}>{Number(date.slice(8))}</span>
                {people > 0 && <span className="text-[11px] text-gray-400">{people}人</span>}
              </div>
              {day.slice(0, maxChips).map(s => (
                <span
                  key={s.id}
                  title={`${s.user_name} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}${s.store_name ? ` ${s.store_name}` : ''}`}
                  className="mx-1 mt-[3px] rounded-[5px] px-1 text-[12px] leading-[21px] font-bold text-white flex items-center justify-between gap-1 overflow-hidden"
                  style={{ backgroundColor: s.store_id ? colorOf(s.store_id).solid : '#4C6EF5' }}
                >
                  <span className="truncate">{label(s.user_name)}</span>
                  <span className="text-[10px] font-semibold opacity-90 tabular-nums shrink-0 hidden xl:inline">{s.start_time.slice(0, 5).replace(/^0/, '')}</span>
                </span>
              ))}
              {day.length > maxChips && <span className="text-center text-[11px] font-bold text-gray-500 mt-0.5">+{day.length - maxChips}</span>}
            </button>
          )
        })}
      </div>
      {stores.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-gray-600">
          {sorted.map(st => (
            <span key={st.id} className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colorOf(st.id).solid }} />{st.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
