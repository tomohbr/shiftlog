import { useState, useEffect } from 'react'
import { isEventMode } from '../lib/terms'
import { Calendar, Check, X as XIcon, Clock, Send, Settings, Megaphone, Copy, Printer, Share2, AlertCircle } from 'lucide-react'
import { shiftRequestsApi, usersApi, User, campaignsApi, Campaign } from '../api/client'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { staffLoginUrl } from '../components/StaffLoginQR'
import LineShareButton from '../components/LineShareButton'
import toast from 'react-hot-toast'
import StaffRequestView from '../components/StaffRequestView'

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

// ===================== 提出依頼文・催促文（スタッフ周知の摩擦削減） =====================

function fmtMD(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
}

function buildRequestMessage(
  companyName: string,
  companyPin: string,
  year: number,
  month: number,
  start?: string | null,
  end?: string | null,
  deadline?: string | null
): string {
  const lines = [
    `【${companyName}】${month}月の希望シフト提出のお願い`,
    `${year}年${month}月分の希望シフトの受付を開始しました。`,
  ]
  if (start && end) lines.push(`対象期間: ${fmtMD(start)} 〜 ${fmtMD(end)}`)
  if (deadline) lines.push(`締切: ${fmtMD(deadline)}`)
  lines.push(
    '',
    '下のURLを開いて自分の名前をタップ → メニューの「希望シフト」から提出できます。',
    staffLoginUrl(companyPin)
  )
  return lines.join('\n')
}

