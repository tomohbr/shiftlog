import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, Sun, Moon } from 'lucide-react'
import { api, Store } from '../api/client'
import { storeColorMap } from '../lib/storeColors'

// 人が足りないところ（管理者だけ）。会場の必要人数に対して、入っているスタッフ（社員・管理者は数えない）を重ねて、
//   赤 = その枠に丸ごと足りない
//   黄 = 一部の時間だけ足りない（例: 18時からの人しかいない → 15:30–18:00 が1人足りない）
// 行を押すと、その日のシフト（会場ごとの顔ぶれ）が開く。

interface Gap { from: string; to: string; short: number }
interface Shortage {
  date: string; weekday: number; store_id: number | null; store_name: string
  start_time: string; end_time: string; needed: number; have: number
  kind: 'full' | 'partial'; short: number; gaps: Gap[]
  partial_people: { name: string; start_time: string; end_time: string }[]
}

const DOW = '日月火水木金土'
// 昼の部（午前から）か、夜の部（午後から）か
const isDay = (x: { start_time: string }) => x.start_time < '13:00'
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

export default function ShortagesCard({ stores, venue, reloadKey, onPick }: {
  stores: Store[]; venue: number | null; reloadKey?: unknown; onPick: (date: string) => void
}) {
  const [items, setItems] = useState<Shortage[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  // 仮（下書き）も「入っている」として数えるか。下書きがあるときは最初から含めて見せる
  const [withDraft, setWithDraft] = useState(true)
  const [draftCount, setDraftCount] = useState(0)
  const colorOf = storeColorMap(stores)

  useEffect(() => {
    api.get<{ shortages: Shortage[]; draft_count?: number }>('/venue-schedule/shortages', { params: withDraft ? { with_draft: '1' } : {} })
      .then(r => { setItems(r.data.shortages || []); if (withDraft) setDraftCount(r.data.draft_count || 0) })
      .catch(() => setItems([]))
  }, [reloadKey, withDraft])

  if (!items) return null
  const list = items.filter(x => !venue || x.store_id === venue)
  const dates = [...new Set(list.map(x => x.date))]
  const shownDates = showAll ? dates : dates.slice(0, 8)
  const totalShort = list.reduce((a, x) => a + (x.kind === 'full' ? x.short : 0), 0)
  const partialCount = list.filter(x => x.kind === 'partial').length

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 sm:px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-base font-bold text-gray-900 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-red-500" />人が足りないところ
        </h3>
        {list.length === 0
          ? <span className="text-sm text-green-700 font-bold">これから先は全部埋まっています</span>
          : <span className="text-sm text-gray-600">
              <span className="font-bold text-red-600">あと {totalShort}人</span>
              {partialCount > 0 && <>・<span className="font-bold text-amber-600">一部だけ {partialCount}枠</span></>}
              <span className="text-gray-400">（{list.length - partialCount}枠・{dates.length}日）</span>
            </span>}
        {draftCount > 0 && (
          <span className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-bold">
            <button onClick={() => setWithDraft(true)} className={`px-2.5 py-1 ${withDraft ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>仮も入れて計算</button>
            <button onClick={() => setWithDraft(false)} className={`px-2.5 py-1 ${!withDraft ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>確定だけ</button>
          </span>
        )}
        <span className="ml-auto text-xs text-gray-400">管理者だけに表示</span>
      </div>
      {list.length > 0 && (
        <div className="divide-y divide-gray-100">
          {shownDates.map(date => {
            // 昼の部を上、夜の部を下に（同じ部の中は会場順）
            const rows = list.filter(x => x.date === date).sort((a, b) => (isDay(a) === isDay(b) ? 0 : isDay(a) ? -1 : 1) || (a.store_id ?? 0) - (b.store_id ?? 0))
            const dow = rows[0].weekday
            return (
              <button key={date} onClick={() => onPick(date)} className="w-full text-left px-4 sm:px-6 py-2.5 flex gap-3 hover:bg-gray-50">
                <span className={`w-16 shrink-0 font-bold tabular-nums ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-900'}`}>
                  {md(date)}<span className="text-xs ml-0.5">({DOW[dow]})</span>
                </span>
                <span className="flex-1 min-w-0 space-y-1.5">
                  {rows.map((x, i) => {
                    const c = colorOf(x.store_id)
                    return (
                      <span key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {isDay(x)
                          ? <span className="inline-flex items-center gap-0.5 w-12 justify-center rounded-md py-0.5 text-xs font-bold bg-amber-100 text-amber-800"><Sun className="w-3.5 h-3.5" />昼</span>
                          : <span className="inline-flex items-center gap-0.5 w-12 justify-center rounded-md py-0.5 text-xs font-bold bg-indigo-100 text-indigo-800"><Moon className="w-3.5 h-3.5" />夜</span>}
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: c.soft, color: c.text }}>{x.store_name || '店舗'}</span>
                        {x.kind === 'full' ? (
                          <>
                            <span className="text-sm tabular-nums text-gray-700">{x.start_time}–{x.end_time}</span>
                            <span className="rounded-md px-1.5 py-0.5 text-xs font-bold bg-red-100 text-red-700">{x.short}人足りない</span>
                          </>
                        ) : (
                          <>
                            {x.gaps.map((g, j) => (
                              <span key={j} className="rounded-md px-1.5 py-0.5 text-xs font-bold bg-amber-100 text-amber-800 tabular-nums">{g.from}–{g.to} {g.short}人</span>
                            ))}
                            {x.partial_people.length > 0 && (
                              <span className="text-xs text-gray-500">
                                {x.partial_people.map(p => p.start_time > x.start_time ? `${p.name} ${p.start_time}〜` : `${p.name} 〜${p.end_time}`).join('、')}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    )
                  })}
                </span>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0 self-center" />
              </button>
            )
          })}
        </div>
      )}
      {dates.length > 8 && (
        <button onClick={() => setShowAll(v => !v)} className="w-full py-2 text-sm font-semibold text-gray-500 border-t border-gray-100">
          {showAll ? '閉じる' : `あと${dates.length - 8}日を見る`}
        </button>
      )}
    </div>
  )
}
