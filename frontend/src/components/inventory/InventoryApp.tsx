import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { InvApi, InvClosing, InvMe, InvRole } from '../../api/client'
import BuyPanel from './BuyPanel'
import CountPanel from './CountPanel'
import LoadPanel from './LoadPanel'
import MasterPanel from './MasterPanel'
import SalesPanel from './SalesPanel'
import StockPanel, { CompanyPanel } from './StockPanel'
import { InvCtx, Msg, errText, md } from './common'

// 催事の在庫の画面（LINE の中と管理画面で共通）。役割で見えるタブが変わる。

type Tab = 'count' | 'sales' | 'buy' | 'load' | 'company' | 'stock' | 'master'
const TABS: { id: Tab; label: string; roles: InvRole[]; web?: boolean }[] = [
  { id: 'count', label: '残りの数え', roles: ['part', 'full', 'admin'] },
  { id: 'sales', label: 'レジ締め', roles: ['full', 'admin'] },
  { id: 'buy', label: '買い足し・足りない', roles: ['part', 'full', 'admin'] },
  { id: 'load', label: '積み込み', roles: ['admin'] },
  { id: 'company', label: '会社在庫', roles: ['admin'] },
  { id: 'stock', label: '在庫・記録', roles: ['full', 'admin'] },
  { id: 'master', label: '設定', roles: ['admin'], web: true },
]
const STORE_TABS: Tab[] = ['count', 'sales', 'buy']

export default function InventoryApp({ api, inLine, initialTab }: { api: InvApi; inLine: boolean; initialTab?: string | null }) {
  const [me, setMe] = useState<InvMe | null>(null)
  const [err, setErr] = useState('')
  const [storeId, setStoreId] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const [tab, setTab] = useState<Tab>((TABS.some(t => t.id === initialTab) ? initialTab : 'count') as Tab)
  const [status, setStatus] = useState<InvClosing[]>([])
  const [version, setVersion] = useState(0)

  const loadMe = async () => {
    try {
      const r = await api.me()
      setMe(r.data)
      if (r.data.enabled) {
        setStoreId(s => s ?? r.data.my_store ?? r.data.stores?.[0]?.id ?? null)
        setDate(d => d || r.data.date!)
      }
    } catch (e) { setErr(errText(e, '開けませんでした')) }
  }
  useEffect(() => { loadMe() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!me?.enabled || !date) return
    api.status(date).then(r => setStatus(r.data.stores)).catch(() => {})
  }, [me?.enabled, date, version]) // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <Msg kind="err">{err}</Msg>
  if (!me) return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>

  if (!me.enabled) {
    if (me.role === 'admin' && !inLine) return <div className="space-y-4"><Msg kind="info">在庫の機能はまだ有効になっていません。初期データを入れて「在庫の機能を使う」にチェックすると使えます。</Msg><MasterPanel api={api} onChanged={loadMe} /></div>
    return <Msg kind="info">在庫の機能はまだ使えるようになっていません。</Msg>
  }

  const tabs = TABS.filter(t => t.roles.includes(me.role) && !(t.web && inLine))
  const cur = tabs.some(t => t.id === tab) ? tab : 'count'
  const st = status.find(s => s.store_id === storeId)
  const ctx: InvCtx | null = storeId ? { api, me: me as InvCtx['me'], storeId, date, inLine, onSaved: () => setVersion(v => v + 1) } : null
  const today = me.date!

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-600">{me.name}さん</p>
          {me.role !== 'part'
            ? <input type="date" value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} className="h-9 rounded-lg border border-gray-300 px-2 text-sm" />
            : <p className="text-sm font-bold">{md(date)}</p>}
        </div>
        {date !== today && <Msg kind="warn">{md(date)}の分を直しています（今日は{md(today)}）</Msg>}
        {STORE_TABS.includes(cur) && (
          <div className="flex gap-2">
            {me.stores!.map(s => (
              <button key={s.id} onClick={() => setStoreId(s.id)} className={`flex-1 py-3 rounded-xl font-bold ${storeId === s.id ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>{s.name}</button>
            ))}
          </div>
        )}
        {STORE_TABS.includes(cur) && st && (
          <p className="text-sm text-gray-700 flex items-center gap-3">
            <span className="flex items-center gap-1">{st.counted ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Circle className="w-4 h-4 text-gray-400" />}残りの数え</span>
            <span className="flex items-center gap-1">{st.sales_done ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Circle className="w-4 h-4 text-gray-400" />}レジ締め</span>
            {st.complete && <span className="font-bold text-green-700">締め完了</span>}
            {st.open_today === false && <span className="text-gray-500">（この日は休み）</span>}
          </p>
        )}
      </div>

      <nav className="flex gap-1 overflow-x-auto -mx-4 px-4 pb-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold ${cur === t.id ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>{t.label}</button>
        ))}
      </nav>

      {ctx && (
        <div key={`${cur}-${storeId}-${date}`}>
          {cur === 'count' && <CountPanel ctx={ctx} loc={storeId!} />}
          {cur === 'sales' && <SalesPanel ctx={ctx} />}
          {cur === 'buy' && <BuyPanel ctx={ctx} />}
          {cur === 'load' && <LoadPanel ctx={ctx} />}
          {cur === 'company' && <CompanyPanel ctx={ctx} />}
          {cur === 'stock' && <StockPanel ctx={ctx} />}
          {cur === 'master' && <MasterPanel api={api} onChanged={loadMe} />}
        </div>
      )}
    </div>
  )
}
