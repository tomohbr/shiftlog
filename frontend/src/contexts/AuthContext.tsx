import { getAttribution } from '../lib/attribution'
import { track } from '../lib/analytics'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api, Company } from '../api/client'
import { unregisterPush } from '../native/push'
import { clearQuickLogin } from '../native/biometric'

interface User {
  id: number
  email: string
  name: string
  role: string
}

interface AuthContextType {
  user: User | null
  companies: Company[]
  selectedCompany: Company | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name: string, companyName: string) => Promise<void>
  pinLogin?: (companyPin: string, userId: number) => Promise<void>
  logout: () => void
  selectCompany: (company: Company) => void
  justRegistered: boolean
  clearJustRegistered: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [justRegistered, setJustRegistered] = useState(false)
  const clearJustRegistered = () => setJustRegistered(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
      api.get('/auth/me')
        .then(res => {
          setUser(res.data.user)
          setCompanies(res.data.companies || [])
          // Restore selected company
          const savedId = localStorage.getItem('selectedCompanyId')
          if (savedId && res.data.companies) {
            const found = res.data.companies.find((c: Company) => c.id === parseInt(savedId))
            if (found) setSelectedCompany(found)
            else if (res.data.companies.length > 0) {
              setSelectedCompany(res.data.companies[0])
              localStorage.setItem('selectedCompanyId', res.data.companies[0].id.toString())
            }
          } else if (res.data.companies?.length > 0) {
            setSelectedCompany(res.data.companies[0])
            localStorage.setItem('selectedCompanyId', res.data.companies[0].id.toString())
          }
        })
        .catch(() => {
          localStorage.removeItem('token')
          localStorage.removeItem('selectedCompanyId')
          delete api.defaults.headers.common['Authorization']
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password })
    const { token, user: u, companies: comps } = res.data
    localStorage.setItem('token', token)
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
    setUser(u)
    setCompanies(comps || [])
    if (comps && comps.length > 0) {
      setSelectedCompany(comps[0])
      localStorage.setItem('selectedCompanyId', comps[0].id.toString())
    }
  }

  const register = async (email: string, password: string, name: string, companyName: string) => {
    const res = await api.post('/auth/register', { email, password, name, companyName, attribution: getAttribution() })
    // 登録がサーバーで完了した時点で計測する。
    track('register_complete')
    const { token, user: u, companies: comps } = res.data
    localStorage.setItem('token', token)
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
    setUser(u)
    setCompanies(comps || [])
    if (comps && comps.length > 0) {
      setSelectedCompany(comps[0])
      localStorage.setItem('selectedCompanyId', comps[0].id.toString())
    }
    setJustRegistered(true)
  }

  const pinLogin = async (companyPin: string, userId: number) => {
    const res = await api.post('/auth/pin-login', { companyPin, userId })
    const { token, user: u, companies: comps, selectedCompanyId } = res.data
    localStorage.setItem('token', token)
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
    setUser(u)
    setCompanies(comps || [])
    if (selectedCompanyId) {
      const found = comps?.find((c: Company) => c.id === selectedCompanyId)
      if (found) {
        setSelectedCompany(found)
        localStorage.setItem('selectedCompanyId', found.id.toString())
      }
    } else if (comps && comps.length > 0) {
      setSelectedCompany(comps[0])
      localStorage.setItem('selectedCompanyId', comps[0].id.toString())
    }
  }

  const logout = () => {
    // この端末宛の通知を止め、生体認証のかんたんログインも消す。
    // 共有端末で前のスタッフに通知が飛び続けるのを防ぐため。
    void unregisterPush()
    void clearQuickLogin()
    localStorage.removeItem('token')
    localStorage.removeItem('selectedCompanyId')
    setJustRegistered(false)
    delete api.defaults.headers.common['Authorization']
    setUser(null)
    setCompanies([])
    setSelectedCompany(null)
  }

  const selectCompany = (company: Company) => {
    setSelectedCompany(company)
    localStorage.setItem('selectedCompanyId', company.id.toString())
  }

  return (
    <AuthContext.Provider value={{ user, companies, selectedCompany, loading, login, register, pinLogin, logout, selectCompany, justRegistered, clearJustRegistered }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
