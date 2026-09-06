import { startProUpgrade } from '../lib/proUpgrade'
import { useState, useEffect, useCallback } from 'react'
import { billingApi, timecardsApi, usersApi, TimeRecord, TimeRecordEdit, User } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { useKiosk } from '../contexts/KioskContext'
import { Clock, Play, Square, Coffee, Edit2, ChevronLeft, ChevronRight, Download, CloudOff, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { isNative } from '../native/platform'
import {
  ACTION_LABELS,
  PunchAction,
  QueuedPunch,
  flushQueue,
  punch,
  subscribeOnline,
  subscribePending,
} from '../native/offlinePunch'

export default function TimecardPage() {
  const { user, selectedCompany } = useAuth()
  const { selectedStaff, refreshStaffStatus } = useKiosk()
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

  const [todayRecord, setTodayRecord] = useState<TimeRecord | null>(null)
  const [records, setRecords] = useState<TimeRecord[]>([])
  const [adminStaff, setAdminStaff] = useState<User[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(undefined)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [loading, setLoading] = useState(true)
  const [editingRecord, setEditingRecord] = useState<TimeRecord | null>(null)
  const [editForm, setEditForm] = useState({ date: '', clock_in: '', clock_out: '', break_minutes: 0, notes: '' })
  const [editHistory, setEditHistory] = useState<TimeRecordEdit[]>([])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  // オフライン打刻（iOSアプリのみ）
  const [pending, setPending] = useState<QueuedPunch[]>([])
  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const now = new Date()

  // 未同期の打刻件数とオンライン状態を監視する（ポーリングせずイベントで受ける）
  useEffect(() => {
    if (!isNative) return
    const unsubscribePending = subscribePending(setPending)
    const unsubscribeOnline = subscribeOnline(setOnline)
    return () => { unsubscribePending(); unsubscribeOnline() }
  }, [])

  const syncNow = async () => {
    setSyncing(true)
    try {
      const result = await flushQueue()
      if (result.synced > 0) {
        toast.success(`${result.synced}件の打刻を同期しました`)
        fetchToday()
        fetchRecords()
      }
      result.rejected.forEach(r => {
        toast.error(`${r.entry.user_name}さんの${ACTION_LABELS[r.entry.action]}（${r.entry.recorded_at.replace('T', ' ')}）: ${r.reason}`, { duration: 8000 })
      })
      if (result.synced === 0 && result.rejected.length === 0 && result.remaining > 0) {
        toast.error('まだ通信できません。電波の届く場所でもう一度お試しください。')
      }
    } finally {
      setSyncing(false)
    }
  }

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Admin: fetch staff list for dropdown
  useEffect(() => {
    if (isAdmin) {
      usersApi.getAll().then(res => setAdminStaff(res.data.users)).catch(() => {})
    }
  }, [isAdmin])

  const activeUserId = isAdmin ? undefined : selectedStaff?.id

  const fetchToday = useCallback(async () => {
    if (!isAdmin && !selectedStaff) return
    try {
      const res = await timecardsApi.getToday(activeUserId)
      setTodayRecord(res.data.record)
    } catch {}
  }, [activeUserId, isAdmin, selectedStaff])

  const fetchRecords = useCallback(async () => {
    if (!isAdmin && !selectedStaff) {
      setRecords([])
      setLoading(false)
      return
    }
    try {
      const uid = isAdmin ? selectedUserId : selectedStaff?.id
      const res = await timecardsApi.getAll({ year, month, user_id: uid })
      setRecords(res.data.records)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'データ取得エラー')
    } finally {
      setLoading(false)
    }
  }, [year, month, selectedUserId, isAdmin, selectedStaff])

  useEffect(() => {
    fetchToday()
    fetchRecords()
  }, [fetchToday, fetchRecords])

  // 打刻対象。管理者は自分、キオスクでは左で選択中のスタッフ。
  const punchTarget = isAdmin
    ? (user ? { userId: user.id, userName: user.name } : null)
    : (selectedStaff ? { userId: selectedStaff.id, userName: selectedStaff.name } : null)

  // 圏外でキューに積まれたぶんを画面に反映する（サーバーの応答を待たずに状態を進める）
  const applyOptimistic = (action: PunchAction, time: string) => {
    setTodayRecord(prev => {
      const hhmm = time.slice(11, 16)
      if (action === 'clock_in') {
        return {
          id: -Date.now(), company_id: selectedCompany?.id ?? 0,
          user_id: punchTarget?.userId ?? 0, date: time.slice(0, 10),
          clock_in: hhmm, break_minutes: 0, status: 'open',
        } as TimeRecord
      }
      if (!prev) return prev
      if (action === 'clock_out') return { ...prev, clock_out: hhmm, status: 'closed' }
      if (action === 'break_start') return { ...prev, break_start: hhmm }
      return { ...prev, break_end: hhmm }
    })
  }

  const doPunch = async (action: PunchAction, successMessage: string) => {
    if (!punchTarget || !selectedCompany) {
      toast.error('打刻するスタッフを選んでください')
      return
    }
    try {
      const result = await punch(action, {
        userId: punchTarget.userId,
        userName: punchTarget.userName,
        companyId: selectedCompany.id,
      })

      if (result.synced) {
        toast.success(successMessage)
        fetchToday()
        fetchRecords()
        refreshStaffStatus(punchTarget.userId)
        return
      }

      // 圏外。端末に保存し、通信が戻り次第まとめて送る。
      applyOptimistic(action, result.queued!.recorded_at)
      toast.success(
        `${ACTION_LABELS[action]}を端末に記録しました（${result.queued!.recorded_at.slice(11)}）。通信が戻ると自動で同期されます。`,
        { icon: '📴', duration: 5000 }
      )
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラー')
    }
  }

  const handleClockIn = () => doPunch('clock_in', `${selectedStaff?.name || ''}出勤しました`)
  const handleClockOut = () => doPunch('clock_out', `${selectedStaff?.name || ''}退勤しました`)
  const handleBreakStart = () => doPunch('break_start', '休憩開始')
  const handleBreakEnd = () => doPunch('break_end', '休憩終了')

  const openEdit = (rec: TimeRecord) => {
    setEditingRecord(rec)
    setEditForm({
      date: rec.date || '',
      clock_in: rec.clock_in || '',
      clock_out: rec.clock_out || '',
      break_minutes: rec.break_minutes || 0,
      notes: rec.notes || '',
    })
    // 変更履歴を取得（管理者のみのモーダルなので常に取得可）
    setEditHistory([])
    timecardsApi.getEdits(rec.id)
      .then(res => setEditHistory(res.data.edits || []))
      .catch(() => setEditHistory([]))
  }

  // スナップショットJSONを「出 07:49 / 退 17:00 / 休60分」形式に整形
  const fmtSnap = (json: string | null) => {
    if (!json) return ''
    try {
      const s = JSON.parse(json)
      const parts = [`出 ${s.clock_in || '-'}`, `退 ${s.clock_out || '-'}`]
      if (s.break_minutes) parts.push(`休${s.break_minutes}分`)
      if (s.date) parts.unshift(s.date)
      return parts.join(' ')
    } catch { return '' }
  }

  const handleEditSave = async () => {
    if (!editingRecord) return
    try {
      await timecardsApi.update(editingRecord.id, editForm)
      toast.success('更新しました')
      setEditingRecord(null)
      fetchRecords()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラー')
    }
  }

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const calcHours = (rec: TimeRecord) => {
    if (!rec.clock_in || !rec.clock_out) return '-'
    const [ih, im] = rec.clock_in.split(':').map(Number)
    const [oh, om] = rec.clock_out.split(':').map(Number)
    const mins = (oh * 60 + om) - (ih * 60 + im) - (rec.break_minutes || 0)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}時間${m > 0 ? m + '分' : ''}`
  }

  const exportCSV = async () => {
    try {
      const plan = await billingApi.getPlan()
      if (plan.data.plan !== 'pro' && !plan.data.in_trial) {
        // CSVの購入導線もアプリではApp内課金を使う。
        await startProUpgrade({ productId: plan.data.apple_product_id, setLoading: setCheckoutLoading })
        return
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'CSV出力はProプランで利用できます')
      setCheckoutLoading(false)
      return
    }

    const header = '日付,氏名,出勤,退勤,休憩(分),実労働時間\n'
    const rows = records.map(r => {
      const hours = r.clock_in && r.clock_out
        ? (() => {
            const [ih, im] = r.clock_in!.split(':').map(Number)
            const [oh, om] = r.clock_out!.split(':').map(Number)
            return ((oh * 60 + om) - (ih * 60 + im) - (r.break_minutes || 0)) / 60
          })()
        : 0
      return `${r.date},${r.user_name || ''},${r.clock_in || ''},${r.clock_out || ''},${r.break_minutes || 0},${hours.toFixed(1)}`
    }).join('\n')
    const bom = '\uFEFF'
    const blob = new Blob([bom + header + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `タイムカード_${year}年${month}月.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const getStatus = () => {
    if (!todayRecord) return 'not_started'
    if (todayRecord.status === 'closed') return 'finished'
    if (todayRecord.break_start && !todayRecord.break_end) return 'on_break'
    return 'working'
  }

  const status = getStatus()

  // スタッフ未選択時：案内表示
  if (!isAdmin && !selectedStaff) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md">
          <Clock className="w-16 h-16 text-blue-200 mx-auto mb-4" />
          <div className="text-4xl font-mono font-bold text-gray-900 mb-2">
            {currentTime.toTimeString().slice(0, 8)}
          </div>
          <p className="text-gray-500 text-sm mb-1">
            {currentTime.getFullYear()}年{currentTime.getMonth() + 1}月{currentTime.getDate()}日（{'日月火水木金土'[currentTime.getDay()]}）
          </p>
          <p className="text-gray-400 text-sm mt-4">← 左のリストから名前を選んでください</p>
        </div>
      </div>
    )
  }

  const offlineBanner = (pending.length > 0 || !online) && isNative ? (
    <div className={`rounded-xl border p-4 ${pending.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-start gap-3">
        <CloudOff className={`w-5 h-5 mt-0.5 shrink-0 ${pending.length > 0 ? 'text-amber-600' : 'text-gray-400'}`} />
        <div className="flex-1 min-w-0">
          {pending.length > 0 ? (
            <>
              <p className="text-sm font-semibold text-amber-900">未同期の打刻が{pending.length}件あります</p>
              <ul className="mt-1 text-xs text-amber-800 space-y-0.5">
                {pending.slice(0, 3).map(p => (
                  <li key={p.client_uuid}>
                    {p.user_name} — {ACTION_LABELS[p.action]} {p.recorded_at.replace('T', ' ')}
                  </li>
                ))}
                {pending.length > 3 && <li>ほか{pending.length - 3}件</li>}
              </ul>
              <p className="mt-1.5 text-xs text-amber-700">
                打刻は端末に保存されています。通信が戻ると自動で送信されます。
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-600">
              オフラインです。このまま打刻でき、通信が戻ったときに自動で同期されます。
            </p>
          )}
        </div>
        {pending.length > 0 && (
          <button
            onClick={syncNow}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '同期中' : '今すぐ同期'}
          </button>
        )}
      </div>
    </div>
  ) : null

  // 打刻画面
  return (
    <div className="space-y-6">
      {offlineBanner}
      {/* Punch card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Clock className="w-6 h-6 text-blue-600" />
          <h2 className="text-lg font-bold text-gray-900">
            {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日（{'日月火水木金土'[now.getDay()]}）
          </h2>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <div className="text-3xl font-mono font-bold text-gray-900">
            {currentTime.toTimeString().slice(0, 5)}
          </div>
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            status === 'not_started' ? 'bg-gray-100 text-gray-600' :
            status === 'working' ? 'bg-green-100 text-green-700' :
            status === 'on_break' ? 'bg-yellow-100 text-yellow-700' :
            'bg-blue-100 text-blue-700'
          }`}>
            {status === 'not_started' ? '未出勤' :
             status === 'working' ? '勤務中' :
             status === 'on_break' ? '休憩中' : '退勤済み'}
          </div>
        </div>

        {todayRecord && (
          <div className="flex gap-6 text-sm text-gray-600 mb-4">
            {todayRecord.clock_in && <span>出勤: {todayRecord.clock_in}</span>}
            {todayRecord.break_start && <span>休憩開始: {todayRecord.break_start}</span>}
            {todayRecord.break_end && <span>休憩終了: {todayRecord.break_end}</span>}
            {todayRecord.clock_out && <span>退勤: {todayRecord.clock_out}</span>}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          {status === 'not_started' && (
            <button
              onClick={handleClockIn}
              className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 font-medium text-lg shadow-sm"
            >
              <Play className="w-5 h-5" />
              出勤
            </button>
          )}
          {status === 'working' && (
            <>
              <button
                onClick={handleBreakStart}
                className="flex items-center gap-2 px-5 py-3 bg-yellow-500 text-white rounded-xl hover:bg-yellow-600 font-medium shadow-sm"
              >
                <Coffee className="w-5 h-5" />
                休憩開始
              </button>
              <button
                onClick={handleClockOut}
                className="flex items-center gap-2 px-5 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 font-medium shadow-sm"
              >
                <Square className="w-5 h-5" />
                退勤
              </button>
            </>
          )}
          {status === 'on_break' && (
            <button
              onClick={handleBreakEnd}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-lg shadow-sm"
            >
              <Play className="w-5 h-5" />
              休憩終了
            </button>
          )}
          {status === 'finished' && (
            <p className="text-green-600 font-medium py-3">本日の勤務は終了しました</p>
          )}
        </div>
      </div>

      {/* Monthly records */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-gray-200">
          <div className="flex items-center gap-3 w-full sm:w-auto whitespace-nowrap">
            <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-lg font-semibold">{year}年{month}月</span>
            <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            {isAdmin && (
              <select
                value={selectedUserId || ''}
                onChange={e => setSelectedUserId(e.target.value ? parseInt(e.target.value) : undefined)}
                className="min-w-0 flex-1 sm:flex-none min-h-[44px] sm:min-h-0 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">全スタッフ</option>
                {adminStaff.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={exportCSV}
              disabled={checkoutLoading}
              className="flex items-center whitespace-nowrap shrink-0 min-h-[44px] sm:min-h-0 gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              {checkoutLoading ? 'Proへ移動中...' : 'CSV'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="md:hidden divide-y divide-gray-100">
            {records.map(rec => {
              const date = new Date(`${rec.date}T00:00:00`)
              const dayOfWeek = date.getDay()
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
              return (
                <article key={rec.id} className={`p-4 space-y-2 ${isWeekend ? 'bg-red-50/30' : ''}`}>
                  <div className="flex items-center justify-between gap-2 text-sm whitespace-nowrap">
                    <span className={isWeekend ? 'text-red-600' : 'text-gray-900'}>{date.getMonth() + 1}/{date.getDate()}（{'日月火水木金土'[dayOfWeek]}）</span>
                    <span className="font-mono text-gray-900">{rec.clock_in || '-'} → {rec.clock_out || '-'}</span>
                  </div>
                  {isAdmin && <div className="flex items-center gap-2 text-sm text-gray-900"><span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: rec.user_color || '#4A90E2' }} /><span className="break-words min-w-0">{rec.user_name}</span></div>}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-gray-600">休憩{rec.break_minutes || 0}分 ・ 実労働{calcHours(rec)}</p>
                    {isAdmin && <button onClick={() => openEdit(rec)} aria-label={`${rec.date} ${rec.user_name || ''}のタイムカードを編集`} className="min-w-[44px] min-h-[44px] shrink-0 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 className="w-4 h-4" /></button>}
                  </div>
                  {rec.notes && <p className="text-xs text-gray-500 break-words">{rec.notes}</p>}
                </article>
              )
            })}
            {records.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-500">この月のタイムカードデータはありません</p>}
          </div>
          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="text-left px-4 py-3 font-medium">日付</th>
                {isAdmin && <th className="text-left px-4 py-3 font-medium">スタッフ</th>}
                <th className="text-left px-4 py-3 font-medium">出勤</th>
                <th className="text-left px-4 py-3 font-medium">退勤</th>
                <th className="text-left px-4 py-3 font-medium">休憩</th>
                <th className="text-left px-4 py-3 font-medium">実労働</th>
                <th className="text-left px-4 py-3 font-medium">メモ</th>
                {isAdmin && <th className="text-right px-4 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map(rec => {
                const dayOfWeek = new Date(rec.date).getDay()
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
                return (
                  <tr key={rec.id} className={`hover:bg-gray-50 ${isWeekend ? 'bg-red-50/30' : ''}`}>
                    <td className={`px-4 py-3 ${isWeekend ? 'text-red-600' : ''}`}>
                      {rec.date} {'日月火水木金土'[dayOfWeek]}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: rec.user_color || '#4A90E2' }} />
                          {rec.user_name}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono">{rec.clock_in || '-'}</td>
                    <td className="px-4 py-3 font-mono">{rec.clock_out || '-'}</td>
                    <td className="px-4 py-3">{rec.break_minutes ? `${rec.break_minutes}分` : '-'}</td>
                    <td className="px-4 py-3 font-medium">{calcHours(rec)}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[150px] truncate">{rec.notes || ''}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEdit(rec)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
              {records.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 6} className="px-4 py-8 text-center text-gray-500">
                    この月のタイムカードデータはありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold mb-4">タイムカード編集</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">日付</label>
                <input
                  type="date"
                  value={editForm.date}
                  onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">出勤</label>
                  <input
                    type="time"
                    value={editForm.clock_in}
                    onChange={e => setEditForm({ ...editForm, clock_in: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">退勤</label>
                  <input
                    type="time"
                    value={editForm.clock_out}
                    onChange={e => setEditForm({ ...editForm, clock_out: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">休憩（分）</label>
                <input
                  type="number"
                  value={editForm.break_minutes}
                  onChange={e => setEditForm({ ...editForm, break_minutes: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
                <input
                  type="text"
                  value={editForm.notes}
                  onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            {editHistory.length > 0 && (
              <div className="mt-5 pt-4 border-t border-gray-200">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">変更履歴</h4>
                <div className="max-h-40 overflow-y-auto space-y-2">
                  {editHistory.map(h => (
                    <div key={h.id} className="text-xs bg-gray-50 rounded-lg p-2">
                      <div className="flex items-center justify-between text-gray-500 mb-0.5">
                        <span>
                          {h.action === 'update' ? '✏️ 編集' : h.action === 'create' ? '➕ 追加' : '🗑 削除'}
                          {h.edited_by_name ? `（${h.edited_by_name}）` : ''}
                        </span>
                        <span>{h.created_at}</span>
                      </div>
                      {h.action === 'update' ? (
                        <div className="text-gray-700">
                          <span className="line-through text-gray-400">{fmtSnap(h.before_json)}</span>
                          <span className="mx-1">→</span>
                          <span className="font-medium">{fmtSnap(h.after_json)}</span>
                        </div>
                      ) : (
                        <div className="text-gray-700">{fmtSnap(h.after_json || h.before_json)}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditingRecord(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                閉じる
              </button>
              <button onClick={handleEditSave} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
