import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { InvItem, InvReorder } from '../../api/client'
import CountPanel from './CountPanel'
import { ReorderNote } from './LoadPanel'
import { Card, InvCtx, ItemSelect, Msg, Stepper, errText, fmt, md } from './common'

// 在庫一覧（置き場所ごと）と締めの記録（社員以上）

export default function StockPanel({ ctx }: { ctx: InvCtx }) {
  const [stock, setStock] = useState<{ locs: { id: number; name: string }[]; items: InvItem[]; stock: Record<string, Record<string, number>>; reorder: InvReorder[] } | null>(null)
  const [hist, setHist] = useState<Awaited<ReturnType<InvCtx['api']['history']>>['data'] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    (async () => {
      try {
        const [s, h] = await Promise.all([ctx.api.stock(), ctx.api.history(14)])
        setStock(s.data); setHist(h.data)
      } catch (e) { setErr(errText(e, '読み込めませんでした')) }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Msg kind="err">{err}</Msg>
  if (!stock || !hist) return <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-gray-400" /></div>
  const menuName = new Map((ctx.me.menus || []).map(m => [m.id, m.name]))
  return (
    <div className="space-y-4">
      <ReorderNote list={stock.reorder} />
      <Card title="今の在庫（記録上）">
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left py-1">品目</th>{stock.locs.map(l => <th key={l.id} className="px-1">{l.name}</th>)}</tr></thead>
            <tbody>
              {stock.items.map(i => (
                <tr key={i.id} className="border-b border-gray-100">
                  <td className="py-1.5">{i.name}<span className="text-xs text-gray-500">（{i.count_unit}）</span></td>
                  {stock.locs.map(l => {
                    const v = stock.stock[l.id]?.[i.id] ?? 0
                    const hide = l.id === 0 && !i.track_company
                    return <td key={l.id} className={`text-center tabular-nums ${v < 0 ? 'text-red-600 font-bold' : ''}`}>{hide ? '' : fmt(v)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">会社の欄が空の品目は、工房で作るので会社の在庫を追っていない品目です。マイナスは入庫の記録漏れです。</p>
      </Card>
      <Card title="締めの記録（14日分）">
        {hist.length === 0 ? <p className="text-sm text-gray-500">まだありません</p> : (
          <ul className="divide-y divide-gray-100">
            {hist.map(h => (
              <li key={`${h.date}-${h.store_id}`} className="py-2 text-sm">
                <p className="font-bold">{md(h.date)} {h.name}　{h.total_amount != null && <span className="tabular-nums">{h.total_amount.toLocaleString()}円</span>}
                  {!h.complete && <span className="ml-2 text-amber-700">{!h.counted ? '数えがまだ' : 'レジ締めがまだ'}</span>}</p>
                {h.lines.length > 0 && <p className="text-xs text-gray-600">{h.lines.map(l => `${menuName.get(l.menu_id) || ''} ${fmt(l.qty)}`).join('、')}</p>}
                {h.diffs.length > 0 && <p className="text-xs text-amber-700">差：{h.diffs.map(d => `${d.name} ${d.diff > 0 ? '+' : ''}${fmt(d.diff)}${d.count_unit}`).join('、')}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** 会社（工房）の在庫: 数える（火・金）と、仕入れが届いたときの入庫 */
export function CompanyPanel({ ctx }: { ctx: InvCtx }) {
  const [mode, setMode] = useState<'count' | 'purchase'>('count')
  const [itemId, setItemId] = useState<number | ''>('')
  const [qty, setQty] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const item = ctx.me.items.find(i => i.id === itemId)
  const add = async () => {
    if (!itemId || !qty) { setMsg({ kind: 'err', text: '品目と数を入れてください' }); return }
    try {
      await ctx.api.purchase(itemId, Number(qty), note)
      setMsg({ kind: 'ok', text: `${item?.name} ${fmt(Number(qty))}${item?.count_unit} を会社に入庫しました` })
      setItemId(''); setQty(''); setNote('')
    } catch (e) { setMsg({ kind: 'err', text: errText(e, '入庫できませんでした') }) }
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(['count', 'purchase'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} className={`py-3 rounded-xl font-bold ${mode === m ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>{m === 'count' ? '数える（火・金）' : '入庫（仕入れが届いた）'}</button>
        ))}
      </div>
      {mode === 'count' ? <CountPanel ctx={ctx} loc={0} /> : (
        <Card title="会社に入庫">
          <ItemSelect items={ctx.me.items} value={itemId} onChange={setItemId} />
          <div className="flex items-center justify-between gap-3"><span className="text-sm text-gray-600">数{item ? `（${item.count_unit}）` : ''}</span><Stepper value={qty} onChange={setQty} big step={item?.half_ok ? 0.5 : 1} /></div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="メモ（仕入れ先など）" className="w-full h-11 rounded-xl border border-gray-300 px-3" />
          {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
          <button onClick={add} className="w-full py-4 rounded-2xl bg-blue-600 text-white text-lg font-bold">入庫する</button>
        </Card>
      )}
    </div>
  )
}
