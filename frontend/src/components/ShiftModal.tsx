import { useState, useEffect } from 'react'
import { X, Trash2, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Shift, User, shiftsApi, shiftRequestsApi } from '../api/client'
import toast from 'react-hot-toast'

interface DayRequest {
  availability: 'available' | 'unavailable' | 'preferred'
  preferred_start: string | null
  preferred_end: string | null
}

const REQ_LABEL: Record<string, string> = {
  available: '出勤可',
  preferred: '希望',
  unavailable: '出勤不可',
}
const REQ_MARK: Record<string, string> = {
  available: '○',
  preferred: '◎',
  unavailable: '×',
}

interface ShiftModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: () => void
  date?: Date | null
  shift?: Shift | null
  users: User[]
}

export default function ShiftModal({
  isOpen,
  onClose,
  onSave,
  date,
  shift,
  users,
}: ShiftModalProps) {
  const [userId, setUserId] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [breakMinutes, setBreakMinutes] = useState(60)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [dayRequests, setDayRequests] = useState<Record<number, DayRequest>>({})

  useEffect(() => {
    if (shift) {
      setUserId(String(shift.user_id))
      setStartTime(shift.start_time)
      setEndTime(shift.end_time)
      setBreakMinutes(shift.break_minutes)
      setNotes(shift.notes || '')
    } else {
      setUserId(users[0]?.id ? String(users[0].id) : '')
      setStartTime('09:00')
      setEndTime('17:00')
      setBreakMinutes(60)
      setNotes('')
    }
  }, [shift, users, isOpen])

  // この日に提出されている希望シフトを取得（希望を見ながらシフトを確定できるように）
  useEffect(() => {
    if (!isOpen || !date) {
      setDayRequests({})
      return
    }
    const dateStr = format(date, 'yyyy-MM-dd')
    shiftRequestsApi
      .getAll({ year: date.getFullYear(), month: date.getMonth() + 1 })
      .then(res => {
        const map: Record<number, DayRequest> = {}
        for (const r of res.data.requests || []) {
          if (r.date === dateStr) {
            map[r.user_id] = {
              availability: r.availability,
              preferred_start: r.preferred_start || null,
              preferred_end: r.preferred_end || null,
            }
          }
        }
        setDayRequests(map)
      })
      .catch(() => setDayRequests({}))
  }, [isOpen, date])

  const selectedRequest = userId ? dayRequests[parseInt(userId)] : undefined
  const canApplyPreferredTime = !!(selectedRequest?.preferred_start && selectedRequest?.preferred_end)

  const applyPreferredTime = () => {
    if (!selectedRequest?.preferred_start || !selectedRequest?.preferred_end) return
    setStartTime(selectedRequest.preferred_start.slice(0, 5))
    setEndTime(selectedRequest.preferred_end.slice(0, 5))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId || !date) return

    setLoading(true)
    try {
      const dateStr = format(date, 'yyyy-MM-dd')
      if (shift) {
        await shiftsApi.update(shift.id, {
          user_id: parseInt(userId),
          date: dateStr,
          start_time: startTime,
          end_time: endTime,
          break_minutes: breakMinutes,
          notes,
        })
        toast.success('シフトを更新しました')
      } else {
        await shiftsApi.create({
          user_id: parseInt(userId),
          date: dateStr,
          start_time: startTime,
          end_time: endTime,
          break_minutes: breakMinutes,
          notes,
        })
        toast.success('シフトを作成しました')
      }
      onSave()
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!shift) return
    if (!confirm('このシフトを削除してもよいですか？')) return

    setLoading(true)
    try {
      await shiftsApi.delete(shift.id)
      toast.success('シフトを削除しました')
      onSave()
      onClose()
    } catch {
      toast.error('削除に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const dateLabel = date ? format(date, 'M月d日 (EEE)', { locale: ja }) : ''

  // Calculate work hours
  const calcHours = () => {
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    const totalMins = (eh * 60 + em) - (sh * 60 + sm) - breakMinutes
    if (totalMins <= 0) return '-'
    return `${Math.floor(totalMins / 60)}時間${totalMins % 60 > 0 ? totalMins % 60 + '分' : ''}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {shift ? 'シフト編集' : 'シフト追加'}
            {dateLabel && <span className="ml-2 text-sm font-normal text-gray-500">{dateLabel}</span>}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Staff selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">スタッフ</label>
            <select
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className="input-field"
              required
            >
              <option value="">選択してください</option>
              {users.map(u => {
                const req = dayRequests[u.id]
                const compact = (t: string) => t.slice(0, 5).replace(/:00$/, '')
                const timeText = req?.preferred_start && req?.preferred_end
                  ? ` ${compact(req.preferred_start)}-${compact(req.preferred_end)}`
                  : ''
                const mark = req ? ` ${REQ_MARK[req.availability]}${REQ_LABEL[req.availability]}${timeText}` : ''
                return (
                  <option key={u.id} value={u.id}>{u.name}{mark}</option>
                )
              })}
            </select>
          </div>

          {/* Selected staff's request for this day */}
          {selectedRequest && (
            <div className={`rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-sm ${
              selectedRequest.availability === 'unavailable'
                ? 'bg-red-50 text-red-700 border border-red-200'
                : selectedRequest.availability === 'preferred'
                  ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
                  : 'bg-green-50 text-green-800 border border-green-200'
            }`}>
              <span>
                この日の希望: <b>{REQ_LABEL[selectedRequest.availability]}</b>
                {selectedRequest.preferred_start && selectedRequest.preferred_end && (
                  <> {selectedRequest.preferred_start.slice(0, 5)}〜{selectedRequest.preferred_end.slice(0, 5)}</>
                )}
              </span>
              {canApplyPreferredTime && selectedRequest.availability !== 'unavailable' && (
                <button
                  type="button"
                  onClick={applyPreferredTime}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white border border-current rounded-lg hover:opacity-80"
                >
                  <Clock className="w-3 h-3" />
                  希望時間を反映
                </button>
              )}
            </div>
          )}

          {/* Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">終了時間</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="input-field"
                required
              />
            </div>
          </div>

          {/* Break */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">休憩時間</label>
            <select
              value={breakMinutes}
              onChange={e => setBreakMinutes(parseInt(e.target.value))}
              className="input-field"
            >
              <option value={0}>なし</option>
              <option value={30}>30分</option>
              <option value={45}>45分</option>
              <option value={60}>1時間</option>
              <option value={90}>1時間30分</option>
              <option value={120}>2時間</option>
            </select>
          </div>

          {/* Work hours preview */}
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-sm text-blue-700">
              実働時間: <span className="font-semibold">{calcHours()}</span>
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="任意"
              className="input-field"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {shift && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="btn-danger flex items-center gap-1"
              >
                <Trash2 className="w-4 h-4" />
                シフトを削除
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={onClose} className="btn-secondary">
                閉じる
              </button>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? '保存中...' : shift ? '更新' : '追加'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
