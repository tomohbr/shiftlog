import { useState, useEffect, useCallback } from 'react'
import { format, addMonths, subMonths, getDaysInMonth, startOfMonth, getDay } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import MonthNavigator from '../components/MonthNavigator'
import ShiftModal from '../components/ShiftModal'
import { shiftsApi, usersApi, Shift, User } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export default function ShiftEditPage() {
  const { user } = useAuth()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [shifts, setShifts] = useState<Shift[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null)
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table')
  const [filterUserId, setFilterUserId] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth() + 1
      const [shiftsRes, usersRes] = await Promise.all([
        shiftsApi.getAll({ year, month }),
        usersApi.getAll(),
      ])
      setShifts(shiftsRes.data.shifts)
      setUsers(usersRes.data.users.filter((u: User) => u.company_role === 'staff' || u.role === 'staff'))
    } catch {
      toast.error('データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [currentDate])

  useEffect(() => { loadData() }, [loadData])

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth() + 1
  const daysInMonth = getDaysInMonth(currentDate)

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(year, currentDate.getMonth(), i + 1)
    return {
      date: format(d, 'yyyy-MM-dd'),
      label: i + 1,
      dayOfWeek: d.getDay(),
    }
  })

  const filteredShifts = filterUserId
    ? shifts.filter(s => s.user_id === filterUserId)
    : shifts

  const shiftByUserDate: Record<string, Shift[]> = {}
  for (const shift of filteredShifts) {
    const key = `${shift.user_id}-${shift.date}`
    if (!shiftByUserDate[key]) shiftByUserDate[key] = []
    shiftByUserDate[key].push(shift)
  }

  const displayedUsers = filterUserId ? users.filter(u => u.id === filterUserId) : users

  const handleCellClick = (userId: number, date: string) => {
    const [y, m, d] = date.split('-').map(Number)
    setSelectedDate(new Date(y, m - 1, d))
    const existingShifts = shiftByUserDate[`${userId}-${date}`]
    if (existingShifts?.length === 1) {
      setSelectedShift(existingShifts[0])
    } else {
      setSelectedShift(null)
    }
    setModalOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <MonthNavigator
          currentDate={currentDate}
          onPrev={() => setCurrentDate(d => subMonths(d, 1))}
          onNext={() => setCurrentDate(d => addMonths(d, 1))}
          onToday={() => setCurrentDate(new Date())}
        />

        <div className="flex items-center gap-2">
          <select
            value={filterUserId || ''}
            onChange={e => setFilterUserId(e.target.value ? parseInt(e.target.value) : null)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全スタッフ</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          <button
            onClick={() => { setSelectedDate(new Date()); setSelectedShift(null); setModalOpen(true) }}
            className="btn-primary flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            シフト追加
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {/* Shift table - horizontal scroll */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: `${daysInMonth * 60 + 160}px` }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 z-10 bg-gray-50 text-left px-4 py-3 text-xs font-semibold text-gray-500 border-r border-gray-200 min-w-[140px]">
                    スタッフ
                  </th>
                  {days.map(day => {
                    const isSun = day.dayOfWeek === 0
                    const isSat = day.dayOfWeek === 6
                    const isToday = day.date === format(new Date(), 'yyyy-MM-dd')
                    return (
                      <th
                        key={day.date}
                        className={`text-center py-2 text-xs font-medium border-r border-gray-100 min-w-[52px] ${
                          isToday ? 'bg-blue-50' :
                          isSun ? 'bg-red-50' :
                          isSat ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className={isSun ? 'text-red-500' : isSat ? 'text-blue-500' : 'text-gray-600'}>
                          {day.label}
                        </div>
                        <div className={`text-xs ${isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-gray-400'}`}>
                          {DAY_LABELS[day.dayOfWeek]}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedUsers.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50/50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 border-r border-gray-200">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: u.color }}
                        >
                          {u.name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-gray-800 truncate max-w-[90px]">{u.name}</span>
                      </div>
                    </td>
                    {days.map(day => {
                      const cellShifts = shiftByUserDate[`${u.id}-${day.date}`] || []
                      const isSun = day.dayOfWeek === 0
                      const isSat = day.dayOfWeek === 6
                      const isToday = day.date === format(new Date(), 'yyyy-MM-dd')

                      return (
                        <td
                          key={day.date}
                          onClick={() => handleCellClick(u.id, day.date)}
                          className={`text-center py-1 px-0.5 border-r border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors ${
                            isToday ? 'bg-blue-50/50' :
                            isSun ? 'bg-red-50/30' :
                            isSat ? 'bg-blue-50/30' : ''
                          }`}
                        >
                          {cellShifts.map(shift => (
                            <div
                              key={shift.id}
                              className="text-white rounded text-xs py-0.5 px-1 mb-0.5 leading-tight"
                              style={{ backgroundColor: u.color }}
                            >
                              <div className="font-medium">{shift.start_time.slice(0, 5)}</div>
                              <div className="opacity-80">~{shift.end_time.slice(0, 5)}</div>
                            </div>
                          ))}
                          {cellShifts.length === 0 && (
                            <span className="text-gray-200 text-xs hover:text-gray-300">+</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {displayedUsers.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                スタッフが登録されていません
              </div>
            )}
          </div>
        </div>
      )}

      {/* Monthly summary */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">今月の集計</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {users.map(u => {
            const userShifts = shifts.filter(s => s.user_id === u.id)
            const totalMins = userShifts.reduce((sum, s) => {
              const [sh, sm] = s.start_time.split(':').map(Number)
              const [eh, em] = s.end_time.split(':').map(Number)
              return sum + (eh * 60 + em) - (sh * 60 + sm) - s.break_minutes
            }, 0)
            return (
              <div key={u.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: u.color }} />
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 truncate">{u.name}</p>
                  <p className="text-sm font-semibold text-gray-800">
                    {Math.floor(totalMins / 60)}h{totalMins % 60 > 0 ? `${totalMins % 60}m` : ''}
                  </p>
                </div>
              </div>
            )
          })}
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
