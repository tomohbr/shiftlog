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

  // Fetch staff list when company changes
  useEffect(() => {
    if (!selectedCompany) return
    usersApi.getAll().then(res => {
      const staffOnly = res.data.users.filter(u => u.role === 'staff')
      setStaffList(staffOnly)
    }).catch(() => {})
  }, [selectedCompany])

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
