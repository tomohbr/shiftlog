import { useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Card, InvCtx, ItemSelect, Msg, Stepper, errText, fmt } from './common'

// 会場で買い足した（業務スーパーなど）／足りないので次に持ってきてほしい、の2つ。誰でも使える。

type Req = Awaited<ReturnType<InvCtx['api']['requests']>>['data'][number]

function QtyForm({ ctx, kind, onDone }: { ctx: InvCtx; kind: 'buy' | 'request'; onDone: () => void }) {
  const [itemId, setItemId] = useState<number | ''>('')
  const [qty, setQty] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const item = ctx.me.items.find(i => i.id === itemId)

  const submit = async () => {
    if (!itemId || !qty) { setMsg({ kind: 'err', text: '品目と数を入れてください' }); return }
    setBusy(true)
    try {
      if (kind === 'buy') await ctx.api.localBuy(ctx.storeId, itemId, Number(qty), note)
      else await ctx.api.addRequest(ctx.storeId, itemId, Number(qty), note)
      setMsg({ kind: 'ok', text: kind === 'buy' ? `${item?.name} ${fmt(Number(qty))}${item?.count_unit} を記録しました` : `${item?.name} ${fmt(Number(qty))}${item?.count_unit} を次の積み込みに足しました` })
      setItemId(''); setQty(''); setNote('')
      onDone()
    } catch (e) { setMsg({ kind: 'err', text: errText(e, '送れませんでした') }) }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <ItemSelect items={ctx.me.items} value={itemId} onChange={setItemId} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-600">数{item ? `（${item.count_unit}）` : ''}</span>
        <Stepper value={qty} onChange={setQty} step={item?.half_ok ? 0.5 : 1} big />
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder={kind === 'buy' ? 'メモ（どこで・いくら など）' : 'メモ（いつまでに など）'} className="w-full h-11 rounded-xl border border-gray-300 px-3" />
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <button onClick={submit} disabled={busy} className={`w-full py-4 rounded-2xl text-white text-lg font-bold disabled:opacity-60 ${kind === 'buy' ? 'bg-blue-600' : 'bg-amber-600'}`}>
        {busy ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : kind === 'buy' ? '買い足しを記録する' : '足りないと伝える'}
      </button>
    </div>
  )
}

export default function BuyPanel({ ctx }: { ctx: InvCtx }) {
  const [reqs, setReqs] = useState<Req[] | null>(null)
  const loadReqs = async () => { try { setReqs((await ctx.api.requests()).data) } catch { setReqs([]) } }
  useEffect(() => { loadReqs() }, [ctx.storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (id: number) => {
    if (!confirm('この連絡を取り消しますか？')) return
    try { await ctx.api.deleteRequest(id); loadReqs() } catch (e) { alert(errText(e, '取り消せませんでした')) }
  }

  const open = (reqs || []).filter(r => r.status === 'open')
  return (
    <div className="space-y-4">
      <Card title="足りない（次に持ってきてほしい）">
        <p className="text-sm text-gray-600">次の積み込みリストに上乗せされ、担当の人に届きます。今すぐ要るときは電話してください。</p>
        <QtyForm ctx={ctx} kind="request" onDone={loadReqs} />
      </Card>
      <Card title="近くで買い足した">
        <p className="text-sm text-gray-600">業務スーパーなどで買ってヒュッテに足した分です。記録しないと、閉店の数えが合わなくなります。</p>
        <QtyForm ctx={ctx} kind="buy" onDone={() => ctx.onSaved()} />
      </Card>
      <Card title="まだ届いていない「足りない」">
        {reqs === null ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" /> : open.length === 0 ? <p className="text-sm text-gray-500">ありません</p> : (
          <ul className="divide-y divide-gray-100">
            {open.map(r => (
              <li key={r.id} className="py-2 flex items-center gap-2 text-sm">
                <span className="flex-1"><b>{r.store_name}</b>　{r.item_name} {fmt(r.qty)}{r.count_unit}{r.note && <span className="text-gray-500">（{r.note}）</span>}<span className="block text-xs text-gray-500">{r.user_name}</span></span>
                {(ctx.me.role === 'admin' || r.user_name === ctx.me.name) && <button onClick={() => remove(r.id)} className="p-2 text-gray-400"><Trash2 className="w-4 h-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
