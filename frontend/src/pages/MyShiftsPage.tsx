import { useState, useEffect, useCallback, useRef } from 'react'
import { venueWord } from '../lib/terms'
import { ChevronLeft, ChevronRight, EyeOff, MapPin, Users, List, CalendarDays } from 'lucide-react'
import { shiftsApi, storesApi, Shift, Store } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'
import LineLinkCard from '../components/LineLinkCard'
import { storeColorMap, StoreColor } from '../lib/storeColors'

// スタッフの「シフト」画面。スマホで LINE から開かれる前提。
// 基本はカレンダー（月全体が一目で分かる）。日付を押すと、その日の詳細（時間・会場・一緒に入る人）が下に出る。
//   自分の予定 … 自分の勤務日を会場の色で塗り、時間を書く。最初は「次の勤務」の日を選んだ状態で開く
//   みんなの予定 … 各日に会場の色ごとの人数。押すとその日の会場別の顔ぶれ
// 一覧（リスト）にも切り替えられる。会場は色＋会場名で表す（lib/storeColors。管理画面と同じ色）

const DOW = ['日', '月', '火', '水', '木', '金', '土']
const VIEW_KEY = 'shiftlog:myShiftsView'

function fmtDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return { y, m, d, dow, dowLabel: DOW[dow] }
}

const dowColor = (dow: number) => (dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-900')
const hm = (t?: string) => (t || '').slice(0, 5)
// カレンダーのラベル用の短い時刻（10:00 → 10、09:30 → 9:30）
const compact = (t?: string) => {
  const [h, m] = hm(t).split(':')
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`
}
// カレンダーのラベル用の短い名前（「山田 花子」→「山田」。同じ名字が複数いれば「山田花」）
const surname = (name?: string) => (name || '').split(/[\s　（(]/)[0].slice(0, 4)
const givenInitial = (name?: string) => ((name || '').split(/[\s　]/)[1] || '').slice(0, 1)

function shiftMinutes(s: Shift): number {
  if (!s.start_time || !s.end_time) return 0
  const [sh, sm] = s.start_time.split(':').map(Number)
  const [eh, em] = s.end_time.split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60 // 日跨ぎシフト
  return mins
}

function readView(): 'calendar' | 'list' {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'calendar' } catch { return 'calendar' }
}

function VenuePill({ name, color, size = 'md' }: { name?: string | null; color: StoreColor; size?: 'md' | 'lg' }) {
  if (!name) return null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold ${size === 'lg' ? 'px-3 py-1 text-base' : 'px-2.5 py-0.5 text-sm'}`}
      style={{ backgroundColor: color.soft, color: color.text }}
    >
      <MapPin className={size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
      {name}
    </span>
  )
}

