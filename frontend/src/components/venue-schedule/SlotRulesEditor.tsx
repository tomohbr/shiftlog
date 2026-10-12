import { useState } from 'react'
import { Plus, Trash2, Pencil, X, CalendarDays } from 'lucide-react'
import toast from 'react-hot-toast'
import { venueScheduleApi, SlotRule, SlotRuleInput } from '../../api/client'
import { StoreColor } from '../../lib/storeColors'

// 会場ごとの必要人数（枠）の登録。
// 「平日 10:00-18:00 2人」のような曜日ルールと、「12/24 は 10:00-21:00 3人」のような日付指定の上書きを持てる。

const DOW = ['日', '月', '火', '水', '木', '金', '土']
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] // 画面では月曜始まりで並べる

export function weekdaysLabel(w: string | null): string {
  if (!w) return ''
  const set = new Set(w.split('').map(Number))
  if (set.size === 7) return '毎日'
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return '平日'
  if (set.size === 2 && set.has(0) && set.has(6)) return '土日'
  return DOW_ORDER.filter(d => set.has(d)).map(d => DOW[d]).join('・')
}

function mdLabel(date: string) {
  const [, m, d] = date.split('-').map(Number)
  const dow = new Date(date + 'T00:00:00').getDay()
  return `${m}/${d}(${DOW[dow]})`
}

interface Venue { id: number | null; name: string; color: StoreColor }

interface FormState {
  id: number | null
  mode: 'weekday' | 'date'
  weekdays: Set<number>
  date: string
  start_time: string
  end_time: string
  needed: number
  break_minutes: number
  valid_from: string
  valid_to: string
}

const emptyForm = (): FormState => ({
  id: null, mode: 'weekday', weekdays: new Set([1, 2, 3, 4, 5]), date: '',
  start_time: '10:00', end_time: '18:00', needed: 2, break_minutes: 0, valid_from: '', valid_to: '',
})

