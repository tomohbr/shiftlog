import { ReactNode, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useKiosk } from '../contexts/KioskContext'
import {
  LayoutDashboard,
  Users,
  Calendar,
  BarChart2,
  Store,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Building2,
  Clock,
  ChevronDown,
  Settings,
  ClipboardList,
  DollarSign,
  AlertCircle,
  Copy,
  MessageCircle,
  Shield,
  HelpCircle,
  MessageSquare,
  Inbox,
  Tag,
  Repeat,
  FileText,
} from 'lucide-react'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { user, companies, selectedCompany, logout, selectCompany } = useAuth()
  const { staffList, selectedStaff, setSelectedStaff, staffStatuses } = useKiosk()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false)

  const isAdminRole = user?.role === 'admin' || user?.role === 'super_admin'
  const isStaff = !isAdminRole

  const adminNavItems = [
    { path: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
    { path: '/shifts', label: 'シフト管理', icon: Calendar },
    { path: '/shift-requests', label: '希望シフト収集', icon: ClipboardList },
    { path: '/templates', label: 'テンプレート', icon: Copy },
    { path: '/timecards', label: 'タイムカード', icon: Clock },
    { path: '/staff', label: 'スタッフ管理', icon: Users },
    { path: '/labor', label: '人件費・売上', icon: DollarSign },
    { path: '/report', label: '勤務集計', icon: BarChart2 },
    { path: '/absence', label: '欠勤・ヘルプ', icon: AlertCircle },
    { path: '/swaps', label: 'シフト交代', icon: Repeat },
    { path: '/skills', label: 'スキル管理', icon: Tag },
    { path: '/stores', label: '店舗管理', icon: Store },
    { path: '/companies', label: '会社管理', icon: Building2 },
    { path: '/line-settings', label: 'LINE通知', icon: MessageCircle },
    { path: '/audit-logs', label: '監査ログ', icon: FileText },
    { path: '/settings', label: '設定', icon: Settings },
    { path: '/help', label: '使い方ヘルプ', icon: HelpCircle },
    { path: '/feedback', label: 'フィードバック', icon: MessageSquare },
    ...(user?.role === 'super_admin'
      ? [
          { path: '/admin', label: 'システム管理', icon: Shield },
          { path: '/feedback-admin', label: 'フィードバック管理', icon: Inbox },
        ]
      : []),
  ]

  const staffNavItems = [
    { path: '/timecards', label: 'タイムカード', icon: Clock },
    { path: '/shift-requests', label: 'シフト希望提出', icon: ClipboardList },
    { path: '/swaps', label: 'シフト交代', icon: Repeat },
    { path: '/absence', label: '欠勤連絡', icon: AlertCircle },
    { path: '/help', label: '使い方ヘルプ', icon: HelpCircle },
    { path: '/feedback', label: 'フィードバック', icon: MessageSquare },
  ]

  const navItems = isAdminRole ? adminNavItems : staffNavItems
  const isActive = (path: string) => location.pathname === path

  const getStatusInfo = (record: any) => {
    if (!record) return { text: '未出勤', color: 'bg-gray-300' }
    if (record.status === 'closed') return { text: '退勤済', color: 'bg-blue-400' }
    if (record.break_start && !record.break_end) return { text: '休憩中', color: 'bg-yellow-400' }
    return { text: '勤務中', color: 'bg-green-400' }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 lg:translate-x-0 lg:static lg:inset-auto lg:z-auto flex flex-col ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">シフトログ</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Company selector */}
        {selectedCompany && companies.length > 0 && !isStaff && (
          <div className="px-4 py-3 border-b border-gray-100 relative shrink-0">
            <button
              onClick={() => setCompanyDropdownOpen(!companyDropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="text-left min-w-0">
                <p className="text-xs text-gray-500">会社</p>
                <p className="text-sm font-medium text-gray-800 truncate">{selectedCompany.name}</p>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${companyDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {companyDropdownOpen && (
              <div className="absolute left-4 right-4 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                {companies.map(c => (
                  <button
                    key={c.id}
                    onClick={() => {
                      selectCompany(c)
                      setCompanyDropdownOpen(false)
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors ${
                      c.id === selectedCompany.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Navigation links */}
        {navItems.length > 0 && (
          <nav className="px-3 py-4 space-y-1 overflow-y-auto shrink-0">
            {navItems.map(item => {
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.path)
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive(item.path) ? 'text-blue-600' : 'text-gray-400'}`} />
                  {item.label}
                  {isActive(item.path) && <ChevronRight className="w-4 h-4 ml-auto text-blue-600" />}
                </Link>
              )
            })}
          </nav>
        )}

        {/* Staff: Staff member list in sidebar */}
        {isStaff && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">スタッフ一覧</p>
            </div>
            <div className="px-2 py-2 space-y-0.5">
              {staffList.map(s => {
                const statusInfo = getStatusInfo(staffStatuses[s.id])
                const isSelected = selectedStaff?.id === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedStaff(s)
                      setSidebarOpen(false)
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                      isSelected
                        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                      style={{ backgroundColor: s.color || '#4A90E2' }}
                    >
                      {s.name.charAt(0)}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className={`font-medium truncate ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                        {s.name}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${statusInfo.color}`} />
                        <span className="text-xs text-gray-500">{statusInfo.text}</span>
                      </div>
                    </div>
                    {isSelected && <ChevronRight className="w-4 h-4 text-blue-600 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="border-t border-gray-200 p-4 shrink-0">
          {!isStaff && (
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
                {user?.name?.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
                <p className="text-xs text-gray-500 truncate">管理者</p>
              </div>
            </div>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            ログアウト
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 gap-4 sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-gray-500 hover:text-gray-700">
            <Menu className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">
            {isStaff
              ? (selectedStaff ? `${selectedStaff.name} - タイムカード` : 'タイムカード')
              : (navItems.find(i => isActive(i.path))?.label || 'シフトログ')
            }
          </h1>
        </header>

        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
