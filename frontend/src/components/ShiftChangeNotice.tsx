import { useEffect, useState } from 'react'
import { Bell, X, Send, MessageCircle, Smartphone } from 'lucide-react'
import toast from 'react-hot-toast'
import { shiftsApi, PendingShiftChange, ShiftSnap } from '../api/client'

// 公開済みのシフトを直したとき、まだ本人に知らせていない変更を出す帯＋確認画面（管理者のシフト作成画面の上）。
// 直すたびに送ると通知が連発するので、ここで「誰に・何が変わったか」を確かめてからまとめて送る。

const DOW = '日月火水木金土'
const md = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number)
  return `${m}/${dd}（${DOW[new Date(y, m - 1, dd).getDay()]}）`
}
const snapText = (x: ShiftSnap) => `${x.store_name ? x.store_name + ' ' : ''}${x.start_time.slice(0, 5)}–${x.end_time.slice(0, 5)}`

export default function ShiftChangeNotice({ refreshKey }: { refreshKey: unknown }) {
  const [pending, setPending] = useState<PendingShiftChange[]>([])
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [sending, setSending] = useState(false)

  const load = () => shiftsApi.pendingChanges().then(r => {
    setPending(r.data.pending)
    setChecked(Object.fromEntries(r.data.pending.map(p => [p.user_id, true])))
  }).catch(() => {})
  useEffect(() => { load() }, [refreshKey])

  if (pending.length === 0) return null
  const total = pending.reduce((n, p) => n + p.changes.length, 0)
  const selected = pending.filter(p => checked[p.user_id])

  const send = async () => {
    setSending(true)
    try {
      const r = await shiftsApi.notifyChanges(selected.map(p => p.user_id))
      const rest = r.data.not_linked.length ? `（LINE未連携: ${r.data.not_linked.join('、')}）` : ''
      toast.success(`${r.data.people}人に知らせました${rest}`, { duration: 6000 })
      // LINE の送信に失敗した人（通数の上限など）は、口頭などで伝えてもらう
      if (r.data.failed.length) toast.error(`LINEを送れなかった人: ${r.data.failed.join('、')}（月の通数の上限の可能性）`, { duration: 10000 })
      setOpen(false)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || '送れませんでした')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
        <Bell className="w-5 h-5 text-amber-600 shrink-0" />
        <p className="text-sm text-amber-900 flex-1 min-w-[200px]">
          公開済みのシフトに、まだ本人に知らせていない変更があります：<b>{pending.length}人・{total}件</b>
        </p>
        <button onClick={() => setOpen(true)} className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-bold hover:bg-amber-600">
          確認して知らせる
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">変更を本人に知らせる</h3>
              <button onClick={() => setOpen(false)} aria-label="閉じる"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="p-4 overflow-y-auto space-y-3">
              {pending.map(p => (
                <label key={p.user_id} className={`block rounded-xl border-2 p-3 cursor-pointer ${checked[p.user_id] ? 'border-blue-500 bg-blue-50/40' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="w-4 h-4" checked={!!checked[p.user_id]} onChange={e => setChecked(c => ({ ...c, [p.user_id]: e.target.checked }))} />
                    <span className="font-bold text-gray-900">{p.name}</span>
                    {p.linked
                      ? <span className="ml-auto text-xs font-bold text-[#06C755] flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />LINEで届く</span>
                      : <span className="ml-auto text-xs text-gray-500 flex items-center gap-1"><Smartphone className="w-3.5 h-3.5" />LINE未連携（アプリ通知のみ）</span>}
                  </div>
                  <div className="mt-2 space-y-1.5 pl-6">
                    {p.changes.map(c => (
                      <div key={c.shift_id} className="text-sm">
                        <span className="font-semibold text-gray-800 mr-2">{md((c.after || c.before)!.date)}</span>
                        {c.before && <span className="text-gray-400 line-through mr-1.5">{snapText(c.before)}</span>}
                        {c.after
                          ? <span className={`font-bold ${c.before ? 'text-blue-700' : 'text-green-700'}`}>{c.before ? '→ ' : '追加 '}{snapText(c.after)}</span>
                          : <span className="font-bold text-red-600">→ お休み</span>}
                      </div>
                    ))}
                  </div>
                </label>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex items-center gap-3">
              <p className="text-xs text-gray-500 flex-1">LINEの送信は無料プランの月200通に数えられます（1人1通）。</p>
              <button
                onClick={send}
                disabled={sending || selected.length === 0}
                className="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />{sending ? '送信中…' : `${selected.length}人に知らせる`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
