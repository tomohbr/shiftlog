import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { InvApi, InvItem, InvMenu, InvSettings } from '../../api/client'
import { Card, Msg, errText } from './common'

// 在庫の設定（担当者・管理画面だけ）: 使う会場と通知先、品目、メニューと1食あたりの使用数、予想の土台

type Master = Awaited<ReturnType<InvApi['master']>>['data']
const DT = [['weekday', '平日'], ['sat', '土曜'], ['sun', '日曜・祝日']] as const
const inp = 'h-9 rounded-lg border border-gray-300 px-2 text-sm'

function SettingsForm({ api, m, onSaved }: { api: InvApi; m: Master; onSaved: () => void }) {
  const [s, setS] = useState<InvSettings>(m.settings || { company_id: 0, enabled: 0, store_ids: [], notify_user_ids: [], margin_pct: 15, special_days: {}, active_from: null, active_to: null })
  const [special, setSpecial] = useState(Object.entries(s.special_days || {}).map(([d, t]) => `${d} ${t}`).join('\n'))
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const toggle = (k: 'store_ids' | 'notify_user_ids', id: number) => setS(v => ({ ...v, [k]: v[k].includes(id) ? v[k].filter(x => x !== id) : [...v[k], id] }))
  const save = async () => {
    const sd: Record<string, string> = {}
    for (const line of special.split('\n')) { const [d, t] = line.trim().split(/\s+/); if (d && t) sd[d] = t }
    try { await api.saveSettings({ ...s, special_days: sd }); setMsg({ kind: 'ok', text: '保存しました' }); onSaved() } catch (e) { setMsg({ kind: 'err', text: errText(e, '保存できませんでした') }) }
  }
  return (
    <Card title="使い方の設定">
      <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={!!s.enabled} onChange={e => setS({ ...s, enabled: e.target.checked ? 1 : 0 })} className="w-5 h-5" />在庫の機能を使う</label>
      <div><p className="text-sm font-bold mb-1">在庫を持つ会場</p><div className="flex flex-wrap gap-2">{m.stores.map(st => <label key={st.id} className="flex items-center gap-1 text-sm border rounded-lg px-2 py-1"><input type="checkbox" checked={s.store_ids.includes(st.id)} onChange={() => toggle('store_ids', st.id)} />{st.name}</label>)}</div></div>
      <div><p className="text-sm font-bold mb-1">LINE で通知を受け取る人（締めの抜け・積み込みリスト・会社在庫の日）</p><div className="flex flex-wrap gap-2">{m.users.map(u => <label key={u.id} className={`flex items-center gap-1 text-sm border rounded-lg px-2 py-1 ${u.line_linked ? '' : 'opacity-50'}`}><input type="checkbox" checked={s.notify_user_ids.includes(u.id)} onChange={() => toggle('notify_user_ids', u.id)} />{u.name}{!u.line_linked && '（LINE未連携）'}</label>)}</div><p className="text-xs text-gray-500 mt-1">誰も選ばないと、LINE連携済みの管理者全員に届きます。</p></div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>余裕 <input type="number" value={s.margin_pct} onChange={e => setS({ ...s, margin_pct: Number(e.target.value) })} className={`${inp} w-16`} /> %</label>
        <label>通知する期間 <input type="date" value={s.active_from || ''} onChange={e => setS({ ...s, active_from: e.target.value || null })} className={inp} /> 〜 <input type="date" value={s.active_to || ''} onChange={e => setS({ ...s, active_to: e.target.value || null })} className={inp} /></label>
      </div>
      <label className="block text-sm"><span className="font-bold">特別な日</span>（1行に「日付 曜日区分」。曜日区分は weekday / sat / sun）
        <textarea value={special} onChange={e => setSpecial(e.target.value)} rows={3} className="w-full rounded-lg border border-gray-300 p-2 font-mono text-sm" placeholder="2026-12-24 sat" /></label>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <button onClick={save} className="px-5 py-2 rounded-lg bg-gray-900 text-white font-bold">設定を保存</button>
    </Card>
  )
}

