import { useState, useEffect, useCallback, useRef } from 'react'
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
// カレンダーのマス用の時刻（09:30 → 9:30）
const short = (t?: string) => {
  const [h, m] = hm(t).split(':')
  return `${Number(h)}:${m}`
}

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
  const { user } = useAuth()
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

  const workDays = new Set(myVisible.map(s => s.date)).size
  const totalHours = myVisible.reduce((sum, s) => sum + shiftMinutes(s), 0) / 60
  const storeName = storeFilter ? stores.find(st => st.id === storeFilter)?.name : null

  // カレンダーで最初に選んでおく日: 自分=次の勤務の日、みんな=今日（今月なら）か最初に人がいる日
  const defaultPicked = who === 'me'
    ? nextShift?.date || null
    : (isThisMonth ? todayStr : allVisible[0]?.date || null)
  const selected = pickedDate ?? defaultPicked

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
  const firstDow = new Date(year, month - 1, 1).getDay()
  const upcomingMine = myVisible.filter(s => s.date >= todayStr)
  const pastMine = myVisible.filter(s => s.date < todayStr)
  const allDates = [...new Set(allVisible.map(s => s.date))].sort()
  const pastDates = allDates.filter(d => d < todayStr)
  const shownDates = showPast ? allDates : allDates.filter(d => d >= todayStr)

  const calendar = (
    <div className="bg-white rounded-xl border border-gray-200 p-2.5">
      <div className="grid grid-cols-7 mb-1">
        {DOW.map((l, i) => (
          <div key={l} className={`text-center text-xs font-bold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDow }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = fmtDate(year, month, i + 1)
          const dow = (firstDow + i) % 7
          const isSel = selected === date
          const isToday = date === todayStr
          const past = date < todayStr
          const numColor = dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'

          if (who === 'me') {
            const s = myVisible.find(x => x.date === date)
            const c = s ? barColor(s) : null
            return (
              <button
                key={date}
                onClick={() => setPickedDate(date)}
                className={`h-[60px] rounded-lg flex flex-col items-center pt-1 relative overflow-hidden ${isSel ? 'ring-2 ring-gray-900' : isToday ? 'ring-2 ring-red-500' : ''} ${past && !isSel ? 'opacity-50' : ''}`}
                style={{ backgroundColor: c ? c.soft : '#F8F9FA' }}
              >
                <span className={`text-sm font-bold leading-tight ${isToday ? 'bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center' : numColor}`}>{i + 1}</span>
                {s && (
                  <span className="text-[11px] tabular-nums leading-[1.15] mt-0.5 text-center" style={{ color: c!.text }}>
                    <span className="block font-bold">{short(s.start_time)}</span>
                    <span className="block">{short(s.end_time)}</span>
                  </span>
                )}
                {s && <span className="absolute bottom-0 inset-x-0 h-1.5" style={{ backgroundColor: c!.solid }} />}
              </button>
            )
          }

          // みんな: 会場ごとの人数を色付きで（自分が入っている日は青い点）
          const day = allVisible.filter(x => x.date === date)
          const perStore = [...sortedStores.map(st => st.id as number | null), null]
            .map(id => ({ id, n: new Set(day.filter(x => (x.store_id ?? null) === id).map(x => x.user_id)).size }))
            .filter(g => g.n > 0)
          const iWork = day.some(x => x.user_id === user?.id)
          return (
            <button
              key={date}
              onClick={() => setPickedDate(date)}
              className={`h-[60px] rounded-lg flex flex-col items-center pt-1 relative bg-gray-50 ${isSel ? 'ring-2 ring-gray-900' : isToday ? 'ring-2 ring-red-500' : ''} ${past && !isSel ? 'opacity-50' : ''}`}
            >
              <span className={`text-sm font-bold leading-tight ${isToday ? 'bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center' : numColor}`}>{i + 1}</span>
              {iWork && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-600" />}
              <div className="flex flex-wrap justify-center gap-0.5 mt-0.5 px-0.5">
                {perStore.map(g => (
                  <span key={g.id ?? 'none'} className="min-w-[16px] h-4 px-1 rounded text-[10px] font-bold text-white leading-4 text-center"
                    style={{ backgroundColor: g.id ? colorOf(g.id).solid : '#868E96' }}>
                    {g.n}
                  </span>
                ))}
              </div>
            </button>
          )
        })}
      </div>
      {(multiStore || who === 'all') && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 px-1 text-xs text-gray-600">
          {multiStore && sortedStores.map(st => (
            <span key={st.id} className="inline-flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colorOf(st.id).solid }} />{st.name}
            </span>
          ))}
          {who === 'all' && (
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600" />自分が入る日</span>
          )}
        </div>
      )}
    </div>
  )

  // 選んだ日の詳細（カレンダーの下）
  const selectedDetail = selected && (() => {
    const p = parts(selected)
    const isNext = who === 'me' && nextShift?.date === selected
    const myDay = myVisible.filter(s => s.date === selected)
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <span className={`text-lg font-bold ${dowColor(p.dow)}`}>{p.m}月{p.d}日（{p.dowLabel}）</span>
          {dayLabelBadge(selected)}
          {isNext && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">次の勤務</span>}
        </div>
        {who === 'me' ? (
          myDay.length > 0
            ? myDay.map(s => <ShiftCard key={s.id} s={s} showDate={false} />)
            : <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 py-4 text-center">この日は勤務がありません</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden"><DayLineup date={selected} /></div>
        )}
      </div>
    )
  })()

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      {/* 月の切り替え */}
      <div className="flex items-center justify-between">
        <button onClick={goPrev} aria-label="前の月" className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-gray-900">{year}年{month}月</h2>
          {!isThisMonth && (
            <button onClick={goToday} className="text-xs font-semibold text-blue-600 px-2 py-1 rounded-md bg-blue-50">今月へ</button>
          )}
        </div>
        <button onClick={goNext} aria-label="次の月" className="p-2 -mr-2 text-gray-600 hover:bg-gray-100 rounded-lg">
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      {/* 自分／みんな */}
      <div className="grid grid-cols-2 p-1 bg-gray-100 rounded-xl">
        {(['me', 'all'] as const).map(w => (
          <button
            key={w}
            onClick={() => { setWho(w); setPickedDate(null) }}
            className={`py-2.5 rounded-lg text-base font-bold transition-colors ${who === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            {w === 'me' ? '自分の予定' : 'みんなの予定'}
          </button>
        ))}
      </div>

      {/* 会場の絞り込み（色は管理画面と共通） */}
      {multiStore && (
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
          {[{ id: null as number | null, name: '全会場' }, ...sortedStores].map(st => {
            const active = storeFilter === st.id
            const c = st.id ? colorOf(st.id) : null
            return (
              <button
                key={st.id ?? 'all'}
                onClick={() => setStoreFilter(st.id)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-bold border-2 transition-colors ${
                  active ? 'text-white' : 'bg-white text-gray-700 border-gray-200'
                }`}
                style={active ? { backgroundColor: c?.solid || '#212529', borderColor: c?.solid || '#212529' } : undefined}
              >
                {c && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: active ? '#fff' : c.solid }} />}
                {st.name}
              </button>
            )
          })}
        </div>
      )}

      {!isPublished ? (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex items-start gap-3">
          <EyeOff className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-600">
            {month}月のシフトはまだ公開されていません。公開されたらLINEでお知らせします。
          </p>
        </div>
      ) : (
        <>
          {/* 月のまとめ ＋ 表示切替 */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-gray-600 whitespace-nowrap">
              {who === 'me' ? (
                <>{month}月の勤務{storeName ? `（${storeName}）` : ''} <span className="font-bold text-gray-900">{workDays}日</span>・
                  <span className="font-bold text-gray-900">{totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}時間</span></>
              ) : (
                <>日付を押すと、その日の顔ぶれ</>
              )}
            </p>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
              {([['calendar', CalendarDays, 'カレンダー'], ['list', List, 'リスト']] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-label={label}
                  title={label}
                  className={`px-3 py-2 flex items-center ${view === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
                >
                  <Icon className="w-5 h-5" />
                </button>
              ))}
            </div>
          </div>

          {view === 'calendar' ? (
            <>
              {calendar}
              {selectedDetail}
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
