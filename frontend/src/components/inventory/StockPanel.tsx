import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { InvItem, InvPending, InvReorder } from '../../api/client'
import CountPanel from './CountPanel'
import { ReorderNote } from './LoadPanel'
import { Card, InvCtx, ItemSelect, Msg, Stepper, errText, fmt, md } from './common'

// 在庫一覧（置き場所ごと）と締めの記録（社員以上）

export default function StockPanel({ ctx }: { ctx: InvCtx }) {
  const [stock, setStock] = useState<{ locs: { id: number; name: string }[]; items: InvItem[]; stock: Record<string, Record<string, number>>; store_items?: Record<string, number[]>; reorder: InvReorder[] } | null>(null)
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
                    const hide = l.id === 0 ? !i.track_company : !!stock.store_items && !stock.store_items[l.id]?.includes(i.id)
                    return <td key={l.id} className={`text-center tabular-nums ${v < 0 ? 'text-red-600 font-bold' : ''}`}>{hide ? '' : fmt(v)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">会社の欄が空の品目は、工房で作るので会社の在庫を追っていない品目です。会場の欄が空なのは、その会場では使わない品目です。マイナスは入庫の記録漏れです。</p>
      </Card>
      <Card title="締めの記録（14日分）">
        {hist.length === 0 ? <p className="text-sm text-gray-500">まだありません</p> : (
          <ul className="divide-y divide-gray-100">
            {hist.map(h => (
              <li key={`${h.date}-${h.store_id}`} className="py-2 text-sm">
                <p className="font-bold">{md(h.date)} {h.name}　{h.total_amount != null && <span className="tabular-nums">{h.total_amount.toLocaleString()}円</span>}
                  {!h.complete && <span className="ml-2 text-amber-700">{!h.counted ? '数えがまだ' : 'レジ締めがまだ'}</span>}</p>
                {h.lines.length > 0 && <p className="text-xs text-gray-600">{h.lines.map(l => `${menuName.get(l.menu_id) || ''} ${fmt(l.qty)}`).join('、')}</p>}
                {h.diffs.length > 0 && <p className="text-xs text-amber-700">差：{h.diffs.map(d => `${d.name} ${d.diff > 0 ? '+' : ''}${fmt(d.diff)}${d.count_unit}${d.review === 'hold' ? '（確認待ち）' : d.review === 'kept' ? '（記録のまま）' : ''}`).join('、')}{h.counted_by ? `　数えた人 ${h.counted_by}さん` : ''}</p>}
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
  const [mode, setMode] = useState<'count' | 'purchase' | 'pending'>('count')
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
      <div className="grid grid-cols-3 gap-2">
        {(['count', 'purchase', 'pending'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} className={`py-3 px-1 rounded-xl text-sm font-bold leading-tight ${mode === m ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>{m === 'count' ? '数える（火・金）' : m === 'purchase' ? '入庫（届いた）' : '入荷待ち（注文）'}</button>
        ))}
      </div>
      {mode === 'count' ? <CountPanel ctx={ctx} loc={0} /> : mode === 'pending' ? <PendingPanel ctx={ctx} /> : (
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

/** 入荷待ち（注文したけどまだ届いていない分）。届いたら仕入れ先ごとに「届いた」で会社在庫へ */
function PendingPanel({ ctx }: { ctx: InvCtx }) {
  const [rows, setRows] = useState<InvPending[] | null>(null)
  const [supplier, setSupplier] = useState('')
  const [itemId, setItemId] = useState<number | ''>('')
  const [qty, setQty] = useState<number | ''>('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const item = ctx.me.items.find(i => i.id === itemId)
  const load = () => ctx.api.pending().then(r => setRows(r.data)).catch(e => setMsg({ kind: 'err', text: errText(e, '読み込めませんでした') }))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  const open = rows.filter(r => r.status === 'open')
  const groups = [...new Set(open.map(r => r.supplier))].map(sp => ({ supplier: sp, rows: open.filter(r => r.supplier === sp) }))
  const recent = rows.filter(r => r.status === 'received').sort((a, b) => (b.received_at || '').localeCompare(a.received_at || '')).slice(0, 8)
  const receive = async (sp: string, ids: number[]) => {
    if (!window.confirm(`${sp}の注文を届いたことにして、会社在庫に入れますか`)) return
    try { await ctx.api.receivePending(ids); setMsg({ kind: 'ok', text: `${sp}の分を会社在庫に入れました` }); load() } catch (e) { setMsg({ kind: 'err', text: errText(e, '入庫できませんでした') }) }
  }
  const cancel = async (r: InvPending) => {
    if (!window.confirm(`${r.supplier} ${r.name} を入荷待ちから外しますか`)) return
    try { await ctx.api.deletePending(r.id); load() } catch (e) { setMsg({ kind: 'err', text: errText(e, '外せませんでした') }) }
  }
  const add = async () => {
    if (!supplier.trim() || !itemId || !qty) { setMsg({ kind: 'err', text: '仕入れ先・品目・数を入れてください' }); return }
    try { await ctx.api.addPending(supplier.trim(), [{ item_id: itemId, qty: Number(qty) }]); setMsg({ kind: 'ok', text: `${supplier} ${item?.name} ${fmt(Number(qty))}${item?.count_unit} を登録しました` }); setItemId(''); setQty(''); load() } catch (e) { setMsg({ kind: 'err', text: errText(e, '登録できませんでした') }) }
  }
  return (
    <div className="space-y-4">
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {!groups.length && <Msg kind="info">入荷待ちの注文はありません</Msg>}
      {groups.map(g => (
        <Card key={g.supplier} title={`${g.supplier}（${g.rows.length}品）`}>
          <ul className="divide-y divide-gray-100 text-sm">
            {g.rows.map(r => (
              <li key={r.id} className="flex items-center justify-between py-2 gap-2">
                <span>{r.name}</span>
                <span className="flex items-center gap-3"><b>{fmt(r.qty)}{r.count_unit}</b><button onClick={() => cancel(r)} className="text-xs text-gray-500 underline">外す</button></span>
              </li>
            ))}
          </ul>
          <button onClick={() => receive(g.supplier, g.rows.map(r => r.id))} className="w-full py-3 rounded-2xl bg-green-600 text-white font-bold">届いた（まとめて入庫）</button>
        </Card>
      ))}
      <Card title="注文を登録">
        <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="仕入れ先（シモジマ・アスクルなど）" className="w-full h-11 rounded-xl border border-gray-300 px-3" />
        <ItemSelect items={ctx.me.items} value={itemId} onChange={setItemId} />
        <div className="flex items-center justify-between gap-3"><span className="text-sm text-gray-600">数{item ? `（${item.count_unit}）` : ''}</span><Stepper value={qty} onChange={setQty} big step={item?.half_ok ? 0.5 : 1} /></div>
        <button onClick={add} className="w-full py-3 rounded-2xl bg-blue-600 text-white font-bold">入荷待ちに追加</button>
        <p className="text-xs text-gray-500">品目が複数なら1つずつ追加。LINEなら「シモジマに注文 PFP 18袋、スリーブ 13袋」の一言でまとめて入ります。</p>
      </Card>
      {!!recent.length && (
        <Card title="最近届いた分">
          <ul className="text-sm text-gray-600 space-y-1">{recent.map(r => <li key={r.id}>{md((r.received_at || '').slice(0, 10))} {r.supplier} {r.name} {fmt(r.qty)}{r.count_unit}</li>)}</ul>
        </Card>
      )}
    </div>
  )
}