export default function MyShiftsPage() {
  const { user, selectedCompany } = useAuth()
  const vw = venueWord(selectedCompany)
  const now = new Date()
  const todayStr = fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const tomorrowStr = fmtDate(tomorrow.getFullYear(), tomorrow.getMonth() + 1, tomorrow.getDate())

  // LINE のカードから来たときは ?year=&month= の月を開く
  const qs = new URLSearchParams(window.location.search)
  const qYear = Number(qs.get('year')), qMonth = Number(qs.get('month'))
  const fromLink = qYear >= 2000 && qMonth >= 1 && qMonth <= 12
  const [year, setYear] = useState(fromLink ? qYear : now.getFullYear())
  const [month, setMonth] = useState(fromLink ? qMonth : now.getMonth() + 1)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [isPublished, setIsPublished] = useState(true)
  const [loading, setLoading] = useState(true)
  const [stores, setStores] = useState<Store[]>([])
  const [who, setWho] = useState<'me' | 'all'>('me')
  const [storeFilter, setStoreFilter] = useState<number | null>(null)
  const [view, setViewState] = useState<'calendar' | 'list'>(readView)
  const [showPast, setShowPast] = useState(false)
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const reqId = useRef(0)

  const setView = (v: 'calendar' | 'list') => {
    setViewState(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* 保存できなくても表示は切り替わる */ }
  }

  const loadData = useCallback(async () => {
    // 月を続けて送ったとき、古い月の応答が後から来て上書きしないようにする
    const id = ++reqId.current
    setLoading(true)
    try {
      const [shiftsRes, pubRes, storesRes] = await Promise.all([
        shiftsApi.getAll({ year, month, scope: 'all' }),
        shiftsApi.getPublication(year, month),
        storesApi.getAll().catch(() => null),
      ])
      if (id !== reqId.current) return
      setShifts(shiftsRes.data.shifts || [])
      setIsPublished(pubRes.data.publication?.is_published === 1)
      setStores(storesRes?.data.stores || [])
    } catch {
      if (id === reqId.current) toast.error('シフトの取得に失敗しました')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [year, month])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { setPickedDate(null); setShowPast(false) }, [year, month])

  const goPrev = () => { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  const goNext = () => { if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1) }
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1) }
  const isThisMonth = year === now.getFullYear() && month === now.getMonth() + 1

  const multiStore = stores.length > 1
  const colorOf = storeColorMap(stores)
  const sortedStores = [...stores].sort((a, b) => a.id - b.id)
  const inStore = (s: Shift) => !storeFilter || s.store_id === storeFilter
  const byTime = (a: Shift, b: Shift) => a.date.localeCompare(b.date) || hm(a.start_time).localeCompare(hm(b.start_time))
  const barColor = (s: Shift) => (s.store_id ? colorOf(s.store_id) : { solid: '#2563EB', soft: '#EFF6FF', text: '#1D4ED8' })

  // 公開済みの月だけ見せる（下書きを見せると混乱するため）
  const published = isPublished ? shifts : []
  const mine = published.filter(s => s.user_id === user?.id).sort(byTime)
  const myVisible = mine.filter(inStore)
  const allVisible = published.filter(inStore).sort(byTime)
  const nextShift = myVisible.find(s => s.date >= todayStr) || null

  // 同じ日・同じ会場に入る自分以外の人
  const coworkers = (s: Shift) =>
    published
      .filter(o => o.date === s.date && o.user_id !== s.user_id && (o.store_id ?? null) === (s.store_id ?? null))
      .sort(byTime)

  // 同じ名字の人が2人以上いるときだけ、名前の1文字目を足す
  const surnameCount = new Map<string, Set<number>>()
  for (const x of published) {
    const k = surname(x.user_name)
    if (!surnameCount.has(k)) surnameCount.set(k, new Set())
    surnameCount.get(k)!.add(x.user_id)
  }
  const shortName = (name?: string) => {
    const k = surname(name)
    return (surnameCount.get(k)?.size || 0) > 1 ? `${k}${givenInitial(name)}` : k
  }

  const workDays = new Set(myVisible.map(s => s.date)).size
  const totalHours = myVisible.reduce((sum, s) => sum + shiftMinutes(s), 0) / 60
  const storeName = storeFilter ? stores.find(st => st.id === storeFilter)?.name : null


  // ---------- 部品 ----------

  const dayLabelBadge = (date: string) =>
    date === todayStr ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500 text-white">今日</span>
      : date === tomorrowStr ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-800 text-white">明日</span>
      : null

  const ShiftCard = ({ s, showDate = true }: { s: Shift; showDate?: boolean }) => {
    const p = parts(s.date)
    const c = barColor(s)
    const mates = coworkers(s)
    const past = s.date < todayStr
    return (
      <div className={`flex bg-white rounded-xl border border-gray-200 overflow-hidden ${past ? 'opacity-50' : ''}`}>
        <div className="w-1.5 shrink-0" style={{ backgroundColor: c.solid }} />
        {showDate && (
          <div className="w-16 shrink-0 flex flex-col items-center justify-center py-3 border-r border-gray-100">
            <span className="text-xs text-gray-500">{p.m}月</span>
            <span className={`text-2xl font-bold leading-none ${dowColor(p.dow)}`}>{p.d}</span>
            <span className={`text-xs font-semibold mt-0.5 ${dowColor(p.dow)}`}>{p.dowLabel}</span>
          </div>
        )}
        <div className="flex-1 min-w-0 px-3 py-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xl font-bold text-gray-900 tabular-nums">{hm(s.start_time)}<span className="text-gray-400 mx-1">–</span>{hm(s.end_time)}</span>
            {showDate && dayLabelBadge(s.date)}
          </div>
          <VenuePill name={s.store_name} color={c} />
          {mates.length > 0 && (
            <p className="text-sm text-gray-600 flex items-start gap-1">
              <Users className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
              <span>{mates.map(o => `${o.user_name}（${hm(o.start_time)}〜）`).join('、')}</span>
            </p>
          )}
        </div>
      </div>
    )
  }

  // その日の顔ぶれ（会場ごと）
  const DayLineup = ({ date }: { date: string }) => {
    const day = allVisible.filter(s => s.date === date)
    const groups = [...sortedStores.map(st => ({ id: st.id as number | null, name: st.name })), { id: null, name: '' }]
      .map(g => ({ ...g, rows: day.filter(s => (s.store_id ?? null) === g.id) }))
      .filter(g => g.rows.length > 0)
    if (groups.length === 0) return <p className="text-center text-sm text-gray-400 py-4">この日は誰も入っていません</p>
    return (
      <div className="divide-y divide-gray-100">
        {groups.map(g => {
          const c = g.id ? colorOf(g.id) : barColor(g.rows[0])
          return (
            <div key={g.id ?? 'none'} className="flex">
              <div className="w-1.5 shrink-0" style={{ backgroundColor: c.solid }} />
              <div className="flex-1 px-3 py-2.5">
                {g.name && <p className="text-sm font-bold mb-1" style={{ color: c.text }}>{g.name}<span className="ml-1 font-normal text-gray-500">{g.rows.length}人</span></p>}
                {g.rows.map(s => {
                  const me = s.user_id === user?.id
                  return (
                    <div key={s.id} className={`flex items-center justify-between py-1 ${me ? 'font-bold' : ''}`}>
                      <span className="text-base text-gray-900 flex items-center gap-1.5">
                        {s.user_name}
                        {me && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-600 text-white">あなた</span>}
                      </span>
                      <span className="text-base tabular-nums text-gray-700">{hm(s.start_time)}–{hm(s.end_time)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ---------- 画面 ----------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const daysInMonth = new Date(year, month, 0).getDate()
  const upcomingMine = myVisible.filter(s => s.date >= todayStr)
  const pastMine = myVisible.filter(s => s.date < todayStr)
  const allDates = [...new Set(allVisible.map(s => s.date))].sort()
  const pastDates = allDates.filter(d => d < todayStr)
  const shownDates = showPast ? allDates : allDates.filter(d => d >= todayStr)

  // ---- カレンダー（TimeTree 風: 月曜はじまり、マスの中に色付きラベルを積む。予定が多い日はマスが伸びる）----
  const WEEK = ['月', '火', '水', '木', '金', '土', '日']
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7 // 月曜はじまりで前月の日を何日出すか
  const cells: { date: string; inMonth: boolean }[] = []
  for (let i = lead; i > 0; i--) {
    const d = new Date(year, month - 1, 1 - i)
    cells.push({ date: fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate()), inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: fmtDate(year, month, d), inMonth: true })
  while (cells.length % 7 !== 0) {
    const d = new Date(year, month - 1, daysInMonth + (cells.length - lead - daysInMonth) + 1)
    cells.push({ date: fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate()), inMonth: false })
  }
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
  const MAX_CHIPS = 5

  const chip = (key: string | number, text: string, bg: string, opts: { fg?: string; mine?: boolean; title?: string } = {}) => (
    <span
      key={key}
      title={opts.title}
      className={`block mx-[2px] mt-[3px] rounded-[5px] px-0.5 text-[12.5px] leading-[22px] font-bold text-center truncate ${opts.mine ? 'ring-[2.5px] ring-gray-900 ring-inset' : ''}`}
      style={{ backgroundColor: bg, color: opts.fg || '#fff' }}
    >
      {text}
    </span>
  )

  const calendar = (
    <div className="-mx-4 sm:mx-0 bg-white sm:rounded-xl sm:border sm:border-gray-200 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-200">
        {WEEK.map((l, i) => (
          <div key={l} className={`text-center text-xs font-semibold py-1.5 ${i === 5 ? 'text-blue-500' : i === 6 ? 'text-red-500' : 'text-gray-500'}`}>{l}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-gray-200 last:border-b-0"
          style={{ minHeight: `max(88px, calc((100dvh - 250px) / ${weeks.length}))` }}>
          {week.map(({ date, inMonth }, di) => {
            const p = parts(date)
            const isToday = date === todayStr
            const numColor = !inMonth ? 'text-gray-300' : di === 5 ? 'text-blue-500' : di === 6 ? 'text-red-500' : 'text-gray-800'
            const items = inMonth ? (who === 'me' ? myVisible : allVisible).filter(x => x.date === date) : []
            // みんな: 会場順→時間順に並べる
            if (who === 'all') items.sort((a, b) => sortedStores.findIndex(st => st.id === a.store_id) - sortedStores.findIndex(st => st.id === b.store_id) || hm(a.start_time).localeCompare(hm(b.start_time)))
            return (
              <button
                key={date}
                disabled={!inMonth}
                onClick={() => setPickedDate(date)}
                className={`pb-1 flex flex-col justify-start items-stretch text-left border-r border-gray-100 last:border-r-0 ${pickedDate === date ? 'bg-blue-50' : ''}`}
              >
                <div className="flex justify-center pt-1 pb-0.5">
                  <span className={`text-[13px] font-semibold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-red-500 text-white' : numColor}`}>{p.d}</span>
                </div>
                {who === 'me'
                  ? items.map(s => (
                      // 1つの濃いラベルに会場名と時間を2行で
                      <span key={s.id} className="block mx-[2px] mt-[3px] rounded-[5px] px-0.5 py-1 text-center text-white font-bold leading-tight"
                        style={{ backgroundColor: barColor(s).solid }} title={s.store_name || undefined}>
                        <span className="block text-[12.5px] truncate">{s.store_name || '勤務'}</span>
                        {(() => {
                          // 1行に収まる長さなら1行、分つきで長い（9:30-17:30 など）ときは開始と終了を2行に分ける（途中で切れないように）
                          const t = `${compact(s.start_time)}-${compact(s.end_time)}`
                          return t.length <= 7
                            ? <span className={`block tabular-nums whitespace-nowrap tracking-tight ${t.length === 7 ? 'text-[11px]' : 'text-[12px]'}`}>{t}</span>
                            : <span className="block tabular-nums whitespace-nowrap text-[11.5px] leading-[1.2]">{compact(s.start_time)}<br />-{compact(s.end_time)}</span>
                        })()}
                      </span>
                    ))
                  : <>
                      {items.slice(0, MAX_CHIPS).map(s => chip(s.id, shortName(s.user_name), barColor(s).solid, { mine: s.user_id === user?.id, title: `${s.user_name} ${hm(s.start_time)}–${hm(s.end_time)}` }))}
                      {items.length > MAX_CHIPS && <span className="block text-center text-[11px] font-bold text-gray-500 mt-0.5">+{items.length - MAX_CHIPS}</span>}
                    </>}
              </button>
            )
          })}
        </div>
      ))}
      {multiStore && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 border-t border-gray-100 text-xs text-gray-600">
          {sortedStores.map(st => (
            <span key={st.id} className="inline-flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colorOf(st.id).solid }} />{st.name}
            </span>
          ))}
          {who === 'all' && <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm ring-2 ring-gray-900 ring-inset" />自分</span>}
        </div>
      )}
    </div>
  )

  // 日付を押したときに下から出る詳細
  const daySheet = pickedDate && (() => {
    const p = parts(pickedDate)
    const isNext = who === 'me' && nextShift?.date === pickedDate
    const myDay = myVisible.filter(s => s.date === pickedDate)
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setPickedDate(null)}>
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative w-full sm:max-w-md bg-gray-50 rounded-t-2xl sm:rounded-2xl max-h-[80vh] overflow-y-auto pb-6" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 bg-gray-50 px-4 pt-3 pb-2">
            <div className="mx-auto w-10 h-1.5 rounded-full bg-gray-300 mb-3 sm:hidden" />
            <div className="flex items-center gap-2">
              <span className={`text-xl font-bold ${dowColor(p.dow)}`}>{p.m}月{p.d}日（{p.dowLabel}）</span>
              {dayLabelBadge(pickedDate)}
              {isNext && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">次の勤務</span>}
              <button onClick={() => setPickedDate(null)} className="ml-auto px-3 py-1.5 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg">閉じる</button>
            </div>
          </div>
          <div className="px-4 space-y-2">
            {who === 'me' ? (
              myDay.length > 0
                ? myDay.map(s => <ShiftCard key={s.id} s={s} showDate={false} />)
                : <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 py-6 text-center">この日は勤務がありません</p>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden"><DayLineup date={pickedDate} /></div>
            )}
          </div>
        </div>
      </div>
    )
  })()

  // 次の勤務（1行。押すとその日の詳細）
  const nextBar = who === 'me' && nextShift && (() => {
    const p = parts(nextShift.date)
    const c = barColor(nextShift)
    return (
      <button onClick={() => setPickedDate(nextShift.date)} className="w-full flex items-center gap-3 bg-white rounded-xl border border-gray-200 px-3 py-2.5 text-left">
        <span className="w-1.5 self-stretch rounded-full" style={{ backgroundColor: c.solid }} />
        <span className="text-xs font-bold text-gray-500 shrink-0">次の勤務</span>
        <span className="min-w-0 flex-1">
          <span className={`font-bold ${dowColor(p.dow)}`}>{p.m}/{p.d}（{p.dowLabel}）</span>
          <span className="ml-1.5 font-bold text-gray-900 tabular-nums">{hm(nextShift.start_time)}–{hm(nextShift.end_time)}</span>
          {nextShift.store_name && <span className="ml-1.5 text-sm font-bold" style={{ color: c.text }}>{nextShift.store_name}</span>}
        </span>
        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
      </button>
    )
  })()

  return (
    <div className="space-y-2.5 max-w-xl mx-auto">
      {/* 上の操作は2段に詰める（カレンダーを画面いっぱいに見せるため） */}
      <div className="flex items-center gap-1">
        <button onClick={goPrev} aria-label="前の月" className="p-1.5 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 className="text-xl font-bold text-gray-900 tabular-nums">{year}年{month}月</h2>
        <button onClick={goNext} aria-label="次の月" className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg">
          <ChevronRight className="w-6 h-6" />
        </button>
        {!isThisMonth && (
          <button onClick={goToday} className="text-xs font-semibold text-blue-600 px-2 py-1 rounded-md bg-blue-50">今月</button>
        )}
        <div className="ml-auto grid grid-cols-2 p-0.5 bg-gray-100 rounded-lg shrink-0">
          {(['me', 'all'] as const).map(w => (
            <button
              key={w}
              onClick={() => { setWho(w); setPickedDate(null) }}
              className={`px-3 py-1.5 rounded-md text-sm font-bold ${who === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >
              {w === 'me' ? '自分' : 'みんな'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {multiStore && (
          <select
            value={storeFilter ?? ''}
            onChange={e => setStoreFilter(e.target.value ? Number(e.target.value) : null)}
            className="text-sm font-bold border border-gray-200 rounded-lg pl-2 pr-7 py-1.5 bg-white"
            style={storeFilter ? { color: colorOf(storeFilter).text, borderColor: colorOf(storeFilter).solid } : undefined}
          >
            <option value="">全{vw}</option>
            {sortedStores.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
        )}
        {isPublished && who === 'me' && (
          <p className="text-sm text-gray-600 whitespace-nowrap truncate">
            <span className="font-bold text-gray-900">{workDays}日</span>・
            <span className="font-bold text-gray-900">{totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}時間</span>
          </p>
        )}
        <div className="ml-auto inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
          {([['calendar', CalendarDays, 'カレンダー'], ['list', List, 'リスト']] as const).map(([v, Icon, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-label={label}
              title={label}
              className={`px-2.5 py-1.5 flex items-center ${view === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
            >
              <Icon className="w-5 h-5" />
            </button>
          ))}
        </div>
      </div>

      {!isPublished ? (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex items-start gap-3">
          <EyeOff className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-600">
            {month}月のシフトはまだ公開されていません。公開されたらLINEでお知らせします。
          </p>
        </div>
      ) : (
        <>
          {view === 'calendar' ? (
            <>
              {calendar}
              {nextBar}
              {daySheet}
            </>
          ) : who === 'me' ? (
            <div className="space-y-2">
              {upcomingMine.map(s => <ShiftCard key={s.id} s={s} />)}
              {upcomingMine.length === 0 && (
                <div className="text-center py-10 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
                  {month}月のこれからの勤務は{storeName ? `${storeName}に` : ''}ありません
                </div>
              )}
              {pastMine.length > 0 && (
                <>
                  <button onClick={() => setShowPast(v => !v)} className="w-full py-2 text-sm font-semibold text-gray-500">
                    {showPast ? '終わった勤務を隠す' : `終わった勤務を見る（${pastMine.length}件）`}
                  </button>
                  {showPast && pastMine.map(s => <ShiftCard key={s.id} s={s} />)}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {shownDates.map(date => {
                const p = parts(date)
                return (
                  <section key={date} className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${date < todayStr ? 'opacity-50' : ''}`}>
                    <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                      <span className={`text-lg font-bold ${dowColor(p.dow)}`}>{p.m}/{p.d}（{p.dowLabel}）</span>
                      {dayLabelBadge(date)}
                    </div>
                    <DayLineup date={date} />
                  </section>
                )
              })}
              {shownDates.length === 0 && (
                <div className="text-center py-10 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
                  {month}月のこれからのシフトは{storeName ? `${storeName}に` : ''}ありません
                </div>
              )}
              {pastDates.length > 0 && (
                <button onClick={() => setShowPast(v => !v)} className="w-full py-2 text-sm font-semibold text-gray-500">
                  {showPast ? '終わった日を隠す' : `終わった日も見る（${pastDates.length}日）`}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* LINE連携の案内は下に（毎回見る情報ではないため） */}
      <LineLinkCard />
    </div>
  )
}
