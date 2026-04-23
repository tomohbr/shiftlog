import { useEffect, useMemo, useState } from 'react'
import { FileText, User, RefreshCw, Filter } from 'lucide-react'
import { auditApi, AuditLogItem } from '../api/client'

const ACTION_LABEL: Record<string, string> = {
  create: '作成', update: '更新', delete: '削除',
  login: 'ログイン', logout: 'ログアウト',
  publish: '公開', cancel: '非公開化',
  bulk_import: '一括登録', export: '出力',
  accept: '承諾', reject: '拒否',
}
const ENTITY_LABEL: Record<string, string> = {
  store: '店舗', shift: 'シフト', user: 'スタッフ', skill: 'スキル',
  company: '会社', shift_publication: 'シフト公開', user_skills: 'スキル割当',
  shift_swap: 'シフト交代',
}

function fmtDate(iso: string) {
  const d = new Date(iso.replace(' ', 'T') + 'Z')
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [entityFilter, setEntityFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<string>('all')

  const load = async () => {
    setLoading(true)
    try {
      const res = await auditApi.list({ limit: 300 })
      setLogs(res.data.logs)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => logs.filter(l => {
    if (entityFilter !== 'all' && l.entity !== entityFilter) return false
    if (actionFilter !== 'all' && l.action !== actionFilter) return false
    return true
  }), [logs, entityFilter, actionFilter])

  const entities = Array.from(new Set(logs.map(l => l.entity)))
  const actions = Array.from(new Set(logs.map(l => l.action)))

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">監査ログ</h2>
          <p className="text-sm text-gray-500 mt-1">会社内の重要な変更履歴（最新300件）</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <RefreshCw className="w-4 h-4" /> 再読込
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
          <Filter className="w-4 h-4" /> フィルタ
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">対象</span>
            <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className="text-sm border border-gray-200 rounded px-2 py-1">
              <option value="all">すべて</option>
              {entities.map(e => <option key={e} value={e}>{ENTITY_LABEL[e] || e}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">操作</span>
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="text-sm border border-gray-200 rounded px-2 py-1">
              <option value="all">すべて</option>
              {actions.map(a => <option key={a} value={a}>{ACTION_LABEL[a] || a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 py-12 text-center">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">ログはまだありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-700 w-24">日時</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-700 w-40">ユーザー</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-700 w-24">対象</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-700 w-20">操作</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-700">詳細</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(l.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-gray-800">{l.user_name || '匿名'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{ENTITY_LABEL[l.entity] || l.entity}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
                      {ACTION_LABEL[l.action] || l.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{l.summary || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
