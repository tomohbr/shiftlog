import { useState } from 'react'
import { Building2, Store } from 'lucide-react'
import CompanyPage from './CompanyPage'
import StorePage from './StorePage'

type Tab = 'company' | 'store'

export default function OrganizationPage() {
  const [tab, setTab] = useState<Tab>('store')

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">会社・店舗</h2>
        <p className="text-sm text-gray-500 mt-1">所属会社と各店舗を管理します</p>
      </div>

      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab('store')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
            tab === 'store' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <Store className="w-4 h-4" />
          店舗
        </button>
        <button
          onClick={() => setTab('company')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
            tab === 'company' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          会社情報
        </button>
      </div>

      <div>
        {tab === 'store' && <StorePage />}
        {tab === 'company' && <CompanyPage />}
      </div>
    </div>
  )
}
