import { useState, useEffect, useCallback } from 'react'
import { timecardsApi, usersApi, TimeRecord, User } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { useKiosk } from '../contexts/KioskContext'
import { Clock, Play, Square, Coffee, Edit2, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import toast from 'react-hot-toast'

export default function TimecardPage() {
  const { user } = useAuth()
  const { selectedStaff, refreshStaffStatus } = useKiosk()
  const isAdmin = user?.role === 'admin'

  const [todayRecord, setTodayRecord] = useState<TimeRecord | null>(null)
  const [records, setRecords] = useState<TimeRecord[]>([])
  const [adminStaff, setAdminStaff] = useState<User[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(undefined)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [loading, setLoading] = useState(true)
  const [editingRecord, setEditingRecord] = useState<TimeRecord | null>(null)
  const [editForm, setEditForm] = useState({ date: '', clock_in: '', clock_out: '', break_minutes: 0, notes: '' })
  const [currentTime, setCurrentTime] = useState(new Date())

  const now = new Date()

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

  const handleClockIn = async () => {
    try {
      await timecardsApi.clockIn(activeUserId)
      toast.success(`${selectedStaff?.name || ''}出勤しました`)
      fetchToday()
      fetchRecords()
      if (activeUserId) refreshStaffStatus(activeUserId)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラー')
    }
  }

  const handleClockOut = async () => {
    try {
      await timecardsApi.clockOut(activeUserId)
      toast.success(`${selectedStaff?.name || ''}退勤しました`)
      fetchToday()
      fetchRecords()
      if (activeUserId) refreshStaffStatus(activeUserId)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラー')
    }
  }

  const handleBreakStart = async () => {
    try {
      await timecardsApi.breakStart(activeUserId)
      toast.success('休憩開始')
      fetchToday()
      if (activeUserId) refreshStaffStatus(activeUserId)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラー')
    }
  }

  const handleBreakEnd = async () => {
    try {
      await timecardsApi.breakEnd(activeUserId)
      toast.success('休憩終了')
      fetchToday()
      if (activeUserId) refreshStaffStatus(activeUserId)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラー')
    }
  }

  const openEdit = (rec: TimeRecord) => {
    setEditingRecord(rec)
    setEditForm({
      date: rec.date || '',
      clock_in: rec.clock_in || '',
      clock_out: rec.clock_out || '',
      break_minutes: rec.break_minutes || 0,
      notes: rec.notes || '',
    })
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

  const exportCSV = () => {
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

  // 打刻画面
  return (
    <div className="space-y-6">
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
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-lg font-semibold">{year}年{month}月</span>
            <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <select
                value={selectedUserId || ''}
                onChange={e => setSelectedUserId(e.target.value ? parseInt(e.target.value) : undefined)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">全スタッフ</option>
                {adminStaff.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditingRecord(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                キャンセル
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
