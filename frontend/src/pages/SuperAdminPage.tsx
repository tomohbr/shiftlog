import { useEffect, useState } from 'react'
import { adminApi, AdminUser, AdminStats } from '../api/client'

export default function SuperAdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'in_use' | 'unused'>('all')

  const load = async () => {
    setLoading(true)
    try {
      const [u, s] = await Promise.all([adminApi.getUsers(), adminApi.getStats()])
      setUsers(u.data.users)
      setStats(s.data)
      setError(null)
    } catch (e: any) {
      setError(e.response?.data?.error || '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleActive = async (u: AdminUser) => {
    if (!confirm(`${u.email || u.name} を${u.is_active ? '無効化' : '有効化'}しますか？`)) return
    try {
      await adminApi.setActive(u.id, !u.is_active)
      await load()
    } catch (e: any) {
      alert(e.response?.data?.error || '更新に失敗しました')
    }
  }

  const fmt = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  }

  const filtered = users.filter(u => {
    const q = query.trim().toLowerCase()
    if (q && !(u.email?.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))) return false
    if (filter === 'in_use' && !u.in_use) return false
    if (filter === 'unused' && u.in_use) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">システム管理</h2>
        <p className="text-sm text-gray-500 mt-1">全登録ユーザーと利用状況</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: '総ユーザー数', value: stats.totalUsers },
            { label: 'アクティブ', value: stats.activeUsers },
            { label: '管理者', value: stats.adminUsers },
            { label: '会社数', value: stats.totalCompanies },
          ].map(c => (
            <div key={c.label} className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{c.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="メール・名前で検索"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as any)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="all">すべて</option>
          <option value="in_use">使用中</option>
          <option value="unused">未使用</option>
        </select>
        <button onClick={load} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          更新
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">読み込み中...</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">メール</th>
                  <th className="px-4 py-3">名前</th>
                  <th className="px-4 py-3">ロール</th>
                  <th className="px-4 py-3">状態</th>
                  <th className="px-4 py-3">会社</th>
                  <th className="px-4 py-3">最終活動</th>
                  <th className="px-4 py-3">登録日</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900 font-mono text-xs">{u.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-800">{u.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        u.role === 'super_admin' ? 'bg-purple-100 text-purple-700' :
                        u.role === 'admin' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          !u.is_active ? 'bg-gray-400' : u.in_use ? 'bg-green-500' : 'bg-yellow-400'
                        }`} />
                        <span className="text-xs text-gray-600">
                          {!u.is_active ? '無効' : u.in_use ? '使用中' : '未使用'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {u.companies.length === 0 ? '—' : u.companies.map(c => c.name).join(', ')}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {fmt(u.last_activity)}
                      {u.recently_active && <span className="ml-1 text-green-600">●</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{fmt(u.created_at)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(u)}
                        className={`px-3 py-1 text-xs rounded ${
                          u.is_active
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        }`}
                      >
                        {u.is_active ? '無効化' : '有効化'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">該当ユーザーなし</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
