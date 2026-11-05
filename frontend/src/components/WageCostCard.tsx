import { useEffect, useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { usersApi, Shift, Store, User } from '../api/client'
import { storeColorMap } from '../lib/storeColors'

// ダッシュボードの「人件費（見込み）」。時給を見られる人（芝原・社長など）にだけ出す。
// その月のシフト（休憩を引いた時間）× 時給。時給はこの表でそのまま直せる（入れたらすぐ保存）。

const minutesOf = (s: Shift) => {
  const [sh, sm] = s.start_time.split(':').map(Number)
  const [eh, em] = s.end_time.split(':').map(Number)
  let m = eh * 60 + em - (sh * 60 + sm)
  if (m < 0) m += 24 * 60
  return Math.max(0, m - (s.break_minutes || 0))
}
const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const hours = (m: number) => { const h = m / 60; return h % 1 === 0 ? `${h}` : h.toFixed(1) }

export default function WageCostCard({ shifts, stores, month }: { shifts: Shift[]; stores: Store[]; month: number }) {
  const [users, setUsers] = useState<User[]>([])
  const [draft, setDraft] = useState<Record<number, string>>({})
  const colorOf = storeColorMap(stores)

  useEffect(() => {
    usersApi.getAll().then(r => setUsers(r.data.users || [])).catch(() => setUsers([]))
  }, [])

  const wageOf = (id: number) => Number(users.find(u => u.id === id)?.hourly_wage || 0)

  const rows = useMemo(() => {
    const by = new Map<number, number>()
    for (const s of shifts) by.set(s.user_id, (by.get(s.user_id) || 0) + minutesOf(s))
    return users
      .filter(u => by.has(u.id))
      .map(u => ({ u, mins: by.get(u.id)!, cost: (by.get(u.id)! / 60) * Number(u.hourly_wage || 0) }))
      .sort((a, b) => ((a.u.sort_order ?? 9999) - (b.u.sort_order ?? 9999)) || b.mins - a.mins)
  }, [shifts, users])

  const byStore = useMemo(() => {
    const m = new Map<number | null, number>()
    for (const s of shifts) m.set(s.store_id ?? null, (m.get(s.store_id ?? null) || 0) + (minutesOf(s) / 60) * wageOf(s.user_id))
    return [...m.entries()].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, users])

  // 時給なし（社長・役員など）は人件費にも「未設定」にも数えない
  const exempt = (u: User) => !!(u as any).wage_exempt
  const total = rows.reduce((a, r) => a + (exempt(r.u) ? 0 : r.cost), 0)
  const unset = rows.filter(r => !exempt(r.u) && !Number(r.u.hourly_wage)).length

  const save = async (u: User, v: string) => {
    if (v === '' && !Number(u.hourly_wage)) return
    const n = Math.max(0, Math.round(Number(v) || 0))
    if (n === Number(u.hourly_wage || 0)) { setDraft(d => { const x = { ...d }; delete x[u.id]; return x }); return }
    try {
      await usersApi.update(u.id, { hourly_wage: n } as any)
      setUsers(list => list.map(x => (x.id === u.id ? { ...x, hourly_wage: n } : x)))
      setDraft(d => { const x = { ...d }; delete x[u.id]; return x })
      toast.success(`${u.display_name || u.name}さんの時給を ${yen(n)} にしました`)
    } catch (e: any) {
      toast.error(e.response?.data?.error || '保存できませんでした')
    }
  }

  if (rows.length === 0) return null

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 sm:px-6 py-3 border-b border-gray-100 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-bold text-gray-900">{month}月の人件費（見込み）</h3>
        <span className="text-2xl font-bold text-gray-900 tabular-nums">{yen(total)}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500"><Lock className="w-3.5 h-3.5" />時給を見られる人だけに表示</span>
      </div>
      {stores.length > 1 && (
        <div className="px-4 sm:px-6 py-2.5 flex flex-wrap gap-2 border-b border-gray-100">
          {byStore.map(([id, cost]) => {
            const c = colorOf(id)
            return (
              <span key={id ?? 'none'} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold" style={{ backgroundColor: c.soft, color: c.text }}>
                {stores.find(st => st.id === id)?.name || '会場なし'}<span className="tabular-nums">{yen(cost)}</span>
              </span>
            )
          })}
        </div>
      )}
      {unset > 0 && (
        <p className="px-4 sm:px-6 py-2 text-sm text-amber-800 bg-amber-50 border-b border-amber-100">時給が未設定の人が{unset}人います。下の欄に入れると、すぐ保存されて計算に入ります。</p>
      )}
      <div className="divide-y divide-gray-100">
        {rows.map(({ u, mins, cost }) => (
          <div key={u.id} className="px-4 sm:px-6 py-2 flex items-center gap-3">
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">{u.display_name || u.name}</span>
            <span className="w-14 text-right text-sm text-gray-500 tabular-nums">{hours(mins)}h</span>
            {exempt(u) ? (
              <span className="w-[6.5rem] text-right text-sm text-gray-400">時給なし</span>
            ) : (
            <label className="flex items-center gap-1 text-sm text-gray-500">
              ¥
              <input
                type="number" inputMode="numeric" min={0} step={10}
                value={draft[u.id] ?? String(u.hourly_wage || '')}
                placeholder="時給"
                onChange={e => setDraft(d => ({ ...d, [u.id]: e.target.value }))}
                onBlur={e => save(u, e.currentTarget.value)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className={`w-20 rounded-md border px-2 py-1 text-right tabular-nums text-gray-900 ${Number(u.hourly_wage) ? 'border-gray-200' : 'border-amber-300 bg-amber-50'}`}
              />
            </label>
            )}
            <span className={`w-20 text-right text-sm font-bold tabular-nums ${exempt(u) ? 'text-gray-300' : 'text-gray-900'}`}>{exempt(u) ? '—' : yen(cost)}</span>
          </div>
        ))}
      </div>
      <p className="px-4 sm:px-6 py-2 text-xs text-gray-400 border-t border-gray-100">シフトの時間（休憩を引く）× 時給。スタッフや店長には時給も金額も見えません。</p>
    </div>
  )
}
