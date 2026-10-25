import { useState, useEffect, useCallback } from 'react'
import { venueWord, isEventMode } from '../lib/terms'
import { format, addMonths, subMonths } from 'date-fns'
import { Users, Calendar, Clock, CheckCircle, AlertTriangle, DollarSign, Repeat, Store as StoreIcon, ArrowRight, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import TeamCalendar from '../components/TeamCalendar'
import TodayByVenue from '../components/TodayByVenue'
import { storeColorMap } from '../lib/storeColors'
import ShiftModal from '../components/ShiftModal'
import MonthNavigator from '../components/MonthNavigator'
import PublicationBar from '../components/PublicationBar'
import StaffLoginQR from '../components/StaffLoginQR'
import { shiftsApi, usersApi, laborApi, swapsApi, seedApi, storesApi, timecardsApi, Shift, User, Store } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

export default function DashboardPage() {
  const { user, selectedCompany } = useAuth()
  const vw = venueWord(selectedCompany)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [shifts, setShifts] = useState<Shift[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null)
  const [isPublished, setIsPublished] = useState(false)
  const [stores, setStores] = useState<Store[]>([])
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  // 見る会場（null = 全会場）。ブースの責任者が自分の会場だけ見られるように、端末に覚えておく
  const VENUE_KEY = `shiftlog:dashboardVenue:${selectedCompany?.id ?? ''}`
  const [venue, setVenueState] = useState<number | null>(() => {
    try { const v = localStorage.getItem(VENUE_KEY); return v ? Number(v) : null } catch { return null }
  })
  const setVenue = (v: number | null) => {
    setVenueState(v)
    try { v ? localStorage.setItem(VENUE_KEY, String(v)) : localStorage.removeItem(VENUE_KEY) } catch { /* 覚えられなくても切り替えはできる */ }
  }

  const loadData = useCallback(async () => {
    if (!selectedCompany) return
    setLoading(true)
    try {
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth() + 1

      const [shiftsRes, usersRes, pubRes, storesRes, timecardsRes] = await Promise.all([
        shiftsApi.getAll({ year, month }),
        usersApi.getAll(),
        shiftsApi.getPublication(year, month),
        storesApi.getAll().catch(() => ({ data: { stores: [] } })),
        timecardsApi.getAll().catch(() => ({ data: { records: [] } })),
      ])

      setShifts(shiftsRes.data.shifts)
      setUsers(usersRes.data.users.filter((u: User) => u.company_role === 'staff' || u.role === 'staff'))
      setIsPublished(pubRes.data.publication?.is_published === 1)
      setStoreCount((storesRes.data as any)?.stores?.length || 0)
      setStores((storesRes.data as any)?.stores || [])
      setHasAnyTimecard(((timecardsRes.data as any)?.records?.length || 0) > 0)
    } catch {
      toast.error('データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [currentDate, selectedCompany])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDayClick = (date: Date) => {
    setSelectedDate(date)
    setSelectedShift(null)
    setModalOpen(true)
  }

  const handleShiftClick = (shift: Shift) => {
    const [y, m, d] = shift.date.split('-').map(Number)
    setSelectedDate(new Date(y, m - 1, d))
    setSelectedShift(shift)
    setModalOpen(true)
  }

  const handlePublish = async () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1
    try {
      await shiftsApi.setPublication(year, month, !isPublished)
      setIsPublished(!isPublished)
      toast.success(isPublished ? 'シフトを非公開にしました' : 'シフトを公開しました')
    } catch {
      toast.error('操作に失敗しました')
    }
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const todayShifts = shifts.filter(s => s.date === todayStr && (!venue || s.store_id === venue))
  const totalShifts = venue ? shifts.filter(s => s.store_id === venue).length : shifts.length

  const [monthlyLabor, setMonthlyLabor] = useState<number>(0)
  const [alertCount, setAlertCount] = useState<number>(0)
  const [pendingSwaps, setPendingSwaps] = useState<number>(0)
  const [storeCount, setStoreCount] = useState<number>(0)
  const [hasAnyTimecard, setHasAnyTimecard] = useState<boolean>(true)

  useEffect(() => {
    if (!selectedCompany) return
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1
    Promise.all([
      laborApi.getCosts(year, month).catch(() => null),
      laborApi.getAlerts(year, month).catch(() => null),
      swapsApi.list().catch(() => null),
    ]).then(([c, a, sw]) => {
      setMonthlyLabor((c?.data as any)?.totalCost || 0)
      setAlertCount(((a?.data as any)?.alerts || []).length)
      setPendingSwaps(((sw?.data as any)?.swaps || []).filter((s: any) => s.status === 'pending').length)
    })
  }, [currentDate, selectedCompany, shifts])

  const noStore = storeCount === 0
  const noStaff = users.length === 0
  const noShift = shifts.length === 0
  const noTimecard = !hasAnyTimecard
  // 読み込み中は店舗0・シフト0に見えるので、案内は読み込みが終わってから出す
  const criticalEmpty = !loading && noStore && noShift // 店舗もシフトもない = ほぼ未使用
  // 店舗・スタッフ・シフトが揃っても、スタッフが一度も打刻していなければ「定着」できていない。
  // 実データで全社がこの段階で止まっていたため、打刻ゼロの間は案内を消さない。
  // シフトは月ごとに空になるので、店舗とスタッフがそろえば準備は済んだとみなす（空の月は下のカレンダーで案内する）
  const setupStepsDone = !noStore && !noStaff
  const companyPin = (selectedCompany as any)?.company_pin || ''

  return (
    <div className="space-y-6">
      {criticalEmpty && (
        <div className="card">
          <p className="eyebrow mb-1">はじめに</p>
          <h3 className="text-lg font-bold text-gray-900">店舗とシフトを入れると、今日の出勤状況がここに出ます</h3>
          <p className="text-sm text-gray-600 mt-1">
            3分で終わります。まず試してみたい場合は、サンプルの店舗・スタッフ・今週のシフトを一括で入れられます（あとで消せます）。
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Link to="/stores" className="btn-primary">
              <StoreIcon className="w-4 h-4" /> 店舗を追加する
            </Link>
            <button
              onClick={async () => {
                if (!confirm('サンプル店舗1件、スタッフ4名、今週のシフトを一括投入します。動作確認後に削除できます。よろしいですか？')) return
                try {
                  const r = await seedApi.demo()
                  toast.success(`投入完了: 店舗${r.data.created.store} / スタッフ${r.data.created.staff} / シフト${r.data.created.shifts}`)
                  loadData()
                } catch (e: any) { toast.error(e.response?.data?.error || '失敗しました') }
              }}
              className="btn-secondary"
            >
              <Sparkles className="w-4 h-4" /> サンプルで試す
            </button>
            <Link to="/setup-guide" className="btn-ghost">導入手順書 <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
        </div>
      )}
      {!loading && !setupStepsDone && !criticalEmpty && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-gray-900 mb-2">定着までの4ステップ</h3>
              <p className="text-xs text-gray-600 mb-3">店舗・スタッフ・シフトをそろえて公開すると、スタッフのスマホにシフトが届き、毎日の打刻状況をここで確認できます。</p>
              <div className="grid sm:grid-cols-4 gap-2 text-sm">
                <Link to="/stores" className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${!noStore ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 hover:border-blue-400'}`}>
                  <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${!noStore ? 'bg-green-600 text-white' : 'bg-blue-100 text-blue-700'}`}>{!noStore ? '✓' : '1'}</span>
                  <span>店舗を追加</span>
                </Link>
                <Link to="/staff" className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${users.length > 0 ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 hover:border-blue-400'}`}>
                  <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${users.length > 0 ? 'bg-green-600 text-white' : 'bg-blue-100 text-blue-700'}`}>{users.length > 0 ? '✓' : '2'}</span>
                  <span>スタッフを登録</span>
                </Link>
                <Link to="/shifts" className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${shifts.length > 0 ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 hover:border-blue-400'}`}>
                  <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${shifts.length > 0 ? 'bg-green-600 text-white' : 'bg-blue-100 text-blue-700'}`}>{shifts.length > 0 ? '✓' : '3'}</span>
                  <span>シフトを作成</span>
                </Link>
                <Link to="/shifts" className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${isPublished ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 hover:border-blue-400'}`}>
                  <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${isPublished ? 'bg-green-600 text-white' : 'bg-blue-100 text-blue-700'}`}>{isPublished ? '✓' : '4'}</span>
                  <span>スタッフに公開</span>
                </Link>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={async () => {
                    if (!confirm('動作確認用のサンプル店舗・スタッフ4名・今週のシフトを一括投入します。よろしいですか？（あとで削除できます）')) return
                    try {
                      const r = await seedApi.demo()
                      toast.success(`サンプルデータを投入しました（店舗${r.data.created.store}/スタッフ${r.data.created.staff}/シフト${r.data.created.shifts}）`)
                      loadData()
                    } catch (e: any) { toast.error(e.response?.data?.error || '失敗') }
                  }}
                  className="btn-secondary text-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" /> サンプルで試す
                </button>
                <Link to="/setup-guide" className="text-xs text-blue-700 hover:underline">導入手順書を見る →</Link>
                <Link to="/help" className="text-xs text-blue-700 hover:underline">使い方FAQ →</Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && noTimecard && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-start gap-5 justify-between">
            <div className="flex-1">
              <p className="text-xs font-semibold text-blue-700 mb-1">
                {setupStepsDone ? 'あと一歩：まだ誰も打刻していません' : '今日から打刻を始める'}
              </p>
              <h3 className="text-lg font-bold text-gray-900">
                {setupStepsDone
                  ? 'スタッフに下のQRを見せる（または案内を送る）と、その場で打刻が始まります'
                  : 'スタッフ1人にログイン案内を送り、最初の出勤打刻まで進めましょう'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                会社PINを入力する代わりに、QRコードを1回スキャンするだけでスタッフはログインできます。レジ横やバックヤードに貼っておくのがおすすめです。
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <Link to="/staff" className="btn-primary">
                  ログイン案内を送る
                </Link>
                <Link to="/timecards" className="btn-secondary">
                  打刻画面を開く
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    if (!companyPin) {
                      toast.error('会社PINを取得できませんでした')
                      return
                    }
                    navigator.clipboard.writeText(companyPin)
                    toast.success('会社PINをコピーしました')
                  }}
                  className="btn-secondary"
                >
                  会社PINをコピー
                </button>
              </div>
            </div>
            {companyPin && (
              <div className="shrink-0 mx-auto lg:mx-0">
                <StaffLoginQR companyPin={companyPin} />
              </div>
            )}
          </div>
          <div className="grid md:grid-cols-4 gap-3 mt-4">
            {[
              ['1', 'スタッフ登録', '名前だけでも開始できます'],
              ['2', 'QR表示 or 案内文コピー', 'その場でスキャン、またはLINE・メールで送ります'],
              ['3', '出勤打刻', 'スマホまたは店舗タブレットで打刻します'],
              ['4', '未打刻確認', '管理者が今日の状況を確認します'],
            ].map(([step, title, body]) => (
              <div key={step} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mb-2">{step}</div>
                <p className="text-sm font-bold text-gray-900">{title}</p>
                <p className="text-xs text-gray-600 mt-1">{body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 今日の会場ごとの状況（いちばん上に） */}
      {/* 会場の切り替え（全画面で同じ色） */}
      {stores.length > 1 && (() => {
        const colorOf = storeColorMap(stores)
        return (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            {[{ id: null as number | null, name: `全${vw}` }, ...[...stores].sort((a, b) => a.id - b.id)].map(st => {
              const active = venue === st.id
              const c = st.id ? colorOf(st.id) : null
              return (
                <button
                  key={st.id ?? 'all'}
                  onClick={() => setVenue(st.id)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold border-2 transition-colors ${active ? 'text-white' : 'bg-white text-gray-700 border-gray-200'}`}
                  style={active ? { backgroundColor: c?.solid || '#212529', borderColor: c?.solid || '#212529' } : undefined}
                >
                  {c && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: active ? '#fff' : c.solid }} />}
                  {st.name}
                </button>
              )
            })}
          </div>
        )
      })()}

      {stores.length > 0 && <TodayByVenue stores={stores} onlyStoreId={venue} />}

      {/* 数字は1本の帯に小さくまとめる（主役は今日の会場とカレンダー） */}
      <div className="card p-0 grid grid-cols-3 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-gray-100 overflow-hidden">
        {([
          ['今月のシフト', `${totalShifts}件`, null, ''],
          ['今日の出勤予定', `${todayShifts.length}人`, null, ''],
          ['スタッフ', `${users.length}人`, '/staff', ''],
          ['今月の人件費', `¥${monthlyLabor.toLocaleString()}`, '/labor', ''],
          ['労務アラート', `${alertCount}件`, '/labor', alertCount > 0 ? 'text-red-600' : ''],
          ['交代リクエスト', `${pendingSwaps}件`, '/swaps', pendingSwaps > 0 ? 'text-orange-600' : ''],
        ] as const).map(([label, value, to, cls]) => {
          const body = (
            <>
              <p className="text-[11px] text-gray-500">{label}</p>
              <p className={`text-lg font-bold text-gray-900 tabular-nums ${cls}`}>{value}</p>
            </>
          )
          return to
            ? <Link key={label} to={to} className="px-4 py-2.5 hover:bg-gray-50">{body}</Link>
            : <div key={label} className="px-4 py-2.5">{body}</div>
        })}
      </div>

      {/* シフトはあるのに未公開＝スタッフには何も見えていない。カレンダーの上で言い切る */}
      {!loading && shifts.length > 0 && !isPublished && (
        <PublicationBar
          year={currentDate.getFullYear()}
          month={currentDate.getMonth() + 1}
          shiftCount={shifts.length}
          isPublished={isPublished}
          onChange={setIsPublished}
        />
      )}

      {/* スマホではカレンダーを端から端まで使う（名前を読めるように） */}
      <div className="card p-0 overflow-hidden -mx-4 sm:mx-0 rounded-none sm:rounded-xl border-x-0 sm:border-x">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200">
          <MonthNavigator
            currentDate={currentDate}
            onPrev={() => setCurrentDate(d => subMonths(d, 1))}
            onNext={() => setCurrentDate(d => addMonths(d, 1))}
            onToday={() => setCurrentDate(new Date())}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handlePublish}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                isPublished
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : shifts.length > 0
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title={isPublished ? 'スタッフの画面に表示されています' : 'スタッフにはまだ見えていません'}
            >
              <CheckCircle className="w-4 h-4" />
              {isPublished ? '公開中' : shifts.length > 0 ? 'スタッフに公開' : '未公開'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
          {shifts.length === 0 && (
            <div className="mx-4 mt-4 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-blue-900 flex-1 min-w-[200px]"><b>{currentDate.getMonth() + 1}月のシフトはまだありません。</b>シフト管理で入れると、ここに出ます。</p>
              {isEventMode(selectedCompany) && <Link to="/auto-schedule" className="btn-secondary">希望から自動で作る</Link>}
              <Link to="/shifts" className="btn-primary">シフト管理で作る</Link>
            </div>
          )}
          <TeamCalendar
            year={currentDate.getFullYear()}
            month={currentDate.getMonth() + 1}
            shifts={venue ? shifts.filter(x => x.store_id === venue) : shifts}
            stores={stores}
            today={new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)}
            onPick={setDayOpen}
          />
          </>
        )}
      </div>

      {/* 日付を押したとき: その日の会場ごとの顔ぶれ。押すと編集、＋で追加 */}
      {dayOpen && (() => {
        const colorOf = storeColorMap(stores)
        const sorted = [...stores].sort((a, b) => a.id - b.id)
        const day = shifts.filter(x => x.date === dayOpen && (!venue || x.store_id === venue))
        const groups = [...sorted.map(st => ({ id: st.id as number | null, name: st.name })), { id: null, name: `${vw}なし` }]
          .map(g => ({ ...g, rows: day.filter(x => (x.store_id ?? null) === g.id).sort((a, b) => a.start_time.localeCompare(b.start_time)) }))
          .filter(g => g.rows.length > 0)
        const [y, m, d] = dayOpen.split('-').map(Number)
        return (
          <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setDayOpen(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200 sticky top-0 bg-white">
                <h3 className="text-lg font-bold">{m}月{d}日（{'日月火水木金土'[new Date(y, m - 1, d).getDay()]}）</h3>
                <span className="text-sm text-gray-500">{new Set(day.map(x => x.user_id)).size}人</span>
                <button onClick={() => setDayOpen(null)} className="ml-auto text-sm text-gray-500">閉じる</button>
              </div>
              <div className="p-4 space-y-3">
                {groups.length === 0 && <p className="text-center text-sm text-gray-400 py-4">この日のシフトはありません</p>}
                {groups.map(g => {
                  const c = g.id ? colorOf(g.id) : { solid: '#868E96', soft: '#F1F3F5', text: '#495057' }
                  return (
                    <div key={g.id ?? 'none'} className="rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-3 py-1.5 text-sm font-bold text-white" style={{ backgroundColor: c.solid }}>{g.name}　{g.rows.length}人</div>
                      {g.rows.map(x => (
                        <button key={x.id} onClick={() => { handleShiftClick(x); setDayOpen(null) }} className="w-full flex items-center justify-between px-3 py-2 border-t border-gray-100 hover:bg-gray-50 text-left">
                          <span className="font-semibold text-gray-900">{x.user_name}</span>
                          <span className="tabular-nums text-gray-600">{x.start_time.slice(0, 5)}–{x.end_time.slice(0, 5)}</span>
                        </button>
                      ))}
                    </div>
                  )
                })}
                <button
                  onClick={() => { const [yy, mm, dd] = dayOpen.split('-').map(Number); handleDayClick(new Date(yy, mm - 1, dd)); setDayOpen(null) }}
                  className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-bold text-gray-600 hover:bg-gray-50"
                >
                  ＋ この日にシフトを追加
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      <ShiftModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setSelectedShift(null) }}
        onSave={loadData}
        date={selectedDate}
        shift={selectedShift}
        users={users}
        stores={stores}
      />
    </div>
  )
}
