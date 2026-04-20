import { useEffect, useMemo, useState } from 'react'
import { Bug, Lightbulb, HelpCircle, MoreHorizontal, CheckCircle2, Circle, Clock, Trash2, RefreshCw, Inbox } from 'lucide-react'
import { feedbackApi, FeedbackItem, FeedbackCategory, FeedbackStatus } from '../api/client'
import toast from 'react-hot-toast'

const CATEGORY_META: Record<FeedbackCategory, { label: string; icon: any; color: string }> = {
  bug: { label: 'バグ', icon: Bug, color: 'text-red-600 bg-red-50 border-red-200' },
  feature: { label: '要望', icon: Lightbulb, color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
  question: { label: '質問', icon: HelpCircle, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  other: { label: 'その他', icon: MoreHorizontal, color: 'text-gray-600 bg-gray-100 border-gray-200' },
}

const STATUS_META: Record<FeedbackStatus, { label: string; icon: any; color: string }> = {
  open: { label: '未対応', icon: Circle, color: 'text-orange-600 bg-orange-50' },
  in_progress: { label: '対応中', icon: Clock, color: 'text-blue-600 bg-blue-50' },
  closed: { label: '完了', icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
}

function fmtDate(iso: string) {
  const d = new Date(iso.replace(' ', 'T') + 'Z')
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function FeedbackAdminPage() {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<'all' | FeedbackCategory>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | FeedbackStatus>('all')

  const load = async () => {
    setLoading(true)
    try {
      const res = await feedbackApi.list()
      setItems(res.data.feedbacks)
      setError(null)
    } catch (e: any) {
      setError(e.response?.data?.error || '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const changeStatus = async (id: number, status: FeedbackStatus) => {
    try {
      await feedbackApi.updateStatus(id, status)
      toast.success('ステータスを更新しました')
      setItems(prev => prev.map(f => f.id === id ? { ...f, status } : f))
    } catch (e: any) {
      toast.error(e.response?.data?.error || '更新に失敗しました')
    }
  }

  const remove = async (id: number) => {
    if (!confirm('このフィードバックを削除しますか？この操作は取り消せません。')) return
    try {
      await feedbackApi.remove(id)
      toast.success('削除しました')
      setItems(prev => prev.filter(f => f.id !== id))
    } catch (e: any) {
      toast.error(e.response?.data?.error || '削除に失敗しました')
    }
  }

  const filtered = useMemo(() => items.filter(f => {
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false
    if (statusFilter !== 'all' && f.status !== statusFilter) return false
    return true
  }), [items, categoryFilter, statusFilter])

  const counts = useMemo(() => ({
    total: items.length,
    open: items.filter(f => f.status === 'open').length,
    in_progress: items.filter(f => f.status === 'in_progress').length,
    closed: items.filter(f => f.status === 'closed').length,
  }), [items])

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">フィードバック管理</h2>
          <p className="text-sm text-gray-500 mt-1">ユーザーから寄せられた全フィードバック（super_admin 専用）</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition"
        >
          <RefreshCw className="w-4 h-4" />
          再読込
        </button>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">全件</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{counts.total}</p>
        </div>
        <div className="bg-white rounded-lg border border-orange-200 p-4">
          <p className="text-xs text-orange-600">未対応</p>
          <p className="text-2xl font-bold text-orange-700 mt-1">{counts.open}</p>
        </div>
        <div className="bg-white rounded-lg border border-blue-200 p-4">
          <p className="text-xs text-blue-600">対応中</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{counts.in_progress}</p>
        </div>
        <div className="bg-white rounded-lg border border-green-200 p-4">
          <p className="text-xs text-green-600">完了</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{counts.closed}</p>
        </div>
      </div>

      {/* フィルタ */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">カテゴリ</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1.5 text-xs rounded-full border ${categoryFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
            >全て</button>
            {(['bug', 'feature', 'question', 'other'] as FeedbackCategory[]).map(c => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`px-3 py-1.5 text-xs rounded-full border ${categoryFilter === c ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
              >{CATEGORY_META[c].label}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">ステータス</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs rounded-full border ${statusFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
            >全て</button>
            {(['open', 'in_progress', 'closed'] as FeedbackStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs rounded-full border ${statusFilter === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
              >{STATUS_META[s].label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">読み込み中...</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">該当するフィードバックはありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(f => {
            const cat = CATEGORY_META[f.category]
            const st = STATUS_META[f.status]
            const CatIcon = cat.icon
            const StIcon = st.icon
            return (
              <div key={f.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border ${cat.color}`}>
                      <CatIcon className="w-3 h-3" />
                      {cat.label}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${st.color}`}>
                      <StIcon className="w-3 h-3" />
                      {st.label}
                    </span>
                    <span className="text-xs text-gray-500">#{f.id}</span>
                    <span className="text-xs text-gray-400">{fmtDate(f.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {f.status !== 'in_progress' && (
                      <button
                        onClick={() => changeStatus(f.id, 'in_progress')}
                        className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded border border-blue-200"
                        title="対応中にする"
                      >対応中</button>
                    )}
                    {f.status !== 'closed' && (
                      <button
                        onClick={() => changeStatus(f.id, 'closed')}
                        className="px-2 py-1 text-xs text-green-700 hover:bg-green-50 rounded border border-green-200"
                        title="完了にする"
                      >完了</button>
                    )}
                    {f.status !== 'open' && (
                      <button
                        onClick={() => changeStatus(f.id, 'open')}
                        className="px-2 py-1 text-xs text-orange-700 hover:bg-orange-50 rounded border border-orange-200"
                        title="未対応に戻す"
                      >戻す</button>
                    )}
                    <button
                      onClick={() => remove(f.id)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      title="削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs text-gray-600 mb-2 flex items-center gap-3 flex-wrap">
                    <span>
                      送信者: <span className="font-medium text-gray-800">{f.user_name || '匿名'}</span>
                      {f.user_email && <span className="text-gray-500">（{f.user_email}）</span>}
                    </span>
                    {f.company_name && <span>会社: {f.company_name}</span>}
                    {f.email && f.email !== f.user_email && (
                      <span>返信先: <a href={`mailto:${f.email}`} className="text-blue-600 hover:underline">{f.email}</a></span>
                    )}
                  </div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{f.message}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
