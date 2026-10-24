import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { InvClosing, InvMenu, InvReceipt } from '../../api/client'
import { Card, InvCtx, Msg, errText, fmt, hm, md } from './common'

// レジ締め（社員以上）。締めレシートを撮る → 部門ごとの数を読み取る → 確かめて保存。
// 写真の読み取りが使えないときや読めなかったときは、そのまま手で入れられる。

/** 写真を長い辺1600pxの JPEG に縮める（送る量を減らす） */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url })
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.82)
  } finally { URL.revokeObjectURL(url) }
}

type Row = { qty: number | ''; amount: number | '' }

export default function SalesPanel({ ctx }: { ctx: InvCtx }) {
  const { api, storeId, date } = ctx
  const [menus, setMenus] = useState<InvMenu[]>([])
  const [rows, setRows] = useState<Record<number, Row>>({})
  const [total, setTotal] = useState<number | ''>('')
  const [ocr, setOcr] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [read, setRead] = useState<InvReceipt | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'reading' | 'saving'>('loading')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null)
  const [status, setStatus] = useState<InvClosing | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    (async () => {
      setPhase('loading'); setMsg(null); setRead(null); setPhoto(null); setStatus(null)
      try {
        const r = await api.getSales(storeId, date)
        setMenus(r.data.menus); setOcr(r.data.ocr)
        const saved = new Map((r.data.sales?.lines || []).map(l => [l.menu_id, l]))
        setRows(Object.fromEntries(r.data.menus.map(m => [m.id, { qty: saved.get(m.id)?.qty ?? '', amount: saved.get(m.id)?.amount ?? '' }])))
        setTotal(r.data.sales?.total_amount ?? '')
        setSavedAt(r.data.sales?.updated_at || null)
      } catch (e) { setMsg({ kind: 'err', text: errText(e, '読み込めませんでした') }) }
      setPhase('ready')
    })()
  }, [storeId, date]) // eslint-disable-line react-hooks/exhaustive-deps

  const onPhoto = async (f: File | undefined) => {
    if (!f) return
    setPhase('reading'); setMsg(null)
    try {
      const data = await shrink(f)
      setPhoto(data)
      const r = await api.readReceipt(storeId, data, 'image/jpeg')
      setRead(r.data)
      const got = new Map(r.data.lines.map(l => [l.menu_id, l]))
      setRows(Object.fromEntries(menus.map(m => [m.id, { qty: got.get(m.id)?.qty ?? 0, amount: got.get(m.id)?.amount ?? '' }])))
      if (r.data.total_amount != null) setTotal(r.data.total_amount)
      const dateWarn = r.data.receipt_date && r.data.receipt_date !== date ? `レシートの日付が ${md(r.data.receipt_date)} です。今日のレシートか確かめてください。` : ''
      setMsg({ kind: r.data.lines.length ? 'warn' : 'err', text: r.data.lines.length ? `写真から読み取りました。レシートと見比べて、違うところは直してから保存してください。${dateWarn}` : `読み取れませんでした${r.data.note ? `（${r.data.note}）` : ''}。撮り直すか、数を手で入れてください。` })
    } catch (e) { setMsg({ kind: 'err', text: errText(e, '読み取れませんでした。数を手で入れてください') }) }
    setPhase('ready')
    if (fileRef.current) fileRef.current.value = ''
  }

  const sumAmount = menus.reduce((a, m) => a + (Number(rows[m.id]?.amount) || 0), 0)

  const save = async () => {
    const blank = menus.filter(m => rows[m.id]?.qty === '')
    if (blank.length) { setMsg({ kind: 'err', text: `数が入っていないメニューがあります：${blank.map(m => m.name).join('、')}（売れていなければ 0）` }); return }
    setPhase('saving')
    try {
      const r = await api.saveSales({
        store_id: storeId, date, total_amount: total === '' ? null : Number(total), source: photo ? 'photo' : 'manual', photo, ocr_raw: read,
        lines: menus.map(m => ({ menu_id: m.id, qty: Number(rows[m.id].qty) || 0, amount: rows[m.id].amount === '' ? null : Number(rows[m.id].amount) })),
      })
      setStatus(r.data.status); setSavedAt(new Date().toISOString())
      setMsg({ kind: 'ok', text: 'レジ締めを保存しました' })
      ctx.onSaved()
    } catch (e) { setMsg({ kind: 'err', text: errText(e, '保存できませんでした。電波の良い所でもう一度押してください') }) }
    setPhase('ready')
  }

  if (phase === 'loading') return <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      {savedAt && <Msg kind="info">{md(date)}のレジ締めは保存済みです（{hm(savedAt)}）。撮り直し・手直しして保存し直せます。</Msg>}

      {ocr ? (
        <>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={phase !== 'ready'} className="w-full py-5 rounded-2xl bg-[#06C755] text-white text-lg font-bold flex items-center justify-center gap-3 disabled:opacity-60">
            {phase === 'reading' ? <><Loader2 className="w-6 h-6 animate-spin" />読み取り中…（10〜30秒）</> : <><Camera className="w-6 h-6" />締めレシートを撮る</>}
          </button>
          <p className="text-xs text-gray-500 text-center">部門ごとの集計が全部写るように、まっすぐ撮ってください</p>
        </>
      ) : (
        <Msg kind="info">締めレシートの部門ごとの数を、そのまま入れてください。</Msg>
      )}

      {photo && <img src={photo} alt="締めレシート" className="w-full max-h-72 object-contain rounded-xl border border-gray-200 bg-white" />}
      {read?.unmatched?.length ? <Msg kind="warn">メニューに当てはめられなかった行：{read.unmatched.map(u => `${u.label}${u.qty != null ? ` ${u.qty}点` : ''}${u.amount != null ? ` ${u.amount}円` : ''}`).join('、')}</Msg> : null}

      <Card title="部門ごとの数">
        <ul className="divide-y divide-gray-100">
          {menus.map(m => (
            <li key={m.id} className="py-3 flex items-center gap-2">
              <span className="flex-1 font-bold text-gray-900 leading-tight">{m.name}{m.register_label && m.register_label !== m.name && <span className="block text-xs font-normal text-gray-500">レジ：{m.register_label}</span>}</span>
              <label className="text-center"><span className="block text-[10px] text-gray-500">点数</span>
                <input type="number" inputMode="numeric" min={0} value={rows[m.id]?.qty ?? ''} onChange={e => setRows(r => ({ ...r, [m.id]: { ...r[m.id], qty: e.target.value === '' ? '' : Number(e.target.value) } }))}
                  className="w-20 h-11 text-center text-lg font-bold tabular-nums rounded-xl border-2 border-gray-300" /></label>
              <label className="text-center"><span className="block text-[10px] text-gray-500">金額</span>
                <input type="number" inputMode="numeric" min={0} value={rows[m.id]?.amount ?? ''} onChange={e => setRows(r => ({ ...r, [m.id]: { ...r[m.id], amount: e.target.value === '' ? '' : Number(e.target.value) } }))}
                  className="w-24 h-11 text-center tabular-nums rounded-xl border border-gray-300" /></label>
            </li>
          ))}
        </ul>
        <label className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
          <span className="font-bold">総売上（税込）</span>
          <input type="number" inputMode="numeric" min={0} value={total} onChange={e => setTotal(e.target.value === '' ? '' : Number(e.target.value))} className="w-32 h-11 text-right px-2 text-lg font-bold tabular-nums rounded-xl border-2 border-gray-300" />
        </label>
        {sumAmount > 0 && total !== '' && Math.abs(sumAmount - Number(total)) > 0 && <p className="text-xs text-amber-700">部門の金額の合計は {sumAmount.toLocaleString()}円 です（総売上と {(Number(total) - sumAmount).toLocaleString()}円 違います）</p>}
      </Card>

      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      {status && (status.complete
        ? (status.diffs.length ? <Msg kind="warn">締めがそろいました。計算と合わない品目：{status.diffs.map(d => `${d.name} ${d.diff > 0 ? '+' : ''}${fmt(d.diff)}${d.count_unit}`).join('、')}</Msg> : <Msg kind="ok">締めがそろいました。残りの数は計算どおりでした</Msg>)
        : <Msg kind="info">あとは「残りの数え」が済めば、この会場の締めは完了です</Msg>)}

      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-gray-50/95 border-t border-gray-200 z-10">
        <button onClick={save} disabled={phase !== 'ready'} className="w-full max-w-md mx-auto block py-4 rounded-2xl bg-gray-900 text-white text-lg font-bold disabled:opacity-60">
          {phase === 'saving' ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : savedAt ? '直して保存する' : 'レジ締めを保存する'}
        </button>
      </div>
    </div>
  )
}
