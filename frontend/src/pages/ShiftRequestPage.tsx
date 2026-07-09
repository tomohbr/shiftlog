import { useState, useEffect } from 'react'
import { Calendar, Check, X as XIcon, Clock, Send, Settings } from 'lucide-react'
import { shiftRequestsApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

type Availability = 'available' | 'unavailable' | 'preferred'

interface DayEntry {
  date: string
  label: number
  dayOfWeek: number
}

interface StaffEntry {
  availability: Availability
  preferred_start?: string | null
  preferred_end?: string | null
}

interface StaffSummaryRow {
  user_id: number
  user_name: string
  user_color: string
  entries: Record<string, StaffEntry>
}

interface CollectionPeriod {
  status: 'open' | 'closed'
  deadline: string | null
  start_date: string | null
  end_date: string | null
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const AVAILABILITY_COLORS: Record<Availability, string> = {
  available: 'bg-green-400',
  unavailable: 'bg-red-400',
  preferred: 'bg-yellow-400',
}

const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: '出勤可',
  unavailable: '出勤不可',
  preferred: '希望',
}

const AVAILABILITY_ICONS: Record<Availability, typeof Check> = {
  available: Check,
  unavailable: XIcon,
  preferred: Clock,
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function formatDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${year}-${m}-${d}`
}

function buildDays(year: number, month: number): DayEntry[] {
  const count = getDaysInMonth(year, month)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(year, month - 1, i + 1)
    return {
      date: formatDate(year, month, i + 1),
      label: i + 1,
      dayOfWeek: d.getDay(),
    }
  })
}

function cycleAvailability(current: Availability | undefined): Availability {
  if (!current || current === 'unavailable') return 'available'
  if (current === 'available') return 'preferred'
  return 'unavailable'
}

// ===================== Admin View =====================

function AdminView({
  year,
  month,
  days,
}: {
  year: number
  month: number
  days: DayEntry[]
}) {
  const [staffSummary, setStaffSummary] = useState<StaffSummaryRow[]>([])
  const [period, setPeriod] = useState<CollectionPeriod>({ status: 'closed', deadline: null, start_date: null, end_date: null })
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')

  const monthFirst = formatDate(year, month, 1)
  const monthLast = formatDate(year, month, getDaysInMonth(year, month))

  useEffect(() => {
    loadData()
  }, [year, month])

  const loadData = async () => {
    setLoading(true)
    try {
      const [summaryRes, periodRes] = await Promise.all([
        shiftRequestsApi.getAll({ year, month }),
        shiftRequestsApi.getPeriod(year, month),
      ])

      const requests = summaryRes.data.requests || []

      const staffMap: Record<number, StaffSummaryRow> = {}
      for (const req of requests) {
        if (!staffMap[req.user_id]) {
          staffMap[req.user_id] = {
            user_id: req.user_id,
            user_name: req.user_name || `スタッフ${req.user_id}`,
            user_color: req.user_color || '#6366f1',
            entries: {},
          }
        }
        staffMap[req.user_id].entries[req.date] = {
          availability: req.availability,
          preferred_start: req.preferred_start,
          preferred_end: req.preferred_end,
        }
      }
      setStaffSummary(Object.values(staffMap))

      // APIは { period: {...} | null } を返す
      const pData = periodRes.data.period
      setPeriod({
        status: pData?.status || 'closed',
        deadline: pData?.deadline || null,
        start_date: pData?.start_date || null,
        end_date: pData?.end_date || null,
      })
      setDeadlineInput(pData?.deadline || '')
      setStartInput(pData?.start_date || '')
      setEndInput(pData?.end_date || '')
    } catch {
      toast.error('データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const togglePeriod = async () => {
    const newStatus = period.status === 'open' ? 'closed' : 'open'
    try {
      await shiftRequestsApi.setPeriod(
        year,
        month,
        deadlineInput || undefined,
        newStatus,
        startInput || undefined,
        endInput || undefined
      )
      setPeriod(prev => ({
        ...prev,
        status: newStatus,
        start_date: startInput || null,
        end_date: endInput || null,
      }))
      toast.success(
        newStatus === 'open' ? '希望シフト収集を開始しました' : '希望シフト収集を締め切りました'
      )
    } catch (e: any) {
      toast.error(e.response?.data?.error || '操作に失敗しました')
    }
  }

  const updateSettings = async () => {
    if (startInput && endInput && startInput > endInput) {
      toast.error('開始日は終了日より前にしてください')
      return
    }
    try {
      await shiftRequestsApi.setPeriod(year, month, deadlineInput || undefined, period.status, startInput || undefined, endInput || undefined)
      setPeriod(prev => ({
        ...prev,
        deadline: deadlineInput || null,
        start_date: startInput || null,
        end_date: endInput || null,
      }))
      toast.success('収集設定を更新しました')
      setShowSettings(false)
    } catch (e: any) {
      toast.error(e.response?.data?.error || '設定の更新に失敗しました')
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Collection period controls */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 rounded-lg transition-colors shrink-0"
              title="収集設定（対象期間・締切日）"
            >
              <Settings className="w-4 h-4" />
              収集設定
            </button>
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium shrink-0 ${
                period.status === 'open'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  period.status === 'open' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                }`}
              />
              {period.status === 'open' ? '収集中' : '締切済み'}
            </div>
            {period.start_date && period.end_date && (
              <span className="text-sm text-gray-600 font-medium shrink-0">
                対象: {period.start_date.slice(5).replace('-', '/')} 〜 {period.end_date.slice(5).replace('-', '/')}
              </span>
            )}
            {period.deadline && (
              <span className="text-sm text-gray-500 shrink-0">
                締切: {period.deadline}
              </span>
            )}
          </div>
          <button
            onClick={togglePeriod}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              period.status === 'open'
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {period.status === 'open' ? '収集を締め切る' : '収集を開始する'}
          </button>
        </div>

        {showSettings && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">収集対象の開始日</label>
                <input
                  type="date"
                  value={startInput}
                  min={monthFirst}
                  max={monthLast}
                  onChange={e => setStartInput(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">収集対象の終了日</label>
                <input
                  type="date"
                  value={endInput}
                  min={monthFirst}
                  max={monthLast}
                  onChange={e => setEndInput(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">締切日</label>
                <input
                  type="date"
                  value={deadlineInput}
                  onChange={e => setDeadlineInput(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={updateSettings}
                className="px-4 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                保存
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              対象期間を指定すると、スタッフはその期間の日付だけ提出できます（週単位・2週間単位の収集に）。指定しない場合は月全体が対象です。
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="font-medium">凡例:</span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-green-400 inline-block" />
          出勤可
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-400 inline-block" />
          出勤不可
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-yellow-400 inline-block" />
          希望
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-gray-100 inline-block border border-gray-200" />
          未回答
        </span>
      </div>

      {/* Summary grid */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: `${days.length * 40 + 160}px` }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="sticky left-0 z-10 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 border-r border-gray-200 min-w-[140px]">
                  スタッフ
                </th>
                {days.map(day => {
                  const isSun = day.dayOfWeek === 0
                  const isSat = day.dayOfWeek === 6
                  const isToday = day.date === todayStr
                  return (
                    <th
                      key={day.date}
                      className={`text-center py-2 text-xs font-medium border-r border-gray-100 min-w-[36px] ${
                        isToday ? 'bg-blue-50' : isSun ? 'bg-red-50' : isSat ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className={isSun ? 'text-red-500' : isSat ? 'text-blue-500' : 'text-gray-600'}>
                        {day.label}
                      </div>
                      <div className={`text-[10px] ${isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-gray-400'}`}>
                        {DAY_LABELS[day.dayOfWeek]}
                      </div>
                    </th>
                  )
                })}
                <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500 min-w-[60px]">
                  回答率
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {staffSummary.length === 0 && (
                <tr>
                  <td colSpan={days.length + 2} className="text-center py-12 text-gray-400">
                    まだ希望シフトの提出はありません
                  </td>
                </tr>
              )}
              {staffSummary.map(staff => {
                const answeredCount = days.filter(d => staff.entries[d.date]).length
                const rate = Math.round((answeredCount / days.length) * 100)
                return (
                  <tr key={staff.user_id} className="hover:bg-gray-50/50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 border-r border-gray-200">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: staff.user_color }}
                        >
                          {staff.user_name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-gray-800 truncate max-w-[90px]">
                          {staff.user_name}
                        </span>
                      </div>
                    </td>
                    {days.map(day => {
                      const entry = staff.entries[day.date]
                      const av = entry?.availability
                      const compact = (t: string) => t.slice(0, 5).replace(/:00$/, '')
                      const timeText = entry?.preferred_start && entry?.preferred_end
                        ? `${compact(entry.preferred_start)}-${compact(entry.preferred_end)}`
                        : ''
                      const isSun = day.dayOfWeek === 0
                      const isSat = day.dayOfWeek === 6
                      const isToday = day.date === todayStr

                      return (
                        <td
                          key={day.date}
                          className={`text-center py-1 px-0.5 border-r border-gray-100 ${
                            isToday ? 'bg-blue-50/50' : isSun ? 'bg-red-50/30' : isSat ? 'bg-blue-50/30' : ''
                          }`}
                        >
                          {av ? (
                            <div className="flex flex-col items-center justify-center">
                              <div
                                className={`w-6 h-6 rounded flex items-center justify-center ${AVAILABILITY_COLORS[av]}`}
                                title={`${AVAILABILITY_LABELS[av]}${timeText ? ` ${timeText}` : ''}`}
                              >
                                {av === 'available' && <Check className="w-3.5 h-3.5 text-white" />}
                                {av === 'unavailable' && <XIcon className="w-3.5 h-3.5 text-white" />}
                                {av === 'preferred' && <Clock className="w-3.5 h-3.5 text-white" />}
                              </div>
                              {timeText && (
                                <span className="text-[9px] leading-tight text-gray-500 mt-0.5">{timeText}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-200 text-xs">-</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="text-center px-3 py-2">
                      <span
                        className={`text-xs font-semibold ${
                          rate === 100 ? 'text-green-600' : rate >= 50 ? 'text-yellow-600' : 'text-red-500'
                        }`}
                      >
                        {rate}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ===================== Staff View =====================

function StaffView({
  year,
  month,
  days,
  userId,
}: {
  year: number
  month: number
  days: DayEntry[]
  userId: number
}) {
  const [entries, setEntries] = useState<Record<string, Availability>>({})
  const [times, setTimes] = useState<Record<string, { start: string; end: string }>>({})
  const [period, setPeriod] = useState<CollectionPeriod>({ status: 'closed', deadline: null, start_date: null, end_date: null })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    loadData()
  }, [year, month, userId])

  const loadData = async () => {
    setLoading(true)
    try {
      const [reqRes, periodRes] = await Promise.all([
        shiftRequestsApi.getAll({ year, month, user_id: userId }),
        shiftRequestsApi.getPeriod(year, month),
      ])

      const requests = reqRes.data.requests || []
      const map: Record<string, Availability> = {}
      const timeMap: Record<string, { start: string; end: string }> = {}
      for (const r of requests) {
        map[r.date] = r.availability
        if (r.preferred_start || r.preferred_end) {
          timeMap[r.date] = {
            start: (r.preferred_start || '').slice(0, 5),
            end: (r.preferred_end || '').slice(0, 5),
          }
        }
      }
      setEntries(map)
      setTimes(timeMap)
      setDirty(false)

      // APIは { period: {...} | null } を返す
      const pData = periodRes.data.period
      setPeriod({
        status: pData?.status || 'closed',
        deadline: pData?.deadline || null,
        start_date: pData?.start_date || null,
        end_date: pData?.end_date || null,
      })
    } catch {
      toast.error('データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // 収集対象期間の判定（期間未指定なら月全体が対象）
  const inRange = (date: string) =>
    (!period.start_date || date >= period.start_date) && (!period.end_date || date <= period.end_date)

  const toggleDay = (date: string) => {
    if (period.status !== 'open') {
      toast.error('現在は希望シフトの提出期間外です')
      return
    }
    if (!inRange(date)) {
      toast.error('この日は今回の収集対象外です')
      return
    }
    setEntries(prev => {
      const current = prev[date]
      const next = cycleAvailability(current)
      return { ...prev, [date]: next }
    })
    setDirty(true)
  }

  const setTime = (date: string, field: 'start' | 'end', value: string) => {
    setTimes(prev => {
      const current = prev[date] || { start: '', end: '' }
      return { ...prev, [date]: { ...current, [field]: value } }
    })
    setDirty(true)
  }

  const handleSubmit = async () => {
    if (period.status !== 'open') {
      toast.error('現在は希望シフトの提出期間外です')
      return
    }

    // 時間の片側だけ入力されている日をチェック
    for (const [date, t] of Object.entries(times)) {
      if (entries[date] && entries[date] !== 'unavailable') {
        if ((t.start && !t.end) || (!t.start && t.end)) {
          const [, m, d] = date.split('-').map(Number)
          toast.error(`${m}/${d} の時間は開始と終了の両方を入力してください`)
          return
        }
      }
    }

    setSubmitting(true)
    try {
      const requests = Object.entries(entries).map(([date, availability]) => {
        const t = availability !== 'unavailable' ? times[date] : undefined
        return {
          date,
          availability,
          preferred_start: t?.start || undefined,
          preferred_end: t?.end || undefined,
        }
      })
      await shiftRequestsApi.submitBulk(requests)
      toast.success('希望シフトを提出しました')
      setDirty(false)
    } catch {
      toast.error('提出に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const setAllDays = (availability: Availability) => {
    if (period.status !== 'open') {
      toast.error('現在は希望シフトの提出期間外です')
      return
    }
    const newEntries: Record<string, Availability> = { ...entries }
    for (const day of days) {
      if (inRange(day.date)) newEntries[day.date] = availability
    }
    setEntries(newEntries)
    setDirty(true)
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  // Build calendar grid with leading empty cells
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const isClosed = period.status !== 'open'

  return (
    <div className="space-y-4">
      {/* Period status banner */}
      <div
        className={`card ${
          isClosed ? 'bg-gray-50 border-gray-200' : 'bg-green-50 border-green-200'
        } border`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-3 h-3 rounded-full flex-shrink-0 ${
              isClosed ? 'bg-gray-400' : 'bg-green-500 animate-pulse'
            }`}
          />
          <div>
            <p className={`text-sm font-medium ${isClosed ? 'text-gray-600' : 'text-green-700'}`}>
              {isClosed
                ? '現在は希望シフトの提出期間外です'
                : '希望シフトを提出してください'}
            </p>
            {!isClosed && (period.start_date && period.end_date) && (
              <p className="text-xs text-green-700 mt-0.5 font-medium">
                対象期間: {period.start_date.slice(5).replace('-', '/')} 〜 {period.end_date.slice(5).replace('-', '/')}
              </p>
            )}
            {period.deadline && !isClosed && (
              <p className="text-xs text-green-600 mt-0.5">
                締切: {period.deadline}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Quick fill buttons */}
      {!isClosed && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">一括設定:</span>
          <button
            onClick={() => setAllDays('available')}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
          >
            <Check className="w-3 h-3" />
            全日出勤可
          </button>
          <button
            onClick={() => setAllDays('unavailable')}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
          >
            <XIcon className="w-3 h-3" />
            全日出勤不可
          </button>
          <button
            onClick={() => setAllDays('preferred')}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700 hover:bg-yellow-200 transition-colors"
          >
            <Clock className="w-3 h-3" />
            全日希望
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="font-medium">タップで切替:</span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-green-400 inline-block" />
          出勤可
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-yellow-400 inline-block" />
          希望
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-400 inline-block" />
          出勤不可
        </span>
      </div>

      {/* Calendar grid */}
      <div className="card p-3 sm:p-4">
        {/* Day of week headers */}
        <div className="grid grid-cols-7 mb-2">
          {DAY_LABELS.map((label, i) => (
            <div
              key={label}
              className={`text-center text-xs font-semibold py-1 ${
                i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        <div className="grid grid-cols-7 gap-1">
          {/* Leading empty cells */}
          {Array.from({ length: firstDayOfWeek }, (_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}

          {/* Day cells */}
          {days.map(day => {
            const outOfRange = !inRange(day.date)
            const av = outOfRange ? undefined : entries[day.date]
            const isSun = day.dayOfWeek === 0
            const isSat = day.dayOfWeek === 6
            const isToday = day.date === todayStr
            const Icon = av ? AVAILABILITY_ICONS[av] : null

            let bgClass = 'bg-gray-50 hover:bg-gray-100'
            if (av === 'available') bgClass = 'bg-green-100 hover:bg-green-200 ring-1 ring-green-300'
            else if (av === 'unavailable') bgClass = 'bg-red-100 hover:bg-red-200 ring-1 ring-red-300'
            else if (av === 'preferred') bgClass = 'bg-yellow-100 hover:bg-yellow-200 ring-1 ring-yellow-300'
            if (outOfRange) bgClass = 'bg-gray-50'

            return (
              <button
                key={day.date}
                onClick={() => toggleDay(day.date)}
                disabled={isClosed || outOfRange}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center transition-all ${bgClass} ${
                  isClosed || outOfRange ? 'cursor-not-allowed opacity-40' : 'cursor-pointer active:scale-95'
                } ${isToday ? 'ring-2 ring-blue-500' : ''}`}
              >
                <span
                  className={`text-sm font-medium leading-none ${
                    isToday
                      ? 'text-blue-600'
                      : isSun
                        ? 'text-red-500'
                        : isSat
                          ? 'text-blue-500'
                          : 'text-gray-700'
                  }`}
                >
                  {day.label}
                </span>
                {Icon && (
                  <Icon
                    className={`w-3.5 h-3.5 mt-0.5 ${
                      av === 'available'
                        ? 'text-green-600'
                        : av === 'unavailable'
                          ? 'text-red-500'
                          : 'text-yellow-600'
                    }`}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Time preferences (optional) */}
      {!isClosed && (() => {
        const timeDays = days.filter(d => inRange(d.date) && (entries[d.date] === 'available' || entries[d.date] === 'preferred'))
        if (timeDays.length === 0) return null
        return (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700">時間帯の希望（任意）</h3>
            <p className="text-xs text-gray-400 mt-0.5 mb-3">「この日は18:00〜21:00なら入れる」など、日ごとに指定できます。空欄のままなら終日OKの意味になります。</p>
            <div className="space-y-2">
              {timeDays.map(day => {
                const t = times[day.date] || { start: '', end: '' }
                const av = entries[day.date]
                return (
                  <div key={day.date} className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium w-20 shrink-0 ${day.dayOfWeek === 0 ? 'text-red-500' : day.dayOfWeek === 6 ? 'text-blue-500' : 'text-gray-700'}`}>
                      {month}/{day.label}（{DAY_LABELS[day.dayOfWeek]}）
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${av === 'preferred' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                      {av === 'preferred' ? '希望' : '出勤可'}
                    </span>
                    <input
                      type="time"
                      value={t.start}
                      onChange={e => setTime(day.date, 'start', e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
                    />
                    <span className="text-gray-400 text-sm">〜</span>
                    <input
                      type="time"
                      value={t.end}
                      onChange={e => setTime(day.date, 'end', e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
                    />
                    {(t.start || t.end) && (
                      <button
                        type="button"
                        onClick={() => { setTimes(prev => ({ ...prev, [day.date]: { start: '', end: '' } })); setDirty(true) }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        クリア
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Submit button */}
      {!isClosed && (
        <div className="sticky bottom-4 flex justify-center">
          <button
            onClick={handleSubmit}
            disabled={submitting || !dirty}
            className={`flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-semibold shadow-lg transition-all ${
              submitting || !dirty
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white active:scale-95'
            }`}
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                提出中...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                希望シフトを提出する
              </>
            )}
          </button>
        </div>
      )}

      {/* Summary counts */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">提出状況</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 rounded-lg bg-green-50">
            <p className="text-2xl font-bold text-green-600">
              {days.filter(d => entries[d.date] === 'available').length}
            </p>
            <p className="text-xs text-green-600 mt-1">出勤可</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-yellow-50">
            <p className="text-2xl font-bold text-yellow-600">
              {days.filter(d => entries[d.date] === 'preferred').length}
            </p>
            <p className="text-xs text-yellow-600 mt-1">希望</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-50">
            <p className="text-2xl font-bold text-red-500">
              {days.filter(d => entries[d.date] === 'unavailable').length}
            </p>
            <p className="text-xs text-red-500 mt-1">出勤不可</p>
          </div>
        </div>
        <div className="mt-3 text-center">
          <span className="text-xs text-gray-400">
            未回答: {days.filter(d => !entries[d.date]).length}日
          </span>
        </div>
      </div>
    </div>
  )
}

// ===================== Main Page =====================

export default function ShiftRequestPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const days = buildDays(year, month)

  const goPrev = () => {
    if (month === 1) {
      setYear(y => y - 1)
      setMonth(12)
    } else {
      setMonth(m => m - 1)
    }
  }

  const goNext = () => {
    if (month === 12) {
      setYear(y => y + 1)
      setMonth(1)
    } else {
      setMonth(m => m + 1)
    }
  }

  const goToday = () => {
    const t = new Date()
    setYear(t.getFullYear())
    setMonth(t.getMonth() + 1)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            今月
          </button>
          <button
            onClick={goPrev}
            className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={goNext}
            className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <h2 className="text-xl font-bold text-gray-900 min-w-[8rem]">
            {year}年{month}月
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-500">
            {isAdmin ? '希望シフト管理' : '希望シフト提出'}
          </span>
        </div>
      </div>

      {/* Conditional view */}
      {isAdmin ? (
        <AdminView year={year} month={month} days={days} />
      ) : (
        <StaffView year={year} month={month} days={days} userId={user?.id || 0} />
      )}
    </div>
  )
}
