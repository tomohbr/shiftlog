import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, EyeOff, CalendarDays, List } from 'lucide-react'
import { apiBaseUrl } from '../native/platform'
import type { Shift, Store } from '../api/client'
import TeamCalendar from '../components/TeamCalendar'
import { storeColorMap } from '../lib/storeColors'
import { mergeShifts, MergedShift, PartKind, PART_SHORT } from '../lib/shiftParts'

// 閲覧用リンク（/v/:token）。社長・オーナーなどがログインせずに、いつでもシフト表を見る画面。
// 見るだけ（編集・時給・打刻はなし）。最初は月のカレンダー（ダッシュボードと同じ見た目）。日付を押すとその日の詳しい一覧（誰が何時に入るか）に移る。

const DOW = ['日', '月', '火', '水', '木', '金', '土']
const hm = (t?: string) => (t || '').slice(0, 5)
const dowColor = (dow: number) => (dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-900')
const PART_STYLE: Record<PartKind, { bg: string; fg: string }> = {
  day: { bg: '#FFF4E6', fg: '#C2410C' },
  night: { bg: '#EEF2FF', fg: '#3730A3' },
  all: { bg: '#ECFDF5', fg: '#047857' },
}

interface ViewData {
  company_name: string
  label: string
  year: number
  month: number
  published: boolean
  stores: { id: number; name: string }[]
  shifts: Shift[]
  months: { year: number; month: number }[]
}

function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

export default function ViewSchedulePage({ token }: { token: string }) {
  const today = jstToday()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [month, setMonth] = useState(Number(today.slice(5, 7)))
  const [data, setData] = useState<ViewData | null>(null)
  const [error, setError] = useState('')
  const [storeFilter, setStoreFilter] = useState<number | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [view, setView] = useState<'cal' | 'list'>('cal')
  const [jump, setJump] = useState<string | null>(null)
  const first = useRef(true)
  const reqId = useRef(0)

  const load = useCallback(async (y: number, m: number) => {
    const id = ++reqId.current
    try {
      const res = await fetch(`${apiBaseUrl}/view-links/public/${encodeURIComponent(token)}?year=${y}&month=${m}`)
      const body = await res.json()
      if (id !== reqId.current) return
      if (!res.ok) { setError(body.error || '開けませんでした'); return }
      // 今月がまだ公開されていなければ、最初だけ公開済みのいちばん近い月に寄せる
      if (first.current) {
        first.current = false
        if (!body.published && body.months?.length) {
          const ym = `${y}-${String(m).padStart(2, '0')}`
          const key = (p: { year: number; month: number }) => `${p.year}-${String(p.month).padStart(2, '0')}`
          const next = body.months.find((p: any) => key(p) >= ym) || body.months[body.months.length - 1]
          setYear(next.year); setMonth(next.month); return
        }
      }
      setData(body)
    } catch {
      if (id === reqId.current) setError('通信できませんでした。電波のよいところで開き直してください。')
    }
  }, [token])

  useEffect(() => { load(year, month) }, [load, year, month])
  useEffect(() => { setShowPast(false) }, [year, month])
  useEffect(() => { document.title = 'シフト表（見るだけ）' }, [])
  // カレンダーで押した日へ、一覧を開いて移る
  useEffect(() => {
    if (view !== 'list' || !jump) return
    const el = document.getElementById(`d-${jump}`)
    if (el) { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -8) }
    setJump(null)
  }, [view, jump, showPast])
  const pick = (date: string) => {
    if (date < today) setShowPast(true)
    setView('list'); setJump(date)
  }

  const go = (d: number) => {
    const t = new Date(year, month - 1 + d, 1)
    setYear(t.getFullYear()); setMonth(t.getMonth() + 1)
  }

  if (error) {
    return <div className="min-h-screen flex items-center justify-center px-6 text-center text-gray-700 font-semibold">{error}</div>
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  const colorOf = storeColorMap(data.stores)
  const ord = (s: Shift) => s.user_order ?? 9999
  const merged: MergedShift[] = mergeShifts(data.shifts)
    .filter(s => !storeFilter || s.store_id === storeFilter)
  const dates = [...new Set(merged.map(s => s.date))].sort()
  const pastDates = dates.filter(d => d < today)
  const shown = showPast ? dates : dates.filter(d => d >= today)
  const storeOrder = (id?: number | null) => data.stores.findIndex(st => st.id === id)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className={`${view === 'cal' ? 'max-w-4xl' : 'max-w-xl'} mx-auto px-4 pb-10`}>
        <header className="pt-4 pb-2">
          <p className="text-xs font-semibold text-gray-500">{data.company_name}｜{data.label}用（見るだけ）</p>
          <div className="flex items-center gap-1 mt-1">
            <button onClick={() => go(-1)} aria-label="前の月" className="p-1.5 -ml-2 text-gray-600 rounded-lg active:bg-gray-200"><ChevronLeft className="w-6 h-6" /></button>
            <h1 className="text-xl font-bold text-gray-900 tabular-nums">{year}年{month}月のシフト</h1>
            <button onClick={() => go(1)} aria-label="次の月" className="p-1.5 text-gray-600 rounded-lg active:bg-gray-200"><ChevronRight className="w-6 h-6" /></button>
            <div className="ml-auto flex rounded-lg border border-gray-200 bg-white p-0.5">
              {([['cal', 'カレンダー', CalendarDays], ['list', '日ごと', List]] as const).map(([k, l, Icon]) => (
                <button key={k} onClick={() => setView(k)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-sm font-bold ${view === k ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>
                  <Icon className="w-4 h-4" />{l}
                </button>
              ))}
            </div>
          </div>
        </header>

        {data.stores.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-4 px-4">
            {[{ id: null as number | null, name: '全会場' }, ...data.stores].map(st => {
              const on = storeFilter === st.id
              const c = st.id ? colorOf(st.id) : null
              return (
                <button key={st.id ?? 'all'} onClick={() => setStoreFilter(st.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-bold border ${on ? 'text-white border-transparent' : 'bg-white text-gray-700 border-gray-200'}`}
                  style={on ? { backgroundColor: c ? c.solid : '#111827' } : undefined}>
                  {st.name}
                </button>
              )
            })}
          </div>
        )}

        {!data.published ? (
          <div className="mt-2 rounded-xl bg-white border border-gray-200 p-4 flex items-start gap-3">
            <EyeOff className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-600">{month}月のシフトはまだ公開されていません。</p>
          </div>
        ) : view === 'cal' ? (
          <div className="mt-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <TeamCalendar year={year} month={month} today={today} onPick={pick} maxChips={12}
              stores={data.stores as unknown as Store[]}
              shifts={data.shifts.filter(s => !storeFilter || s.store_id === storeFilter)} />
            <p className="px-4 pb-3 text-xs text-gray-500">日付を押すと、その日の時間が見られます。</p>
          </div>
        ) : (
          <div className="space-y-3 mt-1">
            {pastDates.length > 0 && (
              <button onClick={() => setShowPast(v => !v)} className="w-full py-2 text-sm font-semibold text-gray-500">
                {showPast ? '終わった日を隠す' : `終わった日も見る（${pastDates.length}日）`}
              </button>
            )}
            {shown.map(date => {
              const [y, m, d] = date.split('-').map(Number)
              const dow = new Date(y, m - 1, d).getDay()
              const day = merged.filter(s => s.date === date)
              const groups = [...new Set(day.map(s => s.store_id ?? null))].sort((a, b) => storeOrder(a) - storeOrder(b))
              return (
                <section key={date} id={`d-${date}`} className={`bg-white rounded-xl border overflow-hidden ${date === today ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-200'} ${date < today ? 'opacity-60' : ''}`}>
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                    <span className={`text-lg font-bold ${dowColor(dow)}`}>{m}/{d}（{DOW[dow]}）</span>
                    {date === today && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500 text-white">今日</span>}
                    <span className="ml-auto text-sm text-gray-500">{day.length}人</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {groups.map(g => {
                      const c = colorOf(g)
                      const rows = day.filter(s => (s.store_id ?? null) === g).sort((a, b) => ord(a) - ord(b) || hm(a.start_time).localeCompare(hm(b.start_time)))
                      return (
                        <div key={g ?? 'none'} className="flex">
                          <div className="w-1.5 shrink-0" style={{ backgroundColor: c.solid }} />
                          <div className="flex-1 px-3 py-2.5">
                            <p className="text-sm font-bold mb-1" style={{ color: c.text }}>{rows[0].store_name || '会場なし'}<span className="ml-1 font-normal text-gray-500">{rows.length}人</span></p>
                            {rows.map(s => (
                              <div key={s.id} className="flex items-center justify-between py-1">
                                <span className="text-base text-gray-900">{s.user_name}</span>
                                <span className="flex items-center gap-1.5">
                                  {s.part && (
                                    <span className="rounded-md px-1.5 py-0.5 text-xs font-bold leading-none" style={{ backgroundColor: PART_STYLE[s.part].bg, color: PART_STYLE[s.part].fg }}>{PART_SHORT[s.part]}</span>
                                  )}
                                  <span className="text-base tabular-nums text-gray-700">{hm(s.start_time)}–{hm(s.end_time)}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
            {shown.length === 0 && (
              <p className="text-center py-10 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">この月のこれからのシフトはありません</p>
            )}
          </div>
        )}
        <p className="text-center text-xs text-gray-400 mt-6">このページは見るだけです。いつ開いても最新のシフトが出ます。</p>
      </div>
    </div>
  )
}