export default function SlotRulesEditor({ venues, rules, onChange }: {
  venues: Venue[]
  rules: SlotRule[]
  onChange: () => void
}) {
  // どの会場のフォームを開いているか（会場指定なしは 0）
  const [openFor, setOpenFor] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)

  const openNew = (venueKey: number) => { setForm(emptyForm()); setOpenFor(venueKey) }
  const openEdit = (venueKey: number, r: SlotRule) => {
    setForm({
      id: r.id, mode: r.date ? 'date' : 'weekday',
      weekdays: new Set((r.weekdays || '').split('').filter(Boolean).map(Number)),
      date: r.date || '', start_time: r.start_time, end_time: r.end_time, needed: r.needed,
      break_minutes: r.break_minutes || 0, valid_from: r.valid_from || '', valid_to: r.valid_to || '',
    })
    setOpenFor(venueKey)
  }

  const save = async (venueId: number | null) => {
    const body: Partial<SlotRuleInput> = {
      store_id: venueId,
      weekdays: form.mode === 'weekday' ? [...form.weekdays].sort().join('') : null,
      date: form.mode === 'date' ? form.date : null,
      start_time: form.start_time, end_time: form.end_time,
      needed: form.needed, break_minutes: form.break_minutes,
      valid_from: form.mode === 'weekday' && form.valid_from ? form.valid_from : null,
      valid_to: form.mode === 'weekday' && form.valid_to ? form.valid_to : null,
    }
    if (form.mode === 'weekday' && form.weekdays.size === 0) { toast.error('曜日を選んでください'); return }
    if (form.mode === 'date' && !form.date) { toast.error('日付を選んでください'); return }
    setSaving(true)
    try {
      if (form.id) await venueScheduleApi.updateRule(form.id, body)
      else await venueScheduleApi.createRule(body)
      toast.success(form.id ? '枠を更新しました' : '枠を追加しました')
      setOpenFor(null)
      onChange()
    } catch (e: any) {
      toast.error(e.response?.data?.error || '保存に失敗しました')
    } finally { setSaving(false) }
  }

  const remove = async (r: SlotRule) => {
    if (!confirm('この枠を削除しますか？（作成済みの下書きには影響しません）')) return
    try {
      await venueScheduleApi.deleteRule(r.id)
      onChange()
    } catch { toast.error('削除に失敗しました') }
  }

  const toggleDow = (d: number) => {
    const next = new Set(form.weekdays)
    if (next.has(d)) next.delete(d); else next.add(d)
    setForm({ ...form, weekdays: next })
  }
  const setDows = (ds: number[]) => setForm({ ...form, weekdays: new Set(ds) })

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {venues.map(v => {
        const key = v.id ?? 0
        const mine = rules.filter(r => (r.store_id ?? 0) === key)
        // 月曜始まりで、先頭の曜日が早いルールから（平日 → 土日）
        const firstDow = (w: string | null) => Math.min(...(w || '').split('').map(d => DOW_ORDER.indexOf(Number(d))))
        const weekly = mine.filter(r => !r.date).sort((a, b) => firstDow(a.weekdays) - firstDow(b.weekdays) || a.start_time.localeCompare(b.start_time))
        const dated = mine.filter(r => r.date).sort((a, b) => (a.date! < b.date! ? -1 : 1))
        const editing = openFor === key
        return (
          <div key={key} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100" style={{ backgroundColor: v.color.soft }}>
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: v.color.solid }} />
              <span className="font-bold text-sm" style={{ color: v.color.text }}>{v.name}</span>
              <span className="ml-auto text-xs text-gray-500">{mine.length === 0 ? '枠なし' : `${mine.length}件`}</span>
            </div>

            <div className="p-3 space-y-1.5 flex-1">
              {mine.length === 0 && !editing && (
                <p className="text-xs text-gray-400 py-2">まだ枠がありません。「枠を追加」から、曜日と時間帯ごとの必要人数を登録します。</p>
              )}
              {weekly.map(r => (
                <RuleRow key={r.id} rule={r} onEdit={() => openEdit(key, r)} onDelete={() => remove(r)}
                  label={weekdaysLabel(r.weekdays)}
                  sub={r.valid_from || r.valid_to ? `${r.valid_from ? mdLabel(r.valid_from) : ''}〜${r.valid_to ? mdLabel(r.valid_to) : ''}` : null} />
              ))}
              {dated.length > 0 && (
                <div className="pt-1.5 mt-1.5 border-t border-dashed border-gray-200 space-y-1.5">
                  <p className="text-[11px] text-gray-400 flex items-center gap-1"><CalendarDays className="w-3 h-3" />日付指定（その日は上の曜日の枠より優先）</p>
                  {dated.map(r => (
                    <RuleRow key={r.id} rule={r} onEdit={() => openEdit(key, r)} onDelete={() => remove(r)} label={mdLabel(r.date!)} sub={null} />
                  ))}
                </div>
              )}
            </div>

            {editing ? (
              <div className="border-t border-gray-100 bg-gray-50 p-3 space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
                    {(['weekday', 'date'] as const).map(m => (
                      <button key={m} type="button" onClick={() => setForm({ ...form, mode: m })}
                        className={`px-2.5 py-1 rounded-md font-medium ${form.mode === m ? 'bg-gray-800 text-white' : 'text-gray-600'}`}>
                        {m === 'weekday' ? '曜日で' : '日付を指定'}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setOpenFor(null)} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-4 h-4" /></button>
                </div>

                {form.mode === 'weekday' ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      {DOW_ORDER.map(d => (
                        <button key={d} type="button" onClick={() => toggleDow(d)}
                          className={`w-8 h-8 rounded-full text-xs font-bold border ${form.weekdays.has(d)
                            ? 'bg-gray-800 border-gray-800 text-white'
                            : `bg-white border-gray-200 ${d === 0 ? 'text-red-500' : d === 6 ? 'text-blue-500' : 'text-gray-600'}`}`}>
                          {DOW[d]}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1 text-[11px]">
                      <button type="button" onClick={() => setDows([1, 2, 3, 4, 5])} className="px-2 py-0.5 rounded border border-gray-200 bg-white text-gray-600">平日</button>
                      <button type="button" onClick={() => setDows([0, 6])} className="px-2 py-0.5 rounded border border-gray-200 bg-white text-gray-600">土日</button>
                      <button type="button" onClick={() => setDows([0, 1, 2, 3, 4, 5, 6])} className="px-2 py-0.5 rounded border border-gray-200 bg-white text-gray-600">毎日</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input-field py-1.5" />
                    <p className="text-[11px] text-gray-500 mt-1">この日はこの会場の曜日の枠を使わず、ここで決めた枠だけにします。人数0で「この日は休み」。</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} className="input-field py-1.5 w-[7.5rem]" />
                  <span className="text-gray-400">〜</span>
                  <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} className="input-field py-1.5 w-[7.5rem]" />
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={50} value={form.needed} onChange={e => setForm({ ...form, needed: Number(e.target.value) })} className="input-field py-1.5 w-16" />
                    <span className="text-gray-600">人</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span>休憩</span>
                  <input type="number" min={0} max={240} step={15} value={form.break_minutes} onChange={e => setForm({ ...form, break_minutes: Number(e.target.value) })} className="input-field py-1 w-16 text-sm" />
                  <span>分</span>
                </div>
                {form.mode === 'weekday' && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                    <span>適用期間</span>
                    <input type="date" value={form.valid_from} onChange={e => setForm({ ...form, valid_from: e.target.value })} className="input-field py-1 w-auto text-sm" />
                    <span>〜</span>
                    <input type="date" value={form.valid_to} onChange={e => setForm({ ...form, valid_to: e.target.value })} className="input-field py-1 w-auto text-sm" />
                    <span className="text-gray-400">（空欄 = いつでも）</span>
                  </div>
                )}
                <button onClick={() => save(v.id)} disabled={saving} className="btn-primary w-full py-1.5 text-sm disabled:opacity-50">
                  {saving ? '保存中...' : form.id ? '枠を更新' : 'この枠を追加'}
                </button>
              </div>
            ) : (
              <button onClick={() => openNew(key)} className="flex items-center justify-center gap-1 text-sm font-medium text-gray-600 hover:bg-gray-50 border-t border-gray-100 py-2">
                <Plus className="w-4 h-4" /> 枠を追加
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RuleRow({ rule, label, sub, onEdit, onDelete }: { rule: SlotRule; label: string; sub: string | null; onEdit: () => void; onDelete: () => void }) {
  const closed = rule.date && rule.needed === 0
  return (
    <div className="group flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-gray-50">
      <div className="min-w-0">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="font-bold text-gray-800 min-w-[3.5rem]">{label}</span>
          {closed ? (
            <span className="text-gray-400">休み</span>
          ) : (
            <>
              <span className="text-gray-600 tabular-nums">{rule.start_time.slice(0, 5)}–{rule.end_time.slice(0, 5)}</span>
              <span className="font-bold text-gray-900">{rule.needed}人</span>
            </>
          )}
        </div>
        {sub && <p className="text-[11px] text-gray-400 truncate">期間 {sub}</p>}
      </div>
      <span className="ml-auto flex gap-0.5 opacity-60 group-hover:opacity-100">
        <button onClick={onEdit} className="p-1 text-gray-400 hover:text-gray-700" aria-label="編集"><Pencil className="w-3.5 h-3.5" /></button>
        <button onClick={onDelete} className="p-1 text-gray-400 hover:text-red-600" aria-label="削除"><Trash2 className="w-3.5 h-3.5" /></button>
      </span>
    </div>
  )
}
