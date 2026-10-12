import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, EyeOff, MapPin, Users, List, CalendarDays } from 'lucide-react'
import { shiftsApi, storesApi, Shift, Store } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'
import LineLinkCard from '../components/LineLinkCard'
import { storeColorMap, StoreColor } from '../lib/storeColors'

// スタッフの「シフト」画面。スマホで LINE から開かれる前提で、
// 「次はいつ・どこで・誰と」が一目で分かることを最優先にしている。
//   自分の予定 … 次の勤務を大きく → これからの勤務をカードで（一緒に入る人つき）
//   みんなの予定 … 日ごと → 会場ごとに、誰が何時から入るか
// 会場は色＋会場名で表す（lib/storeColors。管理画面と同じ色）

const DOW = ['日', '月', '火', '水', '木', '金', '土']

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

function shiftMinutes(s: Shift): number {
  if (!s.start_time || !s.end_time) return 0
  const [sh, sm] = s.start_time.split(':').map(Number)
  const [eh, em] = s.end_time.split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60 // 日跨ぎシフト
  return mins
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

  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [isPublished, setIsPublished] = useState(true)
  const [loading, setLoading] = useState(true)
  const [stores, setStores] = useState<Store[]>([])
  const [who, setWho] = useState<'me' | 'all'>('me')
  const [storeFilter, setStoreFilter] = useState<number | null>(null)
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [showPast, setShowPast] = useState(false)
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const reqId = useRef(0)

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

  // 公開済みの月だけ見せる（下書きを見せると混乱するため）
  const published = isPublished ? shifts : []
  const mine = published.filter(s => s.user_id === user?.id).sort(byTime)
  const myVisible = mine.filter(inStore)
  const nextShift = mine.find(s => s.date >= todayStr) || null

  // 同じ日・同じ会場に入る自分以外の人
  const coworkers = (s: Shift) =>
    published
      .filter(o => o.date === s.date && o.user_id !== s.user_id && (o.store_id ?? null) === (s.store_id ?? null))
      .sort(byTime)

  const workDays = new Set(myVisible.map(s => s.date)).size
  const totalHours = myVisible.reduce((sum, s) => sum + shiftMinutes(s), 0) / 60
  const storeName = storeFilter ? stores.find(st => st.id === storeFilter)?.name : null

  // ---------- 部品 ----------

  const dayLabelBadge = (date: string) =>
    date === todayStr ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500 text-white">今日</span>
      : date === tomorrowStr ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-800 text-white">明日</span>
      : null

  const ShiftCard = ({ s }: { s: Shift }) => {
    const p = parts(s.date)
    const c = colorOf(s.store_id)
    const mates = coworkers(s)
    const past = s.date < todayStr
    return (
      <div className={`flex bg-white rounded-xl border border-gray-200 overflow-hidden ${past ? 'opacity-50' : ''}`}>
        <div className="w-1.5 shrink-0" style={{ backgroundColor: multiStore || s.store_name ? c.solid : '#2563EB' }} />
        <div className="w-16 shrink-0 flex flex-col items-center justify-center py-3 border-r border-gray-100">
          <span className="text-xs text-gray-500">{p.m}月</span>
          <span className={`text-2xl font-bold leading-none ${dowColor(p.dow)}`}>{p.d}</span>
          <span className={`text-xs font-semibold mt-0.5 ${dowColor(p.dow)}`}>{p.dowLabel}</span>
        </div>
        <div className="flex-1 min-w-0 px-3 py-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xl font-bold text-gray-900 tabular-nums">{hm(s.start_time)}<span className="text-gray-400 mx-1">–</span>{hm(s.end_time)}</span>
            {dayLabelBadge(s.date)}
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
  // 「次の勤務」で大きく出した分は一覧から外す（同じものが2回並ばないように）
  const upcomingMine = myVisible.filter(s => s.date >= todayStr && s.id !== nextShift?.id)
  const pastMine = myVisible.filter(s => s.date < todayStr)

  // みんなの予定: 日 → 会場 → 人
  const allVisible = published.filter(inStore).sort(byTime)
  const allDates = [...new Set(allVisible.map(s => s.date))].sort()
  const pastDates = allDates.filter(d => d < todayStr)
  const shownDates = showPast ? allDates : allDates.filter(d => d >= todayStr)

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
            onClick={() => setWho(w)}
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

      {!isPublished && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex items-start gap-3">
          <EyeOff className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-600">
            {month}月のシフトはまだ公開されていません。公開されたらLINEでお知らせします。
          </p>
        </div>
      )}

      {isPublished && who === 'me' && (
        <>
          {/* 次の勤務 */}
          {nextShift && (() => {
            const p = parts(nextShift.date)
            const c = colorOf(nextShift.store_id)
            const mates = coworkers(nextShift)
            return (
              <div className="rounded-2xl bg-white border-2 p-4 space-y-2" style={{ borderColor: nextShift.store_name ? c.solid : '#2563EB' }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-500">次の勤務</span>
                  {dayLabelBadge(nextShift.date)}
                </div>
                <p className={`text-2xl font-bold ${dowColor(p.dow)}`}>{p.m}月{p.d}日（{p.dowLabel}）</p>
                <p className="text-3xl font-bold text-gray-900 tabular-nums">{hm(nextShift.start_time)}<span className="text-gray-400 mx-1.5">–</span>{hm(nextShift.end_time)}</p>
                <VenuePill name={nextShift.store_name} color={c} size="lg" />
                {mates.length > 0 && (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs font-bold text-gray-500 mb-1">一緒に入る人</p>
                    {mates.map(o => (
                      <p key={o.id} className="text-base text-gray-800 flex justify-between">
                        <span>{o.user_name}</span>
                        <span className="tabular-nums text-gray-600">{hm(o.start_time)}–{hm(o.end_time)}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* 月のまとめ ＋ 表示切替 */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {month}月の勤務{storeName ? `（${storeName}）` : ''} <span className="font-bold text-gray-900">{workDays}日</span>・
              <span className="font-bold text-gray-900">{totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}時間</span>
            </p>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
              {([['list', List, 'リスト'], ['calendar', CalendarDays, 'カレンダー']] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-sm font-semibold flex items-center gap-1 ${view === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
                >
                  <Icon className="w-4 h-4" />{label}
                </button>
              ))}
            </div>
          </div>

          {view === 'list' ? (
            <div className="space-y-2">
              {upcomingMine.length > 0 && nextShift && <p className="text-sm font-bold text-gray-500 pt-1">そのあとの勤務</p>}
              {upcomingMine.map(s => <ShiftCard key={s.id} s={s} />)}
              {upcomingMine.length === 0 && !nextShift && (
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
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="grid grid-cols-7 mb-1">
                {DOW.map((l, i) => (
                  <div key={l} className={`text-center text-xs font-bold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>{l}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDow }, (_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const date = fmtDate(year, month, i + 1)
                  const dayShifts = myVisible.filter(s => s.date === date)
                  const s = dayShifts[0]
                  const c = s ? colorOf(s.store_id) : null
                  const dow = (firstDow + i) % 7
                  const picked = pickedDate === date
                  return (
                    <button
                      key={date}
                      onClick={() => setPickedDate(picked ? null : date)}
                      className={`h-14 rounded-lg flex flex-col items-center justify-start pt-1 relative overflow-hidden ${
                        date === todayStr ? 'ring-2 ring-red-500' : picked ? 'ring-2 ring-gray-900' : ''
                      }`}
                      style={{ backgroundColor: c ? c.soft : '#F8F9FA' }}
                    >
                      <span className={`text-sm font-bold ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'}`}>{i + 1}</span>
                      {s && <span className="text-[11px] font-bold tabular-nums" style={{ color: c!.text }}>{hm(s.start_time)}</span>}
                      {s && <span className="absolute bottom-0 inset-x-0 h-1.5" style={{ backgroundColor: c!.solid }} />}
                    </button>
                  )
                })}
              </div>
              {multiStore && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-xs text-gray-600">
                  {sortedStores.map(st => (
                    <span key={st.id} className="inline-flex items-center gap-1">
                      <span className="w-3 h-1.5 rounded" style={{ backgroundColor: colorOf(st.id).solid }} />{st.name}
                    </span>
                  ))}
                </div>
              )}
              {pickedDate && (
                <div className="mt-3 space-y-2">
                  {myVisible.filter(s => s.date === pickedDate).map(s => <ShiftCard key={s.id} s={s} />)}
                  {myVisible.every(s => s.date !== pickedDate) && (
                    <p className="text-center text-sm text-gray-400 py-3">{parts(pickedDate).m}/{parts(pickedDate).d} は勤務がありません</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {isPublished && who === 'all' && (
        <div className="space-y-3">
          {shownDates.map(date => {
            const p = parts(date)
            const day = allVisible.filter(s => s.date === date)
            // 会場ごとにまとめる（会場なしは最後）
            const groups = [...sortedStores.map(st => ({ id: st.id as number | null, name: st.name })), { id: null, name: '' }]
              .map(g => ({ ...g, rows: day.filter(s => (s.store_id ?? null) === g.id) }))
              .filter(g => g.rows.length > 0)
            return (
              <section key={date} className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${date < todayStr ? 'opacity-50' : ''}`}>
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                  <span className={`text-lg font-bold ${dowColor(p.dow)}`}>{p.m}/{p.d}（{p.dowLabel}）</span>
                  {dayLabelBadge(date)}
                  <span className="ml-auto text-sm text-gray-500">{new Set(day.map(s => s.user_id)).size}人</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {groups.map(g => {
                    const c = colorOf(g.id)
                    return (
                      <div key={g.id ?? 'none'} className="flex">
                        <div className="w-1.5 shrink-0" style={{ backgroundColor: c.solid }} />
                        <div className="flex-1 px-3 py-2.5">
                          {g.name && <p className="text-sm font-bold mb-1" style={{ color: c.text }}>{g.name}</p>}
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

      {/* LINE連携の案内は下に（毎回見る情報ではないため） */}
      <LineLinkCard />
    </div>
  )
}
