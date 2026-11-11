import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { usersApi, User, timecardsApi, TimeRecord } from '../api/client'
import { useAuth } from './AuthContext'

interface KioskContextType {
  staffList: User[]
  selectedStaff: User | null
  setSelectedStaff: (user: User | null) => void
  staffStatuses: Record<number, TimeRecord | null>
  refreshStaffStatus: (userId: number) => void
  refreshAllStatuses: () => void
}

const KioskContext = createContext<KioskContextType | null>(null)

export function KioskProvider({ children }: { children: ReactNode }) {
  const { user, selectedCompany } = useAuth()
  const [staffList, setStaffList] = useState<User[]>([])
  const [selectedStaff, setSelectedStaff] = useState<User | null>(null)
  const [staffStatuses, setStaffStatuses] = useState<Record<number, TimeRecord | null>>({})

  // スタッフ一覧と今日の打刻状況は、スタッフの画面（左の一覧・打刻）でしか使わない。
  // 管理者のときに読むと、画面を開くたびに人数ぶんのリクエストが増えるだけなので読まない。
  const needsStaffList = !!user && user.role === 'staff'

  // Fetch staff list when company changes
  useEffect(() => {
    if (!selectedCompany || !needsStaffList) { setStaffList([]); return }
    usersApi.getAll().then(res => {
      const staffOnly = res.data.users.filter(u => u.role === 'staff')
      setStaffList(staffOnly)
    }).catch(() => {})
  }, [selectedCompany, needsStaffList])

  // Fetch all staff statuses
  const refreshAllStatuses = () => {
    staffList.forEach(s => {
      timecardsApi.getToday(s.id).then(r => {
        setStaffStatuses(prev => ({ ...prev, [s.id]: r.data.record }))
      }).catch(() => {})
    })
  }

  // Refresh statuses when staff list loads
  useEffect(() => {
    if (staffList.length > 0) refreshAllStatuses()
  }, [staffList])

  // 自分のスマホで入ったスタッフは、最初から自分が選ばれている状態にする。
  // （お店のタブレットを共用するときは、左の一覧から名前を押して切り替える）
  useEffect(() => {
    if (selectedStaff || staffList.length === 0 || !user) return
    const me = staffList.find(s => s.id === user.id)
    if (me) setSelectedStaff(me)
  }, [staffList, user, selectedStaff])

  // 会社を切り替えたら選び直す
  useEffect(() => { setSelectedStaff(null) }, [selectedCompany?.id])

  const refreshStaffStatus = (userId: number) => {
    timecardsApi.getToday(userId).then(r => {
      setStaffStatuses(prev => ({ ...prev, [userId]: r.data.record }))
    }).catch(() => {})
  }

  return (
    <KioskContext.Provider value={{
      staffList,
      selectedStaff,
      setSelectedStaff,
      staffStatuses,
      refreshStaffStatus,
      refreshAllStatuses,
    }}>
      {children}
    </KioskContext.Provider>
  )
}

export function useKiosk() {
  const ctx = useContext(KioskContext)
  if (!ctx) throw new Error('useKiosk must be used within KioskProvider')
  return ctx
}
