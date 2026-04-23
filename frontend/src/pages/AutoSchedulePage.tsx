import { useState } from 'react'
import { Sparkles, Plus, Trash2, Send, CheckCircle2, AlertTriangle } from 'lucide-react'
import { autoScheduleApi, AutoAssignment, AutoUnfilled, AutoSlot } from '../api/client'
import toast from 'react-hot-toast'

function defaultSlot(): AutoSlot {
  return { date: '', start_time: '09:00', end_time: '17:00', needed: 1 }
}

export default function AutoSchedulePage() {
  const now = new Date()
  const [year] = useState(now.getFullYear())
  const [month] = useState(now.getMonth() + 1)
  const [slots, setSlots] = useState<AutoSlot[]>([defaultSlot()])
  const [assignments, setAssignments] = useState<AutoAssignment[]>([])
  const [unfilled, setUnfilled] = useState<AutoUnfilled[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)

  const addSlot = () => setSlots([...slots, defaultSlot()])
  const removeSlot = (i: number) => setSlots(slots.filter((_, idx) => idx !== i))
  const updateSlot = (i: number, patch: Partial<AutoSlot>) => {
    setSlots(slots.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  const propose = async () => {
    const valid = slots.filter(s => s.date && s.start_time && s.end_time && s.needed > 0)
    if (valid.length === 0) { toast.error('スロットを1つ以上設定してください'); return }
    setLoading(true)
    try {
      const res = await autoScheduleApi.propose(year, month, valid)
      setAssignments(res.data.assignments)
      setUnfilled(res.data.unfilled)
      toast.success(`${res.data.assignments.length} 件の割当案を生成しました`)
    } catch (e: any) {
      toast.error(e.response?.data?.error || '生成に失敗しました')
    } finally { setLoading(false) }
  }

  const apply = async () => {
    if (assignments.length === 0) return
    if (!confirm(`${assignments.length} 件のシフトを実際に登録します。よろしいですか？`)) return
    setApplying(true)
    try {
      const res = await autoScheduleApi.apply(assignments)
      toast.success(`${res.data.created} 件を登録（重複 ${res.data.skipped} 件スキップ）`)
      setAssignments([])
      setUnfilled([])
      setSlots([defaultSlot()])
    } catch (e: any) {
      toast.error(e.response?.data?.error || '適用に失敗しました')
    } finally { setApplying(false) }
  }

  // 簡単な「今月の平日9-17」テンプレート
  const fillWeekdays = () => {
    const daysInMonth = new Date(year, month, 0).getDate()
    const next: AutoSlot[] = []
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d)
      const dow = date.getDay()
      if (dow === 0 || dow === 6) continue
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      next.push({ date: dateStr, start_time: '09:00', end_time: '17:00', needed: 2 })
    }
    setSlots(next)
    toast.success(`平日 ${next.length} 日分を一括セットしました`)
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-purple-600" />
          自動シフト生成
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          必要な日時と人数を入力すると、希望シフト・スキル・過労ペナルティを考慮して自動で割り当て案を生成します。適用するまでDBには反映されません。
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">必要スロット（{year}年{month}月）</h3>
          <div className="flex gap-2">
            <button onClick={fillWeekdays} className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">
              平日9-17を一括セット
            </button>
            <button onClick={addSlot} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded">
              <Plus className="w-3 h-3" /> スロット追加
            </button>
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="flex gap-2 items-center text-sm">
              <input type="date" value={s.date} onChange={e => updateSlot(i, { date: e.target.value })} className="border border-gray-200 rounded px-2 py-1" />
              <input type="time" value={s.start_time} onChange={e => updateSlot(i, { start_time: e.target.value })} className="border border-gray-200 rounded px-2 py-1" />
              <span>〜</span>
              <input type="time" value={s.end_time} onChange={e => updateSlot(i, { end_time: e.target.value })} className="border border-gray-200 rounded px-2 py-1" />
              <input type="number" min={1} max={20} value={s.needed} onChange={e => updateSlot(i, { needed: Number(e.target.value) })} className="border border-gray-200 rounded px-2 py-1 w-16" />
              <span className="text-xs text-gray-500">人</span>
              <button onClick={() => removeSlot(i)} className="text-red-500 hover:bg-red-50 p-1 rounded ml-auto">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="pt-2">
          <button
            onClick={propose}
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-semibold px-5 py-2.5 rounded-lg text-sm flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> {loading ? '生成中...' : '割当案を生成'}
          </button>
        </div>
      </div>

      {(assignments.length > 0 || unfilled.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" /> 割当案 ({assignments.length})
            </h3>
            <button
              onClick={apply}
              disabled={applying || assignments.length === 0}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold px-5 py-2 rounded-lg text-sm flex items-center gap-2"
            >
              <Send className="w-3.5 h-3.5" /> {applying ? '登録中...' : 'この内容でシフトに反映'}
            </button>
          </div>
          {unfilled.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-yellow-800 flex items-center gap-1 mb-2">
                <AlertTriangle className="w-3.5 h-3.5" /> 人員不足 ({unfilled.length} スロット)
              </p>
              <ul className="text-xs text-yellow-900 space-y-0.5">
                {unfilled.map((u, i) => (
                  <li key={i}>・{u.date} {u.start_time}-{u.end_time}: {u.needed}名必要 / {u.assigned}名のみ割当可能</li>
                ))}
              </ul>
            </div>
          )}
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-1.5">日付</th>
                  <th className="text-left px-3 py-1.5">時間</th>
                  <th className="text-left px-3 py-1.5">担当</th>
                  <th className="text-left px-3 py-1.5">希望</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">{a.date}</td>
                    <td className="px-3 py-1.5">{a.start_time}〜{a.end_time}</td>
                    <td className="px-3 py-1.5 font-medium">{a.user_name}</td>
                    <td className="px-3 py-1.5">
                      {a.availability === 'preferred' && <span className="text-green-600">希望</span>}
                      {a.availability === 'available' && <span className="text-gray-500">出勤可</span>}
                      {!a.availability && <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
