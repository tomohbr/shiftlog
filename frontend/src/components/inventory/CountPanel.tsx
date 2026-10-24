import { useEffect, useMemo, useState } from 'react'
import { Loader2, CheckCircle2, RotateCcw } from 'lucide-react'
import { InvClosing, InvItem } from '../../api/client'
import { Card, InvCtx, Msg, Stepper, errText, fmt, hm, md } from './common'

// 残りを数える画面。会場（閉店時・バイトも）と会社（火・金・担当者）の両方で使う。
// 数が変わっていない品目は「前回と同じ」で埋められる。

export default function CountPanel({ ctx, loc }: { ctx: InvCtx; loc: number }) {
  const { api, date, me } = ctx
  const isCompany = loc === 0
  const countDate = isCompany ? new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) : date
  const [list, setList] = useState<InvItem[]>([])
  const [vals, setVals] = useState<Record<number, number | ''>>({})
  const [prev, setPrev] = useState<{ date: string | null; map: Map<number, number> }>({ date: null, map: new Map() })
  const [book, setBook] = useState<Map<number, number> | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [status, setStatus] = useState<InvClosing | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.getCount(loc, countDate)
      setList(r.data.items)
      setVals(Object.fromEntries(r.data.lines.map(l => [l.item_id, l.counted])))
      setPrev({ date: r.data.previous.date, map: new Map(r.data.previous.lines.map(l => [l.item_id, l.counted])) })
      setBook(r.data.book ? new Map(r.data.book.map(b => [b.item_id, b.qty])) : null)
      setSavedAt(r.data.saved_at)
      setMsg(null)
    } catch (e) { setMsg({ kind: 'err', text: errText(e, '読み込めませんでした') }) }
    setLoading(false)
  }
  useEffect(() => { load() }, [loc, countDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => [
    { title: '食材', rows: list.filter(i => i.category === 'food') },
    { title: '容器', rows: list.filter(i => i.category !== 'food') },
  ].filter(g => g.rows.length), [list])

  const empty = list.filter(i => vals[i.id] === undefined || vals[i.id] === '')
  const fillPrev = () => setVals(v => {
    const n = { ...v }
    for (const i of empty) if (prev.map.has(i.id)) n[i.id] = prev.map.get(i.id)!
    return n
  })

  const save = async () => {
    if (empty.length) {
      setMsg({ kind: 'err', text: `まだ入っていない品目があります：${empty.map(i => i.name).join('、')}（無いときは 0 を入れてください）` })
      return
    }
    setBusy(true)
    try {
      const r = await api.saveCount(loc, countDate, list.map(i => ({ item_id: i.id, counted: Number(vals[i.id]) })))
      setStatus(r.data.status)
      setMsg({ kind: 'ok', text: '保存しました。おつかれさまでした' })
      setSavedAt(new Date().toISOString())
      ctx.onSaved()
      if (isCompany) load()
    } catch (e) { setMsg({ kind: 'err', text: errText(e, '保存できませんでした。電波の良い所でもう一度押してください') }) }
    setBusy(false)
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      <Msg kind="info">
        {isCompany
          ? <>会社（工房）に置いてある数を数えて入れてください。「記録上」は、入庫と積み込みから計算した数です。</>
          : <>{md(countDate)}の閉店後に、ヒュッテに<b>残っている数</b>を入れてください。開けた袋は 0.5 と数えます。</>}
        {savedAt && <span className="block mt-1 font-bold">保存済み（{hm(savedAt)}）。直して保存し直せます。</span>}
      </Msg>

      {empty.length > 0 && prev.date && (
        <button onClick={fillPrev} className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-700 font-bold flex items-center justify-center gap-2">
          <RotateCcw className="w-4 h-4" />入っていない品目を前回（{md(prev.date)}）の数で埋める
        </button>
      )}

      {groups.map(g => (
        <Card key={g.title} title={g.title}>
          <ul className="divide-y divide-gray-100">
            {g.rows.map(i => (
              <li key={i.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900 leading-tight">{i.name}</p>
                  <p className="text-xs text-gray-500">
                    {i.count_unit}で数える{i.half_ok ? '（開封済み＝0.5）' : ''}
                    {prev.map.has(i.id) && <button type="button" onClick={() => setVals(v => ({ ...v, [i.id]: prev.map.get(i.id)! }))} className="ml-2 underline text-blue-600">前回 {fmt(prev.map.get(i.id))}</button>}
                    {book && <span className="ml-2">記録上 {fmt(book.get(i.id) || 0)}</span>}
                  </p>
                </div>
                <Stepper value={vals[i.id] ?? ''} onChange={v => setVals(s => ({ ...s, [i.id]: v }))} step={i.half_ok ? 0.5 : 1} />
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}

      {status && !isCompany && (
        <Card title="今日の締め">
          <p className="text-sm">残りの数え {status.counted ? <CheckCircle2 className="inline w-4 h-4 text-green-600" /> : 'まだ'}　レジ締め {status.sales_done ? <CheckCircle2 className="inline w-4 h-4 text-green-600" /> : 'まだ'}</p>
          {me.role !== 'part' && status.complete && (status.diffs.length
            ? <Msg kind="warn">計算と合わない品目：{status.diffs.map(d => `${d.name} ${d.diff > 0 ? '+' : ''}${fmt(d.diff)}${d.count_unit}`).join('、')}</Msg>
            : <p className="text-sm text-green-700 font-bold">計算どおりでした</p>)}
        </Card>
      )}

      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-gray-50/95 border-t border-gray-200 z-10">
        <button onClick={save} disabled={busy} className="w-full max-w-md mx-auto block py-4 rounded-2xl bg-gray-900 text-white text-lg font-bold disabled:opacity-60">
          {busy ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : savedAt ? '直して保存する' : '保存する'}
        </button>
      </div>
    </div>
  )
}
