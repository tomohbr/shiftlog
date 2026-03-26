import { useState, useEffect } from 'react'
import { X, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Shift, User, shiftsApi } from '../api/client'
import toast from 'react-hot-toast'

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
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

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
                削除
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={onClose} className="btn-secondary">
                キャンセル
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
