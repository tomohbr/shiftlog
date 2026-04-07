import { useState, useEffect, useCallback } from 'react'
import { format, addMonths, subMonths } from 'date-fns'
import { Users, Calendar, Clock, CheckCircle } from 'lucide-react'
import ShiftCalendar from '../components/ShiftCalendar'
import ShiftModal from '../components/ShiftModal'
import MonthNavigator from '../components/MonthNavigator'
import { shiftsApi, usersApi, Shift, User } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

export default function DashboardPage() {
  const { user, selectedCompany } = useAuth()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [shifts, setShifts] = useState<Shift[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null)
  const [isPublished, setIsPublished] = useState(false)

  const loadData = useCallback(async () => {
    if (!selectedCompany) return
    setLoading(true)
    try {
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth() + 1

      const [shiftsRes, usersRes, pubRes] = await Promise.all([
        shiftsApi.getAll({ year, month }),
        usersApi.getAll(),
        shiftsApi.getPublication(year, month),
      ])

      setShifts(shiftsRes.data.shifts)
      setUsers(usersRes.data.users.filter((u: User) => u.company_role === 'staff' || u.role === 'staff'))
      setIsPublished(pubRes.data.publication?.is_published === 1)
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
  const todayShifts = shifts.filter(s => s.date === todayStr)
  const totalShifts = shifts.length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <Calendar className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">今月のシフト</p>
            <p className="text-2xl font-bold text-gray-900">{totalShifts}</p>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
            <Clock className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">本日の出勤</p>
            <p className="text-2xl font-bold text-gray-900">{todayShifts.length}</p>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
            <Users className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">スタッフ数</p>
            <p className="text-2xl font-bold text-gray-900">{users.length}</p>
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <MonthNavigator
            currentDate={currentDate}
            onPrev={() => setCurrentDate(d => subMonths(d, 1))}
            onNext={() => setCurrentDate(d => addMonths(d, 1))}
            onToday={() => setCurrentDate(new Date())}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handlePublish}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isPublished
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <CheckCircle className="w-4 h-4" />
              {isPublished ? '公開中' : 'シフト公開'}
            </button>
          </div>
        </div>

        {users.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-3">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: u.color }} />
                <span className="text-xs text-gray-600">{u.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <ShiftCalendar
              currentDate={currentDate}
              shifts={shifts}
              onDayClick={handleDayClick}
              onShiftClick={handleShiftClick}
              isAdmin={true}
            />
          )}
        </div>
      </div>

      <ShiftModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setSelectedShift(null) }}
        onSave={loadData}
        date={selectedDate}
        shift={selectedShift}
        users={users}
      />
    </div>
  )
}
