import { useEffect, useState } from 'react'
import { Building2, TrendingUp, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { api } from '../api/client'

interface CompanyUsage {
  id: number
  name: string
  company_pin: string
  created_at: string
  user_count: number
  store_count: number
  shift_count: number
  timecard_count: number
  last_timecard_at: string | null
  last_shift_at: string | null
  shifts_last_7d: number
  clockins_last_7d: number
  plan: string
}

interface Funnel {
  total: number
  withStore: number
  withStaff: number
  withShift: number
  withTimecard: number
  activeLast7d: number
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso.replace(' ', 'T') + 'Z').getTime()
  return Math.floor((Date.now() - d) / (24 * 60 * 60 * 1000))
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0
}

export default function CompanyActivityPage() {
  const [companies, setCompanies] = useState<CompanyUsage[]>([])
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [c, f] = await Promise.all([
        api.get<{ companies: CompanyUsage[] }>('/admin/companies'),
        api.get<Funnel>('/admin/activation-funnel'),
      ])
      setCompanies(c.data.companies)
      setFunnel(f.data)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const health = (c: CompanyUsage): { label: string; color: string; icon: any } => {
    if (c.store_count === 0 && c.shift_count === 0 && c.timecard_count <= 1) {
      return { label: '未開始', color: 'bg-red-100 text-red-800 border-red-300', icon: AlertTriangle }
    }
    if (c.clockins_last_7d === 0 && c.shifts_last_7d === 0) {
      return { label: '停滞', color: 'bg-amber-100 text-amber-800 border-amber-300', icon: AlertTriangle }
    }
    return { label: 'アクティブ', color: 'bg-green-100 text-green-800 border-green-300', icon: CheckCircle2 }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            会社別利用状況
          </h3>
          <p className="text-xs text-gray-500 mt-1">各会社がどこまでセットアップし、どれくらい使っているかを可視化（super_admin専用）</p>
        </div>
        <button onClick={load} className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded hover:bg-gray-50">
          <RefreshCw className="w-3.5 h-3.5" /> 再読込
        </button>
      </div>

      {/* ファネル */}
      {funnel && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-semibold mb-3">利用定着ファネル</p>
          <div className="grid grid-cols-5 gap-2 text-sm">
            {[
              { label: '登録', value: funnel.total, base: funnel.total },
              { label: '店舗作成', value: funnel.withStore, base: funnel.total },
              { label: 'スタッフ登録', value: funnel.withStaff, base: funnel.total },
              { label: 'シフト作成', value: funnel.withShift, base: funnel.total },
              { label: '打刻運用', value: funnel.withTimecard, base: funnel.total },
            ].map((s, i) => (
              <div key={i} className="border border-gray-200 rounded p-3 text-center">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-400">{pct(s.value, s.base)}%</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            7日以内アクティブ: <b className="text-gray-800">{funnel.activeLast7d}</b> 会社
          </p>
        </div>
      )}

      {/* 会社別テーブル */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 text-sm font-semibold">会社別詳細</div>
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">読み込み中...</div>
        ) : companies.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            会社データがありません
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">会社</th>
                <th className="text-center px-2 py-2 font-medium text-gray-600">状態</th>
                <th className="text-center px-2 py-2 font-medium text-gray-600">登録経過</th>
                <th className="text-center px-2 py-2 font-medium text-gray-600">プラン</th>
                <th className="text-center px-2 py-2 font-medium text-gray-600">ユーザー</th>
                <th className="text-center px-2 py-2 font-medium text-gray-600">店舗</th>
                <th className="text-center px-2 py-2 font-medium text-gray-600">シフト</th>
                <th className="text-center px-2 py-2 font-medium text-gray-600">打刻</th>
                <th className="text-center px-2 py-2 font-medium text-gray-600">7d打刻</th>
                <th className="text-left px-2 py-2 font-medium text-gray-600">最終打刻</th>
              </tr>
            </thead>
            <tbody>
              {companies.map(c => {
                const h = health(c)
                const HIcon = h.icon
                const sinceCreated = daysSince(c.created_at)
                const sinceLast = daysSince(c.last_timecard_at)
                return (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-gray-900">{c.name}</p>
                      <p className="text-[10px] text-gray-400">PIN: {c.company_pin}</p>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold ${h.color}`}>
                        <HIcon className="w-3 h-3" />
                        {h.label}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center text-gray-600">
                      {sinceCreated !== null ? `${sinceCreated}日前` : '—'}
                    </td>
                    <td className="px-2 py-2 text-center text-gray-600">{c.plan}</td>
                    <td className="px-2 py-2 text-center font-mono">{c.user_count}</td>
                    <td className={`px-2 py-2 text-center font-mono ${c.store_count === 0 ? 'text-red-600 font-bold' : ''}`}>{c.store_count}</td>
                    <td className={`px-2 py-2 text-center font-mono ${c.shift_count === 0 ? 'text-red-600 font-bold' : ''}`}>{c.shift_count}</td>
                    <td className="px-2 py-2 text-center font-mono">{c.timecard_count}</td>
                    <td className={`px-2 py-2 text-center font-mono ${c.clockins_last_7d === 0 ? 'text-amber-600' : 'text-green-700 font-bold'}`}>{c.clockins_last_7d}</td>
                    <td className="px-2 py-2 text-gray-600">
                      {c.last_timecard_at ? (
                        <span className={sinceLast && sinceLast > 3 ? 'text-amber-700' : ''}>
                          {c.last_timecard_at.slice(5, 16)}
                          {sinceLast !== null && <span className="text-gray-400"> ({sinceLast}日前)</span>}
                        </span>
                      ) : (
                        <span className="text-gray-400">未打刻</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