function ItemsTable({ api, items, onSaved }: { api: InvApi; items: InvItem[]; onSaved: () => void }) {
  const [rows, setRows] = useState(items)
  const [msg, setMsg] = useState('')
  useEffect(() => setRows(items), [items])
  const set = (id: number, k: keyof InvItem, v: unknown) => setRows(r => r.map(x => (x.id === id ? { ...x, [k]: v } : x)))
  const save = async (it: InvItem) => { try { await api.saveItem(it); setMsg(`${it.name} を保存しました`); onSaved() } catch (e) { setMsg(errText(e, '保存できませんでした')) } }
  const add = async () => { const name = prompt('品目の名前'); if (!name) return; try { await api.addItem({ name, count_unit: '個', use_unit: '個', per_count: 1, category: 'food', source: 'kobo', sort: 999 }); onSaved() } catch (e) { setMsg(errText(e, '追加できませんでした')) } }
  return (
    <Card title="品目" right={<button onClick={add} className="text-sm flex items-center gap-1 text-blue-600"><Plus className="w-4 h-4" />追加</button>}>
      <p className="text-xs text-gray-500">「1数え単位＝」は、数える単位1つで何回分使えるか（スープ1袋＝35食など）。仕入れ品は会社の在庫を追って発注の目安を出します。</p>
      <div className="overflow-x-auto">
        <table className="text-sm min-w-[1000px]">
          <thead><tr className="text-xs text-gray-500 text-left"><th>名前</th><th>種類</th><th>数える単位</th><th>使う単位</th><th>1数え単位＝</th><th>0.5</th><th>出どころ</th><th>会社在庫</th><th>届くまで日</th><th>会場の上限</th><th>差の許容</th><th>メモ</th><th>使う</th><th /></tr></thead>
          <tbody>
            {rows.map(it => (
              <tr key={it.id} className="border-t border-gray-100">
                <td><input value={it.name} onChange={e => set(it.id, 'name', e.target.value)} className={`${inp} w-44`} /></td>
                <td><select value={it.category} onChange={e => set(it.id, 'category', e.target.value)} className={inp}><option value="food">食材</option><option value="container">容器</option></select></td>
                <td><input value={it.count_unit} onChange={e => set(it.id, 'count_unit', e.target.value)} className={`${inp} w-14`} /></td>
                <td><input value={it.use_unit} onChange={e => set(it.id, 'use_unit', e.target.value)} className={`${inp} w-14`} /></td>
                <td><input type="number" value={it.per_count} onChange={e => set(it.id, 'per_count', Number(e.target.value))} className={`${inp} w-16`} /></td>
                <td className="text-center"><input type="checkbox" checked={!!it.half_ok} onChange={e => set(it.id, 'half_ok', e.target.checked ? 1 : 0)} /></td>
                <td><select value={it.source} onChange={e => set(it.id, 'source', e.target.value)} className={inp}><option value="kobo">工房</option><option value="purchase">仕入れ</option></select></td>
                <td className="text-center"><input type="checkbox" checked={!!it.track_company} onChange={e => set(it.id, 'track_company', e.target.checked ? 1 : 0)} /></td>
                <td><input type="number" value={it.lead_days ?? ''} onChange={e => set(it.id, 'lead_days', e.target.value === '' ? null : Number(e.target.value))} className={`${inp} w-14`} /></td>
                <td><input type="number" value={it.cap_per_venue ?? ''} onChange={e => set(it.id, 'cap_per_venue', e.target.value === '' ? null : Number(e.target.value))} className={`${inp} w-16`} /></td>
                <td><input type="number" value={it.tolerance} onChange={e => set(it.id, 'tolerance', Number(e.target.value))} className={`${inp} w-14`} /></td>
                <td><input value={it.note || ''} onChange={e => set(it.id, 'note', e.target.value)} className={`${inp} w-48`} /></td>
                <td className="text-center"><input type="checkbox" checked={!!it.active} onChange={e => set(it.id, 'active', e.target.checked ? 1 : 0)} /></td>
                <td><button onClick={() => save(it)} className="px-3 py-1 rounded bg-gray-800 text-white text-xs">保存</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className="text-sm text-gray-700">{msg}</p>}
    </Card>
  )
}

function MenuEditor({ api, menu, items, stores, onSaved }: { api: InvApi; menu: InvMenu; items: InvItem[]; stores: { id: number; name: string }[]; onSaved: () => void }) {
  const [m, setM] = useState(menu)
  const [msg, setMsg] = useState('')
  useEffect(() => setM(menu), [menu])
  const unit = (id: number) => items.find(i => i.id === id)?.use_unit || ''
  const save = async () => { try { await api.saveMenu(m); setMsg('保存しました'); onSaved() } catch (e) { setMsg(errText(e, '保存できませんでした')) } }
  return (
    <div className="border border-gray-200 rounded-xl p-3 space-y-2">
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <input value={m.name} onChange={e => setM({ ...m, name: e.target.value })} className={`${inp} w-36 font-bold`} />
        <label>レジの表示 <input value={m.register_label || ''} onChange={e => setM({ ...m, register_label: e.target.value })} className={`${inp} w-32`} /></label>
        <label>単価 <input type="number" value={m.price ?? ''} onChange={e => setM({ ...m, price: e.target.value === '' ? null : Number(e.target.value) })} className={`${inp} w-20`} /></label>
        <span>会場:</span>
        {stores.map(st => <label key={st.id} className="flex items-center gap-1"><input type="checkbox" checked={!m.store_ids || m.store_ids.includes(st.id)} onChange={e => {
          const cur = m.store_ids || stores.map(x => x.id)
          const next = e.target.checked ? [...cur, st.id] : cur.filter(x => x !== st.id)
          setM({ ...m, store_ids: next.length === stores.length ? null : next })
        }} />{st.name}</label>)}
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!m.active} onChange={e => setM({ ...m, active: e.target.checked ? 1 : 0 })} />使う</label>
      </div>
      <p className="text-xs text-gray-500">1つ売ると使うもの</p>
      {m.parts.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <select value={p.item_id} onChange={e => setM({ ...m, parts: m.parts.map((x, j) => (j === i ? { ...x, item_id: Number(e.target.value) } : x)) })} className={inp}>
            {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
          </select>
          <input type="number" value={p.qty} onChange={e => setM({ ...m, parts: m.parts.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)) })} className={`${inp} w-16`} />
          <span className="text-gray-500">{unit(p.item_id)}</span>
          <button onClick={() => setM({ ...m, parts: m.parts.filter((_, j) => j !== i) })} className="text-gray-400"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      <div className="flex gap-3 items-center">
        <button onClick={() => setM({ ...m, parts: [...m.parts, { item_id: items[0]?.id, qty: 1 }] })} className="text-sm text-blue-600 flex items-center gap-1"><Plus className="w-4 h-4" />使うものを追加</button>
        <button onClick={save} className="ml-auto px-3 py-1 rounded bg-gray-800 text-white text-xs">保存</button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </div>
  )
}

function Baselines({ api, m, onSaved }: { api: InvApi; m: Master; onSaved: () => void }) {
  const ids = m.settings?.store_ids || []
  const key = (s: number, menu: number, d: string) => `${s}:${menu}:${d}`
  const [v, setV] = useState<Record<string, number | ''>>(() => Object.fromEntries(m.baselines.map(b => [key(b.store_id, b.menu_id, b.daytype), b.qty])))
  const [msg, setMsg] = useState('')
  const save = async () => {
    const rows = Object.entries(v).filter(([, q]) => q !== '').map(([k, q]) => { const [s, mm, d] = k.split(':'); return { store_id: Number(s), menu_id: Number(mm), daytype: d, qty: Number(q) } })
    try { await api.saveBaselines(rows); setMsg('保存しました'); onSaved() } catch (e) { setMsg(errText(e, '保存できませんでした')) }
  }
  return (
    <Card title="予想の土台（去年の1日平均）">
      <p className="text-xs text-gray-500">今年の同じ会場・同じ曜日区分の実績が2日分たまると、そちらを使います。新メニューは仮の数を入れてください。</p>
      {ids.map(sid => (
        <div key={sid} className="overflow-x-auto">
          <p className="font-bold text-sm mt-2">{m.stores.find(s => s.id === sid)?.name}</p>
          <table className="text-sm"><thead><tr className="text-xs text-gray-500"><th className="text-left">メニュー</th>{DT.map(([k, l]) => <th key={k} className="px-2">{l}</th>)}</tr></thead>
            <tbody>{m.menus.filter(mm => !mm.store_ids || mm.store_ids.includes(sid)).map(mm => (
              <tr key={mm.id}><td className="pr-3">{mm.name}</td>{DT.map(([k]) => (
                <td key={k} className="px-1"><input type="number" value={v[key(sid, mm.id, k)] ?? ''} onChange={e => setV(x => ({ ...x, [key(sid, mm.id, k)]: e.target.value === '' ? '' : Number(e.target.value) }))} className={`${inp} w-20 text-right`} /></td>
              ))}</tr>
            ))}</tbody></table>
        </div>
      ))}
      <div className="flex items-center gap-3"><button onClick={save} className="px-5 py-2 rounded-lg bg-gray-900 text-white font-bold">土台を保存</button>{msg && <span className="text-sm">{msg}</span>}</div>
    </Card>
  )
}

export default function MasterPanel({ api, onChanged }: { api: InvApi; onChanged: () => void }) {
  const [m, setM] = useState<Master | null>(null)
  const [err, setErr] = useState('')
  const load = async () => { try { setM((await api.master()).data); setErr('') } catch (e) { setErr(errText(e, '読み込めませんでした')) } }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => { load(); onChanged() }
  if (err) return <Msg kind="err">{err}</Msg>
  if (!m) return <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-gray-400" /></div>
  const seed = async () => {
    if (!confirm('クリスマスマーケット用の初期データ（品目16・メニュー9・去年の1日平均）を入れます。よろしいですか？')) return
    try { await api.seed(); reload() } catch (e) { alert(errText(e, '入れられませんでした')) }
  }
  return (
    <div className="space-y-4">
      {m.items.length === 0 && (
        <Card title="はじめに">
          <p className="text-sm">品目がまだありません。2026年クリスマスマーケットの初期データ（熊本駅・花畑、2025年の実績から作った予想の土台つき）を入れられます。会場の名前に「駅」「花畑」を含む店舗に割り当てます。</p>
          <button onClick={seed} className="px-5 py-2 rounded-lg bg-[#06C755] text-white font-bold">初期データを入れる</button>
        </Card>
      )}
      <SettingsForm api={api} m={m} onSaved={reload} />
      <ItemsTable api={api} items={m.items} onSaved={reload} />
      <Card title="メニュー（レジの部門）" right={<button onClick={async () => { const name = prompt('メニューの名前'); if (name) { await api.addMenu({ name, parts: [], sort: 999 }); reload() } }} className="text-sm flex items-center gap-1 text-blue-600"><Plus className="w-4 h-4" />追加</button>}>
        {m.menus.map(mm => <MenuEditor key={mm.id} api={api} menu={mm} items={m.items} stores={m.stores.filter(s => m.settings?.store_ids.includes(s.id))} onSaved={reload} />)}
      </Card>
      <Baselines key={m.baselines.length} api={api} m={m} onSaved={reload} />
    </div>
  )
}
