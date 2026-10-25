import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { venueWord } from '../lib/terms'
import { MapPin, RefreshCw } from 'lucide-react'
import { shiftsApi, timecardsApi, Shift, Store, TimeRecord } from '../api/client'
import { storeColorMap } from '../lib/storeColors'

// ダッシュボードの「今日」。会場ごとに、今日入る人と今の状態（出勤前／勤務中／休憩中／退勤済み／まだ来ていない）。
// 店長がいちばん知りたい「今どの会場に誰がいて、ちゃんと来ているか」を一目で出す。1分ごとに更新。

const LATE_GRACE_MIN = 5
const toMin = (t?: string | null) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m }

type State = { key: 'before' | 'late' | 'working' | 'break' | 'done'; label: string; cls: string; order: number }

export default function TodayByVenue({ stores, onlyStoreId = null }: { stores: Store[]; onlyStoreId?: number | null }) {
  const { selectedCompany } = useAuth()
  const vw = venueWord(selectedCompany)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [records, setRecords] = useState<TimeRecord[]>([])
  const [now, setNow] = useState(new Date())
  const [loading, setLoading] = useState(true)

  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))

  const load = async () => {
    try {
      const [s, t] = await Promise.all([shiftsApi.getAll({ year: y, month: m }), timecardsApi.getAll({ year: y, month: m })])
      setShifts((s.data.shifts || []).filter(x => x.date === today))
      setRecords((t.data.records || []).filter(r => r.date === today))
      setNow(new Date())
    } catch { /* 表示は前のまま */ } finally { setLoading(false) }
  }
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [])

  const colorOf = storeColorMap(stores)
  const sorted = [...stores].sort((a, b) => a.id - b.id)
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const stateOf = (s: Shift): State => {
    const rec = records.find(r => r.user_id === s.user_id)
    if (rec) {
      if (rec.status === 'closed') return { key: 'done', label: `退勤 ${rec.clock_out?.slice(0, 5) || ''}`, cls: 'bg-gray-100 text-gray-600', order: 4 }
      if ((rec.breaks || []).some(b => !b.end_time)) return { key: 'break', label: '休憩中', cls: 'bg-amber-100 text-amber-800', order: 1 }
      return { key: 'working', label: `勤務中 ${rec.clock_in?.slice(0, 5) || ''}〜`, cls: 'bg-green-100 text-green-800', order: 2 }
    }
    const late = nowMin - toMin(s.start_time)
    if (late >= LATE_GRACE_MIN) return { key: 'late', label: `まだ来ていない（${late}分）`, cls: 'bg-red-100 text-red-700', order: 0 }
    return { key: 'before', label: '出勤前', cls: 'bg-blue-50 text-blue-700', order: 3 }
  }

  const groups = [...sorted.map(st => ({ id: st.id as number | null, name: st.name })), { id: null, name: `${vw}なし` }]
    .map(g => ({ ...g, rows: shifts.filter(s => (s.store_id ?? null) === g.id).sort((a, b) => a.start_time.localeCompare(b.start_time)) }))
    .filter(g => g.rows.length > 0 && (onlyStoreId === null || g.id === onlyStoreId))
  const lateCount = groups.flatMap(g => g.rows).filter(s => stateOf(s).key === 'late').length

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 sm:px-5 py-3 border-b border-gray-200">
        <h3 className="text-base font-bold text-gray-900 whitespace-nowrap">今日の{vw}</h3>
        <span className="text-sm text-gray-500 whitespace-nowrap">{m}/{Number(today.slice(8))}（{'日月火水木金土'[now.getDay()]}）</span>
        <button onClick={load} className="ml-auto text-xs text-gray-500 flex items-center gap-1 hover:text-gray-700 whitespace-nowrap"><RefreshCw className="w-3.5 h-3.5" />{now.toTimeString().slice(0, 5)} 更新</button>
        {lateCount > 0 && <span className="w-full sm:w-auto sm:order-none text-sm font-bold px-2.5 py-1 rounded-full bg-red-500 text-white text-center whitespace-nowrap">まだ来ていない {lateCount}人</span>}
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">読み込み中…</div>
      ) : groups.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">今日の{onlyStoreId ? `${stores.find(s => s.id === onlyStoreId)?.name || ''}の` : ''}シフトはありません</div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
          {groups.map(g => {
            const c = g.id ? colorOf(g.id) : { solid: '#868E96', soft: '#F1F3F5', text: '#495057' }
            const working = g.rows.filter(s => ['working', 'break'].includes(stateOf(s).key)).length
            return (
              <div key={g.id ?? 'none'} className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 flex items-center gap-2 text-white" style={{ backgroundColor: c.solid }}>
                  <MapPin className="w-4 h-4" />
                  <span className="font-bold">{g.name}</span>
                  <span className="ml-auto text-sm font-semibold">いま {working}人 / 予定 {g.rows.length}人</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {[...g.rows].sort((a, b) => stateOf(a).order - stateOf(b).order || a.start_time.localeCompare(b.start_time)).map(s => {
                    const st = stateOf(s)
                    return (
                      <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 whitespace-nowrap">{s.user_name}</p>
                          <p className="text-xs text-gray-500 tabular-nums">{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</p>
                        </div>
                        <span className={`ml-auto text-xs font-bold px-2 py-1 rounded-full text-center ${st.cls}`}>{st.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
