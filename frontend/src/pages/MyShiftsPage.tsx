import { useState, useEffect, useCallback } from 'react'
import { Calendar, Clock, ChevronLeft, ChevronRight, EyeOff } from 'lucide-react'
import { shiftsApi, Shift } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function fmtDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function shiftMinutes(s: Shift): number {
  if (!s.start_time || !s.end_time) return 0
  const [sh, sm] = s.start_time.split(':').map(Number)
  const [eh, em] = s.end_time.split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60 // 日跨ぎシフト
  return mins
}

export default function MyShiftsPage() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [isPublished, setIsPublished] = useState(true)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [shiftsRes, pubRes] = await Promise.all([
        shiftsApi.getAll({ year, month }),
        shiftsApi.getPublication(year, month),
      ])
      setShifts(shiftsRes.data.shifts || [])
      setIsPublished(pubRes.data.publication?.is_published === 1)
    } catch {
      toast.error('シフトの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { loadData() }, [loadData])

  const goPrev = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1)
  }
  const goNext = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1)
  }
  const goToday = () => {
    const t = new Date()
    setYear(t.getFullYear())
    setMonth(t.getMonth() + 1)
  }

  const todayStr = fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate())

  // 公開済みの月だけシフトを見せる（下書きを見せると混乱するため）
  const visibleShifts = isPublished ? shifts : []
  const byDate: Record<string, Shift[]> = {}
  for (const s of visibleShifts) {
    if (!byDate[s.date]) byDate[s.date] = []
    byDate[s.date].push(s)
  }

  // 次のシフト（今日以降で最も近いもの）
  const upcoming = visibleShifts
    .filter(s => s.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''))
  const nextShift = upcoming[0] || null

  const workDays = Object.keys(byDate).length
  const totalHours = visibleShifts.reduce((sum, s) => sum + shiftMinutes(s), 0) / 60

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Month navigator */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <button onClick={goToday} className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            今月
          </button>
          <button onClick={goPrev} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={goNext} className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg">
            <ChevronRight className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-gray-900 min-w-[8rem]">{year}年{month}月</h2>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Calendar className="w-4 h-4 text-gray-400" />
          自分のシフト
        </div>
      </div>

      {/* Next shift */}
      {nextShift && (
        <div className="card bg-blue-50 border border-blue-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-700">次のシフト</p>
              <p className="text-lg font-bold text-gray-900">
                {(() => {
                  const [y, m, d] = nextShift.date.split('-').map(Number)
                  const dow = DAY_LABELS[new Date(y, m - 1, d).getDay()]
                  const label = nextShift.date === todayStr ? '今日' : `${m}月${d}日（${dow}）`
                  return `${label} ${nextShift.start_time?.slice(0, 5)}〜${nextShift.end_time?.slice(0, 5)}`
                })()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Not published notice */}
      {!isPublished && (
        <div className="card bg-gray-50 border border-gray-200">
          <div className="flex items-center gap-3">
            <EyeOff className="w-5 h-5 text-gray-400 shrink-0" />
            <p className="text-sm text-gray-600">
              {year}年{month}月のシフトはまだ公開されていません。店長が公開すると、ここに表示されます。
            </p>
          </div>
        </div>
      )}

      {/* Monthly stats */}
      {isPublished && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card text-center py-4">
            <p className="text-2xl font-bold text-gray-900">{workDays}<span className="text-sm font-normal text-gray-400 ml-1">日</span></p>
            <p className="text-xs text-gray-500 mt-1">この月の出勤日</p>
          </div>
          <div className="card text-center py-4">
            <p className="text-2xl font-bold text-gray-900">{totalHours.toFixed(1)}<span className="text-sm font-normal text-gray-400 ml-1">時間</span></p>
            <p className="text-xs text-gray-500 mt-1">予定勤務時間</p>
          </div>
        </div>
      )}

      {/* Calendar */}
      <div className="card p-3 sm:p-4">
        <div className="grid grid-cols-7 mb-2">
          {DAY_LABELS.map((label, i) => (
            <div key={label} className={`text-center text-xs font-semibold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDayOfWeek }, (_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1
            const date = fmtDate(year, month, day)
            const dayShifts = byDate[date] || []
            const hasShift = dayShifts.length > 0
            const isToday = date === todayStr
            const dow = (firstDayOfWeek + i) % 7
            return (
              <div
                key={date}
                className={`min-h-[3.5rem] rounded-lg p-1 text-center ${
                  hasShift ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-gray-50'
                } ${isToday ? 'ring-2 ring-blue-500' : ''}`}
              >
                <p className={`text-xs font-medium ${isToday ? 'text-blue-600' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-600'}`}>
                  {day}
                </p>
                {dayShifts.map(s => (
                  <p key={s.id} className="text-[10px] leading-tight text-blue-700 font-semibold mt-0.5">
                    {s.start_time?.slice(0, 5)}
                    <br />
                    {s.end_time?.slice(0, 5)}
                  </p>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* List */}
      {isPublished && visibleShifts.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-800">この月のシフト一覧</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {[...visibleShifts]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map(s => {
                const [y, m, d] = s.date.split('-').map(Number)
                const dow = DAY_LABELS[new Date(y, m - 1, d).getDay()]
                const isPast = s.date < todayStr
                return (
                  <div key={s.id} className={`px-5 py-2.5 flex items-center justify-between ${isPast ? 'opacity-50' : ''}`}>
                    <span className={`text-sm font-medium ${dow === '日' ? 'text-red-500' : dow === '土' ? 'text-blue-500' : 'text-gray-800'}`}>
                      {m}/{d}（{dow}）{s.date === todayStr && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">今日</span>}
                    </span>
                    <span className="text-sm text-gray-600 font-mono">
                      {s.start_time?.slice(0, 5)} 〜 {s.end_time?.slice(0, 5)}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {isPublished && visibleShifts.length === 0 && (
        <div className="card text-center py-10 text-gray-400 text-sm">
          {user?.name}さんの{month}月のシフトはまだありません
        </div>
      )}
    </div>
  )
}
