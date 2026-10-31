import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, X, Lock, Repeat, UserMinus, UserPlus, Users, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { venueScheduleApi, DraftView, DraftSlot, DraftPerson, DraftCandidate, DraftStaff } from '../../api/client'
import { StoreColor } from '../../lib/storeColors'

// 期間の募集で答えた「入りたい会場」以外の枠（サーバーの candidates の reason と同じ文言）
const OTHER_VENUE = '希望の会場ではない'

// 下書きの確認画面。管理者が最初に知りたい「どこが足りないか」「誰が多すぎ／少なすぎか」を上と右に出し、
// 真ん中は 行=会場の時間帯・列=日付 の表。セルを押すと、その枠の人の差し替え・外す・足すができる。

const DOW = ['日', '月', '火', '水', '木', '金', '土']

const hours = (min: number) => {
  const h = min / 60
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}
const dayInfo = (date: string) => {
  const d = new Date(date + 'T00:00:00')
  return { day: d.getDate(), month: d.getMonth() + 1, dow: d.getDay() }
}

interface Props {
  view: DraftView
  colorOf: (storeId?: number | null) => StoreColor
  onChange: (v: DraftView) => void
}

export default function DraftBoard({ view, colorOf, onChange }: Props) {
  const editable = view.draft.status === 'draft'
  const [onlyShort, setOnlyShort] = useState(false)
  const [focusUser, setFocusUser] = useState<number | null>(null)
  const [openSlot, setOpenSlot] = useState<DraftSlot | null>(null)

  // 日付の列
  const dates = useMemo(() => {
    const out: string[] = []
    const d = new Date(view.draft.start_date + 'T00:00:00')
    const last = new Date(view.draft.end_date + 'T00:00:00')
    while (d <= last) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [view.draft.start_date, view.draft.end_date])

  // 行: 会場ごとに、時間帯（開始-終了）の種類で1行
  const rows = useMemo(() => {
    const venueIds = [...new Set(view.slots.map(s => s.store_id ?? 0))]
      .sort((a, b) => a - b)
    return venueIds.map(vid => {
      const mine = view.slots.filter(s => (s.store_id ?? 0) === vid)
      const bands = [...new Set(mine.map(s => `${s.start_time}-${s.end_time}`))].sort()
      return {
        storeId: vid || null,
        name: vid ? (view.stores.find(st => st.id === vid)?.name || '（削除された会場）') : '会場指定なし',
        short: mine.reduce((a, s) => a + s.short, 0),
        bands: bands.map(b => {
          const byDate = new Map<string, DraftSlot>()
          for (const s of mine) if (`${s.start_time}-${s.end_time}` === b) byDate.set(s.date, s)
          return { band: b, byDate, short: [...byDate.values()].reduce((a, s) => a + s.short, 0) }
        }),
      }
    })
  }, [view])

  const shortDates = useMemo(() => new Set(view.slots.filter(s => s.short > 0).map(s => s.date)), [view])
  const shownDates = onlyShort ? dates.filter(d => shortDates.has(d)) : dates

  // 人ごとの負担。平均との差で「多い／少ない」を出す（少ないは、まだ入れる日が残っている人だけ）
  const staffStats = useMemo(() => {
    const working = view.staff.filter(s => s.minutes > 0 || s.preferred_days + s.available_days > 0)
    const avg = working.length ? working.reduce((a, s) => a + s.minutes, 0) / working.length : 0
    const max = Math.max(1, ...view.staff.map(s => s.minutes))
    return {
      avg, max,
      list: [...view.staff].sort((a, b) => b.minutes - a.minutes).map(s => {
        const offered = s.preferred_days + s.available_days
        const tag: 'many' | 'few' | null = avg > 0 && s.minutes >= avg * 1.2 ? 'many'
          : avg > 0 && s.minutes <= avg * 0.8 && offered > s.days ? 'few' : null
        return { ...s, offered, tag }
      }),
    }
  }, [view.staff])

  const existingCount = view.slots.reduce((a, s) => a + s.people.filter(p => p.source === 'existing').length, 0)
  const most = staffStats.list[0]
  const least = [...staffStats.list].reverse().find(s => s.offered > 0 || s.minutes > 0)

  return (
    <div className="space-y-3">
      {/* いちばん知りたいこと: 足りているか・偏っていないか */}
      <div className="grid gap-2 sm:grid-cols-3">
        {view.totals.short_people > 0 ? (
          <button onClick={() => setOnlyShort(v => !v)}
            className={`text-left rounded-xl border-2 px-4 py-3 transition-colors ${onlyShort ? 'border-red-500 bg-red-50' : 'border-red-200 bg-red-50/60 hover:border-red-400'}`}>
            <p className="text-xs font-bold text-red-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />人が足りない枠</p>
            <p className="text-2xl font-black text-red-600 leading-tight">{view.totals.short_slots}<span className="text-sm font-bold ml-0.5">枠</span>
              <span className="text-base font-bold ml-2">あと{view.totals.short_people}人</span></p>
            <p className="text-[11px] text-red-700/80">{onlyShort ? '足りない日だけ表示中（押すと全部）' : '押すと足りない日だけ表示'}</p>
          </button>
        ) : (
          <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs font-bold text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />人数</p>
            <p className="text-lg font-black text-green-700">全部の枠が埋まりました</p>
          </div>
        )}
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs font-bold text-gray-500">埋まった人数</p>
          <p className="text-2xl font-black text-gray-900 leading-tight tabular-nums">{view.totals.filled}<span className="text-sm text-gray-400 font-bold"> / {view.totals.needed}人</span></p>
          <p className="text-[11px] text-gray-500">下書き {view.totals.draft_count}件 ＋ 確定済みのシフト {existingCount}件</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs font-bold text-gray-500">偏り（期間の合計時間）</p>
          {most && least ? (
            <p className="text-sm text-gray-800 leading-relaxed">
              最多 <b>{most.name}</b> {hours(most.minutes)}・{most.days}日<br />
              最少 <b>{least.name}</b> {hours(least.minutes)}・{least.days}日
              <span className="text-gray-400">（入れる日 {least.offered}日）</span>
            </p>
          ) : <p className="text-sm text-gray-400">—</p>}
        </div>
      </div>

      {view.conflicts.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>同じ時間に2か所入っている人がいます: {view.conflicts.map(c => `${c.user_name}（${dayInfo(c.date).month}/${dayInfo(c.date).day}）`).join('、')}。確定すると重なる分は入りません。</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3 items-start">
        {/* 会場×日付の表 */}
        <div className="card p-0 overflow-hidden w-full lg:flex-1 lg:min-w-0">
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs" style={{ minWidth: `${shownDates.length * 76 + 150}px` }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2 font-semibold text-gray-500 border-r border-gray-200 min-w-[150px] w-[150px]">会場・時間帯</th>
                  {shownDates.map(d => {
                    const { day, month, dow } = dayInfo(d)
                    const short = shortDates.has(d)
                    return (
                      <th key={d} className={`text-center py-1.5 font-medium border-r border-gray-100 min-w-[76px] w-[76px] ${dow === 0 ? 'bg-red-50' : dow === 6 ? 'bg-blue-50' : ''}`}>
                        <div className={dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'}>
                          {day === 1 || d === shownDates[0] ? `${month}/` : ''}{day}<span className="ml-0.5 text-[10px]">{DOW[dow]}</span>
                        </div>
                        {short && <div className="mx-auto mt-0.5 w-1.5 h-1.5 rounded-full bg-red-500" title="足りない枠がある日" />}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const c = colorOf(r.storeId)
                  return [
                    <tr key={`h-${r.storeId}`} className="border-t-2 border-gray-200">
                      <td className="sticky left-0 z-10 px-3 py-1.5 border-r border-gray-200" style={{ backgroundColor: c.soft }}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.solid }} />
                          <span className="font-bold text-sm" style={{ color: c.text }}>{r.name}</span>
                          {r.short > 0 && <span className="ml-auto text-[11px] font-bold text-red-600">あと{r.short}</span>}
                        </div>
                      </td>
                      <td colSpan={shownDates.length} style={{ backgroundColor: c.soft }} />
                    </tr>,
                    ...r.bands.map(b => (
                      <tr key={`${r.storeId}-${b.band}`} className="border-t border-gray-100 align-top">
                        <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-r border-gray-200" style={{ boxShadow: `inset 3px 0 0 ${c.solid}` }}>
                          <div className="font-bold text-gray-800 tabular-nums">{b.band.replace('-', '–')}</div>
                          {b.short > 0 && <div className="text-[10px] font-bold text-red-600">不足 {b.short}人</div>}
                        </td>
                        {shownDates.map(d => {
                          const s = b.byDate.get(d)
                          if (!s) return <td key={d} className="border-r border-gray-100 bg-gray-50/70" />
                          return (
                            <td key={d} className="border-r border-gray-100 p-0">
                              <SlotCell slot={s} focusUser={focusUser} onOpen={() => setOpenSlot(s)} />
                            </td>
                          )
                        })}
                      </tr>
                    )),
                  ]
                })}
              </tbody>
            </table>
            {onlyShort && shownDates.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8">足りない枠はありません</p>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 border-t border-gray-100 text-[11px] text-gray-500">
            <span><b className="text-gray-800">◎</b> 希望日</span>
            <span><b className="text-gray-800">○</b> 出勤可</span>
            <span className="flex items-center gap-0.5"><Lock className="w-3 h-3" /> 確定済みのシフト</span>
            <span className="flex items-center gap-0.5"><AlertTriangle className="w-3 h-3 text-amber-500" /> 希望の時間と一部ずれ・未提出</span>
            <span className="text-blue-600 font-bold">● 手で入れた</span>
          </div>
        </div>

        {/* スタッフごとの合計 */}
        <div className="card p-0 w-full lg:w-72 flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-gray-100">
            <p className="text-sm font-bold text-gray-800 flex items-center gap-1.5"><Users className="w-4 h-4" />スタッフごとの合計</p>
            <p className="text-[11px] text-gray-500">平均 {hours(Math.round(staffStats.avg))}。名前を押すと表でその人に色が付きます</p>
          </div>
          <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
            {staffStats.list.map(s => (
              <StaffRow key={s.id} s={s} max={staffStats.max} avg={staffStats.avg} focused={focusUser === s.id}
                onClick={() => setFocusUser(focusUser === s.id ? null : s.id)} />
            ))}
          </ul>
        </div>
      </div>

      {openSlot && (
        <SlotModal
          view={view}
          slot={view.slots.find(s => s.id === openSlot.id) || openSlot}
          color={colorOf(openSlot.store_id)}
          storeName={openSlot.store_id ? view.stores.find(st => st.id === openSlot.store_id)?.name || '' : '会場指定なし'}
          editable={editable}
          onClose={() => setOpenSlot(null)}
          onChange={onChange}
        />
      )}
    </div>
  )
}

function SlotCell({ slot, focusUser, onOpen }: { slot: DraftSlot; focusUser: number | null; onOpen: () => void }) {
  const short = slot.short > 0
  return (
    <button onClick={onOpen}
      className={`w-full min-h-[44px] text-left px-1 py-1 space-y-0.5 hover:ring-2 hover:ring-inset hover:ring-blue-400 transition ${short ? 'bg-red-50' : ''}`}>
      {slot.people.map((p, i) => <PersonChip key={`${p.user_id}-${i}`} p={p} dim={focusUser != null && focusUser !== p.user_id} focus={focusUser === p.user_id} />)}
      {short && (
        <div className="text-[11px] font-black text-red-600 border border-dashed border-red-300 rounded px-1 text-center bg-white/70">あと{slot.short}人</div>
      )}
      {slot.over > 0 && <div className="text-[10px] font-bold text-amber-600 text-center">+{slot.over}人多い</div>}
    </button>
  )
}

function PersonChip({ p, dim, focus }: { p: DraftPerson; dim: boolean; focus: boolean }) {
  const warn = p.partial || !!p.warning || (p.source !== 'existing' && !p.availability)
  const mark = p.availability === 'preferred' ? '◎' : p.availability === 'available' ? '○' : ''
  return (
    <div className={`flex items-center gap-0.5 rounded px-1 leading-5 truncate ${
      focus ? 'bg-gray-900 text-white' : p.source === 'existing' ? 'bg-gray-100 text-gray-600' : 'bg-white border border-gray-200 text-gray-800'
    } ${dim ? 'opacity-30' : ''}`}
      title={`${p.user_name}${p.source === 'existing' ? '（確定済み）' : p.source === 'manual' ? '（手で入れた）' : ''}${p.warning ? ` / ${p.warning}` : ''}`}>
      {p.source === 'existing' ? <Lock className="w-2.5 h-2.5 flex-shrink-0" /> : <span className="text-[10px] w-2.5 flex-shrink-0">{mark}</span>}
      <span className={`truncate font-medium ${p.source === 'manual' && !focus ? 'text-blue-700' : ''}`}>{p.user_name}</span>
      {(p.start_time || p.end_time) && <span className="text-[10px] tabular-nums flex-shrink-0 opacity-80">{p.start_time ? `${p.start_time}〜` : `〜${p.end_time}`}</span>}
      {warn && <AlertTriangle className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />}
    </div>
  )
}

function StaffRow({ s, max, avg, focused, onClick }: {
  s: DraftStaff & { offered: number; tag: 'many' | 'few' | null }
  max: number; avg: number; focused: boolean; onClick: () => void
}) {
  return (
    <li>
      <button onClick={onClick} className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${focused ? 'bg-gray-100' : ''}`}>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color || '#868E96' }} />
          <span className="font-bold text-gray-800 truncate">{s.name}</span>
          {s.tag === 'many' && <span className="text-[10px] font-bold px-1.5 rounded bg-amber-100 text-amber-800">多い</span>}
          {s.tag === 'few' && <span className="text-[10px] font-bold px-1.5 rounded bg-blue-100 text-blue-800">少ない</span>}
          <span className="ml-auto tabular-nums text-gray-900 font-bold">{s.days}日</span>
          <span className="tabular-nums text-gray-600 w-12 text-right">{hours(s.minutes)}</span>
        </div>
        <div className="relative h-1.5 bg-gray-100 rounded mt-1.5">
          <div className="absolute inset-y-0 left-0 rounded bg-gray-400" style={{ width: `${(s.minutes / max) * 100}%` }} />
          <div className="absolute -top-0.5 -bottom-0.5 w-px bg-gray-700" style={{ left: `${(avg / max) * 100}%` }} title="平均" />
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          {s.submitted ? <>入れる日 {s.offered}日（◎{s.preferred_days}）・不可 {s.unavailable_days}日</> : <span className="text-amber-600">希望が未提出</span>}
          {s.existing_minutes > 0 && <> ・確定済み {hours(s.existing_minutes)}</>}
        </p>
      </button>
    </li>
  )
}

function SlotModal({ view, slot, color, storeName, editable, onClose, onChange }: {
  view: DraftView; slot: DraftSlot; color: StoreColor; storeName: string; editable: boolean
  onClose: () => void; onChange: (v: DraftView) => void
}) {
  const [candidates, setCandidates] = useState<DraftCandidate[] | null>(null)
  const [replacing, setReplacing] = useState<DraftPerson | null>(null)
  const [busy, setBusy] = useState(false)
  const { day, month, dow } = dayInfo(slot.date)

  useEffect(() => {
    let alive = true
    setCandidates(null)
    venueScheduleApi.candidates(view.draft.id, slot.id)
      .then(r => { if (alive) setCandidates(r.data.candidates) })
      .catch(() => { if (alive) setCandidates([]) })
    return () => { alive = false }
    // 人を入れ替えたら候補も取り直す
  }, [view.draft.id, slot.id, slot.people.length, slot.people.map(p => p.user_id).join(',')])

  const run = async (fn: () => Promise<{ data: DraftView }>, msg: string) => {
    setBusy(true)
    try {
      const r = await fn()
      onChange(r.data)
      setReplacing(null)
      toast.success(msg)
    } catch (e: any) {
      toast.error(e.response?.data?.error || '変更できませんでした')
    } finally { setBusy(false) }
  }

  const pick = (c: DraftCandidate) => run(
    () => venueScheduleApi.assign(view.draft.id, { slot_id: slot.id, user_id: c.user_id, replace_assignment_id: replacing?.assignment_id ?? undefined }),
    replacing ? `${replacing.user_name}さん → ${c.name}さんに差し替えました` : `${c.name}さんを入れました`,
  )
  const remove = (p: DraftPerson) => run(() => venueScheduleApi.unassign(view.draft.id, p.assignment_id!), `${p.user_name}さんを外しました`)

  const usable = (candidates || []).filter(c => c.ok && !c.in_slot)
  const rank = (c: DraftCandidate) => (c.availability === 'preferred' ? 0 : c.availability === 'available' ? 1 : 2) + (c.partial ? 0.5 : 0) + (c.reason === OTHER_VENUE ? 3 : 0)
  usable.sort((a, b) => rank(a) - rank(b) || a.minutes - b.minutes)
  const blocked = (candidates || []).filter(c => !c.ok && !c.in_slot)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between px-5 py-3 border-b border-gray-200" style={{ boxShadow: `inset 4px 0 0 ${color.solid}` }}>
          <div>
            <p className="text-xs font-bold flex items-center gap-1" style={{ color: color.text }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color.solid }} />{storeName}
            </p>
            <h2 className="text-lg font-bold text-gray-900">
              {month}/{day}（{DOW[dow]}） {slot.start_time}–{slot.end_time}
            </h2>
            <p className={`text-sm font-bold ${slot.short > 0 ? 'text-red-600' : 'text-gray-500'}`}>
              必要 {slot.needed}人 ／ 入っている {slot.people.length}人{slot.short > 0 ? `（あと${slot.short}人）` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          <section className="space-y-1.5">
            {slot.people.length === 0 && <p className="text-sm text-gray-400">まだ誰も入っていません</p>}
            {slot.people.map(p => (
              <div key={`${p.user_id}-${p.assignment_id}`} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${replacing?.assignment_id === p.assignment_id && p.assignment_id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <div className="min-w-0">
                  <p className="font-bold text-gray-900 text-sm flex items-center gap-1">
                    {p.source === 'existing' && <Lock className="w-3.5 h-3.5 text-gray-400" />}{p.user_name}
                    <span className="text-xs font-normal text-gray-500">
                      {p.availability === 'preferred' ? '◎希望' : p.availability === 'available' ? '○出勤可' : p.source === 'existing' ? '' : '希望未提出'}
                      {p.source === 'existing' ? '確定済み' : p.source === 'manual' ? '・手で入れた' : ''}
                    </span>
                  </p>
                  {(p.start_time || p.end_time) && <p className="text-xs text-blue-700 tabular-nums">この人だけ {p.start_time || slot.start_time.slice(0, 5)}〜{p.end_time || slot.end_time.slice(0, 5)}</p>}
                  {p.warning && <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{p.warning}</p>}
                </div>
                {editable && p.source !== 'existing' && (
                  <div className="ml-auto flex gap-1 flex-shrink-0">
                    <button disabled={busy} onClick={() => setReplacing(replacing?.assignment_id === p.assignment_id ? null : p)}
                      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"><Repeat className="w-3.5 h-3.5" />差し替え</button>
                    <button disabled={busy} onClick={() => remove(p)}
                      className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-gray-200 text-red-600 hover:bg-red-50"><UserMinus className="w-3.5 h-3.5" />外す</button>
                  </div>
                )}
                {p.source === 'existing' && <span className="ml-auto text-[11px] text-gray-400">シフト管理で変更</span>}
              </div>
            ))}
          </section>

          {editable && (
            <section>
              <p className="text-xs font-bold text-gray-500 mb-1.5 flex items-center gap-1">
                {replacing ? <><Repeat className="w-3.5 h-3.5" />{replacing.user_name}さんの代わりに入れる人</> : <><UserPlus className="w-3.5 h-3.5" />足す人を選ぶ（希望が強い順・時間が少ない順）</>}
              </p>
              {candidates === null ? (
                <p className="text-sm text-gray-400">読み込み中...</p>
              ) : usable.length === 0 ? (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">この枠に入れられる人がいません（全員、出勤不可か同じ時間に別の勤務があります）</p>
              ) : (
                <ul className="space-y-1">
                  {usable.map(c => (
                    <li key={c.user_id}>
                      <button disabled={busy} onClick={() => pick(c)}
                        className="w-full flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color || '#868E96' }} />
                        <span className="font-bold text-gray-900">{c.name}</span>
                        <span className={`text-xs font-bold ${c.availability === 'preferred' ? 'text-green-700' : c.availability === 'available' ? 'text-gray-600' : 'text-amber-600'}`}>
                          {c.availability === 'preferred' ? '◎希望' : c.availability === 'available' ? '○可' : '未提出'}
                        </span>
                        {c.partial && <span className="text-[11px] text-amber-700 flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />希望 {c.preferred_time}</span>}
                        {/* 期間の募集で「入りたい会場」に入っていない人（入れることはできる） */}
                        {c.reason === OTHER_VENUE && <span className="text-[11px] text-amber-700 flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />{c.reason}</span>}
                        <span className="ml-auto text-xs text-gray-500 tabular-nums">{c.days}日・{hours(c.minutes)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {blocked.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer">入れられない人（{blocked.length}人）</summary>
                  <ul className="mt-1 space-y-0.5">
                    {blocked.map(c => (
                      <li key={c.user_id} className="flex items-center gap-2 text-xs text-gray-400 px-3">
                        <span>{c.name}</span><span className="ml-auto">{c.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