function buildReminderMessage(
  companyName: string,
  companyPin: string,
  month: number,
  names: string[],
  deadline?: string | null
): string {
  const lines = [
    `【${companyName}】${month}月の希望シフト提出のお願い（リマインド）`,
    `まだ提出が確認できていない方: ${names.map(n => `${n}さん`).join('、')}`,
  ]
  if (deadline) lines.push(`締切: ${fmtMD(deadline)}`)
  lines.push(
    '',
    '下のURLを開いて自分の名前をタップ → メニューの「希望シフト」から提出をお願いします。',
    staffLoginUrl(companyPin)
  )
  return lines.join('\n')
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
  const { selectedCompany } = useAuth()
  const [staffSummary, setStaffSummary] = useState<StaffSummaryRow[]>([])
  const [period, setPeriod] = useState<CollectionPeriod>({ status: 'closed', deadline: null, start_date: null, end_date: null })
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  // スタッフ周知（収集開始直後のモーダル/バナー）と未提出者の可視化。
  // どちらも既存の収集開始処理・提出状況テーブルには手を入れず、表示を足すだけ。
  const [allStaff, setAllStaff] = useState<User[]>([])
  const [hasPeriod, setHasPeriod] = useState(false)
  const [notifyView, setNotifyView] = useState<'none' | 'modal' | 'banner'>('none')

  const companyName = selectedCompany?.name || ''
  const companyPin = (selectedCompany as any)?.company_pin || ''

  const monthFirst = formatDate(year, month, 1)
  const monthLast = formatDate(year, month, getDaysInMonth(year, month))

  useEffect(() => {
    loadData()
  }, [year, month])

  const loadData = async () => {
    setLoading(true)
    try {
      const [summaryRes, periodRes, usersRes] = await Promise.all([
        shiftRequestsApi.getAll({ year, month }),
        shiftRequestsApi.getPeriod(year, month),
        // スタッフ一覧は未提出者の可視化用。失敗しても既存表示は変えない
        usersApi.getAll().catch(() => null),
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
      setHasPeriod(!!pData)
      setAllStaff(usersRes?.data?.users || [])
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
      // 収集開始が成功した後に、フロント側で「スタッフに知らせる」案内を重ねる。
      // 初回はモーダル、2回目以降は小さいバナー（localStorageで判定）。
      // バックエンドの収集開始処理には一切手を入れていない。
      if (newStatus === 'open') {
        setHasPeriod(true)
        let seen = false
        try {
          const key = `shiftlog_collect_notify_seen_${selectedCompany?.id ?? 'c'}`
          seen = !!localStorage.getItem(key)
          if (!seen) localStorage.setItem(key, '1')
        } catch {
          // localStorageが使えない環境ではモーダル扱いにする
        }
        setNotifyView(seen ? 'banner' : 'modal')
      } else {
        setNotifyView('none')
      }
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

  // 提出依頼文（収集開始直後の周知用）。開始直後は入力値が最新なので入力値を優先する
  const requestMessage = buildRequestMessage(
    companyName,
    companyPin,
    year,
    month,
    startInput || period.start_date,
    endInput || period.end_date,
    deadlineInput || period.deadline
  )

  // 未提出スタッフの可視化（表示の追加のみ。既存の提出セル・確定操作は不変）
  const staffOnly = allStaff.filter(u => u.role === 'staff' || u.company_role === 'staff')
  const submittedIds = new Set(staffSummary.map(s => s.user_id))
  const unsubmitted = staffOnly.filter(u => !submittedIds.has(u.id))
  const reminderMessage = buildReminderMessage(
    companyName,
    companyPin,
    month,
    unsubmitted.map(u => u.name),
    period.deadline
  )

  const [reminding, setReminding] = useState(false)
  const remindByLine = async () => {
    setReminding(true)
    try {
      const res = await shiftRequestsApi.remindByLine(year, month)
      const { sent, not_linked } = res.data
      const rest = not_linked.length ? `（LINE未連携: ${not_linked.join('、')}）` : ''
      if (sent > 0) toast.success(`${sent}人にLINEで催促しました${rest}`, { duration: 6000 })
      else toast.error(`LINEで送れる未提出の人がいません${rest}`, { duration: 6000 })
    } catch (e: any) {
      toast.error(e.response?.data?.error || '催促の送信に失敗しました')
    } finally {
      setReminding(false)
    }
  }

  const copyText = (text: string, doneMsg: string) => {
    navigator.clipboard.writeText(text)
    toast.success(doneMsg)
  }

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

      {/* 収集開始後の周知バナー（2回目以降のリマインド。閉じるだけで消える） */}
      {notifyView === 'banner' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
          <Megaphone className="w-5 h-5 text-blue-600 shrink-0" />
          <p className="text-sm text-blue-900 font-medium flex-1 min-w-[200px]">
            収集を開始しました。スタッフへの案内は送りましたか？
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => copyText(requestMessage, '提出依頼文をコピーしました')}
              className="px-3 py-1.5 text-xs bg-white border border-blue-300 rounded hover:bg-blue-100 flex items-center gap-1 font-semibold text-blue-800"
            >
              <Copy className="w-3 h-3" /> 依頼文をコピー
            </button>
            <LineShareButton text={requestMessage} />
            <button
              onClick={() => setNotifyView('none')}
              className="p-1.5 text-blue-400 hover:text-blue-600 rounded"
              title="閉じる"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 未提出スタッフへの催促（収集中で未提出者がいる時だけ表示） */}
      {hasPeriod && period.status === 'open' && unsubmitted.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-wrap items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-semibold text-amber-900">
              未提出のスタッフが{unsubmitted.length}名います
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              {unsubmitted.map(u => u.name).join('、')}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => copyText(reminderMessage, '催促文をコピーしました')}
              className="px-3 py-1.5 text-xs bg-white border border-amber-300 rounded hover:bg-amber-100 flex items-center gap-1 font-semibold text-amber-800"
            >
              <Copy className="w-3 h-3" /> 催促文をコピー
            </button>
            <LineShareButton text={reminderMessage} />
            <button
              onClick={remindByLine}
              disabled={reminding}
              className="px-3 py-1.5 text-xs bg-[#06C755] text-white rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1 font-semibold"
              title="シフトログとLINE連携している未提出の人に、本人専用の提出リンクを送ります"
            >
              <Send className="w-3 h-3" /> {reminding ? '送信中…' : 'LINEで個別に催促'}
            </button>
          </div>
        </div>
      )}

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
              {staffSummary.length === 0 && (!hasPeriod || unsubmitted.length === 0) && (
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
              {/* 未提出スタッフの行（収集期間がある月だけ。既存の提出済み行の下に追加表示するのみ） */}
              {hasPeriod && unsubmitted.map(u => (
                <tr key={`unsubmitted-${u.id}`} className="hover:bg-gray-50/50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2 border-r border-gray-200">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 opacity-50"
                        style={{ backgroundColor: u.color || '#9CA3AF' }}
                      >
                        {u.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <span className="block text-sm font-medium text-gray-500 truncate max-w-[90px]">
                          {u.name}
                        </span>
                        <span className="inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                          未提出
                        </span>
                      </div>
                    </div>
                  </td>
                  {days.map(day => (
                    <td key={day.date} className="text-center py-1 px-0.5 border-r border-gray-100">
                      <span className="text-gray-200 text-xs">-</span>
                    </td>
                  ))}
                  <td className="text-center px-3 py-2">
                    <span className="text-xs font-semibold text-red-500">0%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 収集開始直後の「スタッフに知らせる」モーダル（初回のみ。閉じると既存画面にそのまま戻る） */}
      {notifyView === 'modal' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setNotifyView('none')} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-blue-600" />
                スタッフに提出開始を知らせましょう
              </h3>
              <button onClick={() => setNotifyView('none')}>
                <XIcon className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3">
              <p className="text-sm text-gray-700">
                収集を開始しただけでは、<b className="text-gray-900">スタッフには通知されません</b>。
                下の案内文をLINEやグループチャットで送るか、印刷用QRポスターを店舗に貼ってください。
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans">{requestMessage}</pre>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => copyText(requestMessage, '提出依頼文をコピーしました')}
                  className="px-3 py-2 text-xs bg-white border border-blue-300 rounded-lg hover:bg-blue-50 flex items-center gap-1.5 font-semibold text-blue-800"
                >
                  <Copy className="w-3.5 h-3.5" /> 依頼文をコピー
                </button>
                <LineShareButton
                  text={requestMessage}
                  className="px-3 py-2 text-xs bg-[#06C755] text-white rounded-lg hover:opacity-90 flex items-center gap-1.5 font-semibold"
                />
                {typeof navigator !== 'undefined' && !!(navigator as any).share && (
                  <button
                    onClick={() => {
                      (navigator as any).share({ title: '希望シフト提出のお願い', text: requestMessage }).catch(() => {})
                    }}
                    className="px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 font-semibold text-gray-700"
                  >
                    <Share2 className="w-3.5 h-3.5" /> 送る
                  </button>
                )}
                <button
                  onClick={() => window.open('/qr-poster', '_blank')}
                  className="px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 font-semibold text-gray-700"
                >
                  <Printer className="w-3.5 h-3.5" /> 印刷用QRポスターを開く
                </button>
              </div>
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setNotifyView('none')}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                閉じる（あとで送る）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ===================== 期間の募集の案内 =====================

// スタッフ: 受付中の「期間の募集」（マーケットなど）があれば、月の希望より先に出す
function OpenCampaigns() {
  const [list, setList] = useState<Campaign[]>([])
  useEffect(() => { campaignsApi.open().then(r => setList(r.data.campaigns)).catch(() => {}) }, [])
  if (list.length === 0) return null
  return (
    <div className="space-y-2 max-w-xl mx-auto">
      {list.map(c => (
        <Link key={c.id} to={`/campaign/${c.id}`} className="block rounded-2xl border-2 border-green-300 bg-green-50 px-4 py-3">
          <p className="text-xs font-bold text-green-700">シフトの希望を募集中</p>
          <p className="text-lg font-black text-gray-900">{c.title}</p>
          <p className="text-sm text-gray-700">
            {fmtMD(c.start_date)}〜{fmtMD(c.end_date)}
            {c.deadline && <>・締切 {fmtMD(c.deadline)}{c.days_left !== null && c.days_left >= 0 ? `（あと${c.days_left}日）` : ''}</>}
          </p>
          <p className="mt-2 text-center text-white font-bold bg-green-600 rounded-xl py-2">{c.submitted ? '出した希望を見る・直す' : '希望を出す'}</p>
        </Link>
      ))}
    </div>
  )
}

// ===================== Main Page =====================

export default function ShiftRequestPage() {
  const { user , selectedCompany } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

  // LINE のリンクから来たときは ?year=&month= の月を開く
  const now = new Date()
  const qs = new URLSearchParams(window.location.search)
  const qYear = Number(qs.get('year'))
  const qMonth = Number(qs.get('month'))
  const fromLink = qYear >= 2000 && qMonth >= 1 && qMonth <= 12
  const [year, setYear] = useState(fromLink ? qYear : now.getFullYear())
  const [month, setMonth] = useState(fromLink ? qMonth : now.getMonth() + 1)

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

        <div className={`flex items-center gap-2 ${isAdmin ? '' : 'hidden'}`}>
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-500">
            {isAdmin ? '希望シフト管理' : '希望シフト提出'}
          </span>
        </div>
      </div>

      {/* Conditional view */}
      {isAdmin ? (
        <>
          {isEventMode(selectedCompany) && (
            <Link to="/request-campaigns" className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 hover:bg-gray-50">
              <Megaphone className="w-4 h-4 flex-shrink-0 text-gray-500" />
              <span><b>マーケットなど、月をまたぐ期間</b>の希望は「期間で希望を募集」から1回で集められます（会場・週の日数などの質問つき）</span>
            </Link>
          )}
          <AdminView year={year} month={month} days={days} />
        </>
      ) : (
        <>
          <OpenCampaigns />
          <StaffRequestView year={year} month={month} userId={user?.id || 0} />
        </>
      )}
    </div>
  )
}
