import { useEffect, useState } from 'react'
import { Loader2, Truck, AlertTriangle } from 'lucide-react'
import { InvLoad, InvReorder } from '../../api/client'
import { Card, InvCtx, Msg, errText, fmt, hm, md } from './common'

// 積み込みリスト（担当者）。会場ごとに「次に開く日」の案を出す。数を直して確定すると、会社→会場に移動する。

function LoadCard({ ctx, load, onDone }: { ctx: InvCtx; load: InvLoad; onDone: () => void }) {
  const [date, setDate] = useState(load.date || '')
  const [data, setData] = useState<InvLoad>(load)
  const [qty, setQty] = useState<Record<number, number | ''>>(() => Object.fromEntries(load.lines.map(l => [l.item_id, l.qty])))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const reload = async (d: string) => {
    try {
      const r = await ctx.api.load(load.store_id, d)
      const l = r.data.loads[0]
      setData(l); setQty(Object.fromEntries(l.lines.map(x => [x.item_id, x.qty]))); setMsg(null)
    } catch (e) { setMsg({ kind: 'err', text: errText(e, '読み込めませんでした') }) }
  }

  const confirmIt = async () => {
    if (!date) return
    setBusy(true)
    try {
      await ctx.api.confirmLoad(load.store_id, date, data.lines.map(l => ({ item_id: l.item_id, qty: Number(qty[l.item_id]) || 0 })))
      setMsg({ kind: 'ok', text: '確定しました。会社の在庫から会場へ移しました' })
      await reload(date); onDone()
    } catch (e) { setMsg({ kind: 'err', text: errText(e, '確定できませんでした') }) }
    setBusy(false)
  }

  if (!load.date) return <Card title={load.name}><p className="text-sm text-gray-500">2週間以内に開く日がありません</p></Card>
  const confirmed = data.status === 'confirmed'
  return (
    <Card
      title={<span className="flex items-center gap-2"><Truck className="w-5 h-5" />{load.name}</span>}
      right={<input type="date" value={date} onChange={e => { setDate(e.target.value); reload(e.target.value) }} className="h-9 rounded-lg border border-gray-300 px-2 text-sm" />}
    >
      <p className="text-sm text-gray-700">
        <b>{md(date)}</b>（{data.daytype}）に届ける分
        {confirmed && <span className="ml-2 text-green-700 font-bold">確定済み {hm(data.confirmed_at)}</span>}
      </p>
      {data.forecast && <p className="text-xs text-gray-500">予想：{data.forecast.map(f => `${f.name} ${f.qty}${f.basis === 'actual' ? '' : f.basis === 'baseline' ? '（去年）' : '（なし）'}`).join('、')}</p>}
      {data.stale?.length ? <Msg kind="warn">何日も前の分が残っています：{data.stale.map(s => `${s.name}（${s.days}日前）`).join('、')}。古いほうから使ってください</Msg> : null}

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left py-1">品目</th><th>使う見込み</th><th>会場</th><th>依頼</th><th className="w-28">積む</th></tr></thead>
          <tbody>
            {data.lines.map(l => (
              <tr key={l.item_id} className="border-b border-gray-100">
                <td className="py-2 font-bold leading-tight">{l.name}<span className="block text-[11px] font-normal text-gray-500">{l.count_unit}{l.company_stock != null && `・会社 ${fmt(l.company_stock)}`}{l.capped && '・上限で減らした'}</span></td>
                <td className="text-center tabular-nums">{fmt(l.need)}</td>
                <td className="text-center tabular-nums">{fmt(l.stock)}</td>
                <td className="text-center tabular-nums">{l.request ? fmt(l.request) : ''}</td>
                <td className="text-center">
                  <input type="number" inputMode="decimal" min={0} value={qty[l.item_id] ?? ''} onChange={e => setQty(q => ({ ...q, [l.item_id]: e.target.value === '' ? '' : Number(e.target.value) }))}
                    className={`w-20 h-10 text-center font-bold tabular-nums rounded-lg border-2 ${Number(qty[l.item_id]) !== l.suggested ? 'border-blue-500' : 'border-gray-300'}`} />
                  {Number(qty[l.item_id]) !== l.suggested && <span className="block text-[10px] text-gray-500">案 {fmt(l.suggested)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <button onClick={confirmIt} disabled={busy} className="w-full py-4 rounded-2xl bg-gray-900 text-white text-lg font-bold disabled:opacity-60">
        {busy ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : confirmed ? '直して確定し直す' : 'この数で積んだ（確定する）'}
      </button>
    </Card>
  )
}

export function ReorderNote({ list }: { list: InvReorder[] }) {
  if (!list.length) return null
  return (
    <Msg kind="warn">
      <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" />発注の目安</p>
      {list.map(r => <p key={r.item_id}>{r.name}：会社と会場で残り {fmt(r.total)}{r.count_unit}（1日 約{fmt(r.per_day)}・約{fmt(r.days_left)}日分。届くまで{r.lead_days}日）</p>)}
    </Msg>
  )
}

export default function LoadPanel({ ctx }: { ctx: InvCtx }) {
  const [res, setRes] = useState<{ loads: InvLoad[]; reorder: InvReorder[]; margin_pct: number } | null>(null)
  const [err, setErr] = useState('')
  const load = async () => { try { setRes((await ctx.api.load()).data); setErr('') } catch (e) { setErr(errText(e, '読み込めませんでした')) } }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <Msg kind="err">{err}</Msg>
  if (!res) return <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-gray-400" /></div>
  return (
    <div className="space-y-4">
      <Msg kind="info">「使う見込み」は予想販売数（今年の同じ曜日の実績、なければ去年）に {res.margin_pct}% の余裕を足した数です。会場に残っている分を引いて「積む」の案を出しています。積んだ数に直してから確定してください。</Msg>
      <ReorderNote list={res.reorder} />
      {res.loads.map(l => <LoadCard key={`${l.store_id}-${l.date}`} ctx={ctx} load={l} onDone={() => ctx.onSaved()} />)}
    </div>
  )
}
