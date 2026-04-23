import { useEffect, useMemo, useState } from 'react'
import { Repeat, Check, X, Trash2, RefreshCw, Inbox } from 'lucide-react'
import { swapsApi, ShiftSwap } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '未対応', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  accepted: { label: '承諾済', color: 'text-green-700 bg-green-50 border-green-200' },
  rejected: { label: '拒否', color: 'text-gray-600 bg-gray-100 border-gray-200' },
}

function fmt(dateStr: string) {
  const d = new Date(dateStr)
  const days = ['日','月','火','水','木','金','土']
  return `${d.getMonth()+1}/${d.getDate()} (${days[d.getDay()]})`
}

export default function SwapsPage() {
  const { user } = useAuth()
  const [swaps, setSwaps] = useState<ShiftSwap[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'mine' | 'done'>('pending')

  const load = async () => {
    setLoading(true)
    try {
      const r = await swapsApi.list()
      setSwaps(r.data.swaps)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (!user) return []
    return swaps.filter(s => {
      if (tab === 'pending') return s.status === 'pending' && s.requester_id !== user.id
      if (tab === 'mine') return s.requester_id === user.id
      return s.status !== 'pending'
    })
  }, [swaps, tab, user])

  const accept = async (id: number) => {
    if (!confirm('このシフトを代わりに担当しますか？')) return
    try {
      await swapsApi.accept(id)
      toast.success('承諾しました')
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラー')
    }
  }
  const reject = async (id: number) => {
    try {
      await swapsApi.reject(id)
      toast.success('拒否しました')
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラー')
    }
  }
  const remove = async (id: number) => {
    if (!confirm('リクエストを取消しますか？')) return
    try {
      await swapsApi.remove(id)
      toast.success('取消しました')
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラー')
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Repeat className="w-6 h-6 text-blue-600" /> シフト交代
          </h2>
          <p className="text-sm text-gray-500 mt-1">自分のシフトを他のスタッフに代わってもらう/代わる</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex border-b border-gray-200">
        {([
          ['pending', '受け取ったリクエスト'],
          ['mine', '自分のリクエスト'],
          ['done', '履歴'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-12 text-center">
          <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">該当するリクエストはありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(s => {
            const st = STATUS_META[s.status] || STATUS_META.pending
            const isMine = user?.id === s.requester_id
            return (
              <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded border ${st.color}`}>{st.label}</span>
                  <span className="text-xs text-gray-400">#{s.id}</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {fmt(s.date)} {s.start_time}〜{s.end_time}
                  </span>
                </div>
                <div className="text-xs text-gray-600">
                  依頼者: <span className="font-medium text-gray-800">{s.requester_name}</span>
                  {s.target_user_name && <> → 指定: {s.target_user_name}</>}
                  {!s.target_user_name && <> → <span className="text-gray-500">（全員宛）</span></>}
                  {s.responder_name && <> / 対応: {s.responder_name}</>}
                </div>
                {s.reason && <p className="text-sm text-gray-700 bg-gray-50 rounded px-3 py-2">{s.reason}</p>}
                {s.status === 'pending' && (
                  <div className="flex gap-2 pt-1">
                    {!isMine && (
                      <>
                        <button onClick={() => accept(s.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded">
                          <Check className="w-3.5 h-3.5" /> 代わる
                        </button>
                        <button onClick={() => reject(s.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 rounded border border-gray-200">
                          <X className="w-3.5 h-3.5" /> 代われない
                        </button>
                      </>
                    )}
                    {isMine && (
                      <button onClick={() => remove(s.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded border border-red-200">
                        <Trash2 className="w-3.5 h-3.5" /> リクエスト取消
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
