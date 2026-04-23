import { useState, useEffect, useCallback } from 'react'
import { format, addMonths, subMonths } from 'date-fns'
import { Users, Calendar, Clock, CheckCircle, AlertTriangle, DollarSign, Repeat } from 'lucide-react'
import { Link } from 'react-router-dom'
import ShiftCalendar from '../components/ShiftCalendar'
import ShiftModal from '../components/ShiftModal'
import MonthNavigator from '../components/MonthNavigator'
import { shiftsApi, usersApi, laborApi, swapsApi, Shift, User } from '../api/client'
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

  const [monthlyLabor, setMonthlyLabor] = useState<number>(0)
  const [alertCount, setAlertCount] = useState<number>(0)
  const [pendingSwaps, setPendingSwaps] = useState<number>(0)

  useEffect(() => {
    if (!selectedCompany) return
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1
    Promise.all([
      laborApi.getCosts(year, month).catch(() => null),
      laborApi.getAlerts(year, month).catch(() => null),
      swapsApi.list().catch(() => null),
    ]).then(([c, a, sw]) => {
      setMonthlyLabor((c?.data as any)?.total || 0)
      setAlertCount(((a?.data as any)?.alerts || []).length)
      setPendingSwaps(((sw?.data as any)?.swaps || []).filter((s: any) => s.status === 'pending').length)
    })
  }, [currentDate, selectedCompany, shifts])

  const showOnboarding = users.length === 0 || shifts.length === 0

  return (
    <div className="space-y-6">
      {showOnboarding && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-gray-900 mb-2">はじめの3ステップ</h3>
              <div className="grid sm:grid-cols-3 gap-2 text-sm">
                <Link to="/stores" className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${true ? 'bg-white border-gray-200 hover:border-blue-400' : 'opacity-50'}`}>
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">1</span>
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
              </div>
              <Link to="/help" className="inline-block mt-3 text-xs text-blue-700 hover:underline">使い方ヘルプを見る →</Link>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="card flex items-center gap-3 p-4">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <Calendar className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">今月のシフト</p>
            <p className="text-xl font-bold text-gray-900">{totalShifts}</p>
          </div>
        </div>

        <div className="card flex items-center gap-3 p-4">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <Clock className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">本日の出勤</p>
            <p className="text-xl font-bold text-gray-900">{todayShifts.length}</p>
          </div>
        </div>

        <div className="card flex items-center gap-3 p-4">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">スタッフ数</p>
            <p className="text-xl font-bold text-gray-900">{users.length}</p>
          </div>
        </div>

        <Link to="/labor" className="card flex items-center gap-3 p-4 hover:ring-2 hover:ring-yellow-400 transition">
          <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">今月の人件費</p>
            <p className="text-xl font-bold text-gray-900">¥{monthlyLabor.toLocaleString()}</p>
          </div>
        </Link>

        <Link to="/labor" className={`card flex items-center gap-3 p-4 hover:ring-2 hover:ring-red-400 transition ${alertCount > 0 ? 'bg-red-50 border-red-200' : ''}`}>
          <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">労務アラート</p>
            <p className="text-xl font-bold text-gray-900">{alertCount}</p>
          </div>
        </Link>

        <Link to="/swaps" className={`card flex items-center gap-3 p-4 hover:ring-2 hover:ring-orange-400 transition ${pendingSwaps > 0 ? 'bg-orange-50 border-orange-200' : ''}`}>
          <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
            <Repeat className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">交代リクエスト</p>
            <p className="text-xl font-bold text-gray-900">{pendingSwaps}</p>
          </div>
        </Link>
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
