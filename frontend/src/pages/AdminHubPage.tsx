import { useState, useMemo } from 'react'
import { Shield, Inbox, FileText, Users, TrendingUp } from 'lucide-react'
import SuperAdminPage from './SuperAdminPage'
import FeedbackAdminPage from './FeedbackAdminPage'
import AuditLogPage from './AuditLogPage'
import CompanyActivityPage from './CompanyActivityPage'
import { useAuth } from '../contexts/AuthContext'

type Tab = 'activity' | 'users' | 'feedback' | 'audit'

const TABS: { id: Tab; label: string; icon: any; superOnly: boolean }[] = [
  { id: 'activity', label: '利用状況', icon: TrendingUp, superOnly: true },
  { id: 'users', label: 'ユーザー管理', icon: Users, superOnly: true },
  { id: 'feedback', label: 'フィードバック', icon: Inbox, superOnly: true },
  { id: 'audit', label: '監査ログ', icon: FileText, superOnly: false },
]

export default function AdminHubPage() {
  const { user } = useAuth()
  const isSuper = user?.role === 'super_admin'
  const visible = useMemo(() => TABS.filter(t => !t.superOnly || isSuper), [isSuper])
  const [tab, setTab] = useState<Tab>(visible[0]?.id || 'audit')

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center gap-2">
        <Shield className="w-6 h-6 text-indigo-600" />
        <h2 className="text-2xl font-bold text-gray-900">管理ハブ</h2>
      </div>

      <div className="flex border-b border-gray-200 overflow-x-auto">
        {visible.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      <div>
        {tab === 'activity' && isSuper && <CompanyActivityPage />}
        {tab === 'users' && isSuper && <SuperAdminPage />}
        {tab === 'feedback' && isSuper && <FeedbackAdminPage />}
        {tab === 'audit' && <AuditLogPage />}
      </div>
    </div>
  )
}
