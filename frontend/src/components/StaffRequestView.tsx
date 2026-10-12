import { useEffect, useState } from 'react'
import { Send, CheckCircle2, Clock, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { shiftRequestsApi } from '../api/client'

// スタッフの「希望を出す」画面。LINE から開かれる前提でスマホ向け。
// ペン（◎入りたい／○入れる／×入れない／消す）を選んでから日付を押す。押すたびに色が回る方式は
// 「今なにを選んでいるか」が分かりにくかったのでやめた。
// カレンダーはシフト画面（MyShiftsPage）と同じ月曜はじまり・マスの中にラベルの形。

type Availability = 'available' | 'unavailable' | 'preferred'
type Pen = Availability | 'clear'

const DOW = ['日', '月', '火', '水', '木', '金', '土']
const WEEK = ['月', '火', '水', '木', '金', '土', '日']

const PENS: { key: Pen; mark: string; label: string; color: string }[] = [
  { key: 'preferred', mark: '◎', label: '入りたい', color: '#F08C00' },
  { key: 'available', mark: '○', label: '入れる', color: '#2F9E44' },
  { key: 'unavailable', mark: '×', label: '入れない', color: '#E03131' },
  { key: 'clear', mark: '－', label: '消す', color: '#868E96' },
]
const penOf = (a: Availability) => PENS.find(p => p.key === a)!

// 時刻は select（Android の一部端末で時刻ダイアログがはみ出すため。ShiftRequestPage と同じ判断）
const TIMES: string[] = []
for (let h = 5; h < 24; h++) for (const m of [0, 30]) TIMES.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)

// 既存の値が選択肢にない時刻（19:15 など）でも表示が消えないように含める
const withValue = (v?: string) => (v && !TIMES.includes(v) ? [...TIMES, v].sort() : TIMES)
const fmt = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const md = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}/${d}（${DOW[new Date(y, m - 1, d).getDay()]}）`
}
const short = (t?: string) => {
  if (!t) return ''
  const [h, m] = t.split(':')
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`
}

export default function StaffRequestView({ year, month, userId }: { year: number; month: number; userId: number }) {
  const [entries, setEntries] = useState<Record<string, Availability>>({})
  const [saved, setSaved] = useState<Record<string, Availability>>({})
  const [times, setTimes] = useState<Record<string, { start: string; end: string }>>({})
  const [period, setPeriod] = useState<{ status: string; deadline: string | null; start_date: string | null; end_date: string | null }>({ status: 'closed', deadline: null, start_date: null, end_date: null })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [pen, setPen] = useState<Pen>('available')
  const [showTimes, setShowTimes] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [reqRes, periodRes] = await Promise.all([
        shiftRequestsApi.getAll({ year, month, user_id: userId }),
        shiftRequestsApi.getPeriod(year, month),
      ])
      const map: Record<string, Availability> = {}
      const tm: Record<string, { start: string; end: string }> = {}
      for (const r of reqRes.data.requests || []) {
        map[r.date] = r.availability as Availability
        if (r.preferred_start || r.preferred_end) tm[r.date] = { start: (r.preferred_start || '').slice(0, 5), end: (r.preferred_end || '').slice(0, 5) }
      }
      setEntries(map); setSaved(map); setTimes(tm); setDirty(false)
      const p = periodRes.data.period
      setPeriod({ status: p?.status || 'closed', deadline: p?.deadline || null, start_date: p?.start_date || null, end_date: p?.end_date || null })
    } catch {
      toast.error('読み込めませんでした')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [year, month, userId])

  // 提出前に画面を離れようとしたら止める
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
  }

  const open = period.status === 'open'
  const daysInMonth = new Date(year, month, 0).getDate()
  const allDates = Array.from({ length: daysInMonth }, (_, i) => fmt(year, month, i + 1))
  const inRange = (d: string) => (!period.start_date || d >= period.start_date) && (!period.end_date || d <= period.end_date)
  const target = allDates.filter(inRange)
  const filled = target.filter(d => entries[d])
  const left = target.length - filled.length
  const count = (a: Availability) => target.filter(d => entries[d] === a).length
  const submittedBefore = Object.keys(saved).length > 0

  const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const daysLeft = period.deadline ? Math.ceil((new Date(period.deadline).getTime() - new Date(todayStr).getTime()) / 86400000) : null

  const tap = (d: string) => {
    if (!open || !inRange(d)) return
    setEntries(prev => {
      const next = { ...prev }
      if (pen === 'clear') delete next[d]
      else next[d] = pen
      return next
    })
    setDirty(true)
  }
  const fillRest = (a: Availability) => {
    setEntries(prev => {
      const next = { ...prev }
      for (const d of target) if (!next[d]) next[d] = a
      return next
    })
    setDirty(true)
  }
  const setTime = (d: string, field: 'start' | 'end', v: string) => {
    setTimes(prev => ({ ...prev, [d]: { ...(prev[d] || { start: '', end: '' }), [field]: v } }))
    setDirty(true)
  }

  const submit = async () => {
    for (const [d, t] of Object.entries(times)) {
      if (entries[d] && entries[d] !== 'unavailable' && ((t.start && !t.end) || (!t.start && t.end))) {
        toast.error(`${md(d)} の時間は「から」と「まで」の両方を選んでください`); setShowTimes(true); return
      }
    }
    setSubmitting(true)
    try {
      const requests = Object.entries(entries).map(([date, availability]) => {
        const t = availability !== 'unavailable' ? times[date] : undefined
        return { date, availability, preferred_start: t?.start || undefined, preferred_end: t?.end || undefined }
      })
      const clear = Object.keys(saved).filter(d => !entries[d])
      await shiftRequestsApi.submitBulk(requests, clear)
      setSaved(entries); setDirty(false)
      toast.success('希望を提出しました')
    } catch {
      toast.error('提出できませんでした。電波の良い所でもう一度押してください')
    } finally {
      setSubmitting(false)
    }
  }

  // 月曜はじまりのマス
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const allCells: (string | null)[] = [...Array(lead).fill(null), ...allDates]
  while (allCells.length % 7) allCells.push(null)
  // 対象期間にかからない週は出さない（月の一部だけ集めるときに、押せない行で画面が埋まらないように）
  const cells: (string | null)[] = []
  for (let w = 0; w < allCells.length; w += 7) {
    const week = allCells.slice(w, w + 7)
    if (week.some(d => d && inRange(d))) cells.push(...week)
  }
  const timeDays = target.filter(d => entries[d] && entries[d] !== 'unavailable')

  return (
    <div className="space-y-3 max-w-xl mx-auto">
      {/* 何の・いつまでの希望か */}
      <div className={`rounded-2xl border-2 p-4 ${open ? 'bg-white border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
        {open ? (
          <>
            <p className="text-xs font-bold text-gray-500">希望を出す期間</p>
            <p className="text-xl font-bold text-gray-900">
              {period.start_date && period.end_date ? `${md(period.start_date)} 〜 ${md(period.end_date)}` : `${month}月の全日`}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {period.deadline && (
                <span className={`text-sm font-bold px-2.5 py-1 rounded-full ${daysLeft !== null && daysLeft <= 2 ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                  締切 {md(period.deadline)}{daysLeft !== null && daysLeft >= 0 ? `・あと${daysLeft}日` : ''}
                </span>
              )}
              {submittedBefore && !dirty
                ? <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />提出済み（締切まで直せます）</span>
                : !submittedBefore && <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">まだ提出していません</span>}
            </div>
          </>
        ) : (
          <p className="text-base font-semibold text-gray-600">{month}月は今、希望の受付をしていません。{submittedBefore && '（出した希望は下のとおりです）'}</p>
        )}
      </div>

      {/* ペン */}
      {open && (
        <div>
          <p className="text-sm text-gray-600 mb-1.5">ペンを選んで、日付を押してください</p>
          <div className="grid grid-cols-4 gap-1.5">
            {PENS.map(p => {
              const on = pen === p.key
              return (
                <button
                  key={p.key}
                  onClick={() => setPen(p.key)}
                  className={`rounded-xl py-2 border-2 flex flex-col items-center leading-tight ${on ? 'text-white shadow' : 'bg-white'}`}
                  style={on ? { backgroundColor: p.color, borderColor: p.color } : { borderColor: '#E9ECEF', color: p.color }}
                >
                  <span className="text-xl font-bold">{p.mark}</span>
                  <span className="text-xs font-bold">{p.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* カレンダー */}
      <div className="-mx-4 sm:mx-0 bg-white sm:rounded-xl sm:border sm:border-gray-200 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-200">
          {WEEK.map((l, i) => (
            <div key={l} className={`text-center text-xs font-semibold py-1.5 ${i === 5 ? 'text-blue-500' : i === 6 ? 'text-red-500' : 'text-gray-500'}`}>{l}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} className="min-h-[64px] border-b border-r border-gray-100 bg-gray-50/50" />
            const dn = Number(d.slice(8))
            const col = i % 7
            const ok = inRange(d)
            const a = entries[d]
            const p = a ? penOf(a) : null
            const t = times[d]
            return (
              <button
                key={d}
                onClick={() => tap(d)}
                disabled={!open || !ok}
                className={`min-h-[64px] border-b border-r border-gray-100 flex flex-col items-stretch pt-1 pb-1 ${ok ? 'bg-white active:bg-blue-50' : 'bg-gray-50'}`}
              >
                <span className={`text-center text-[13px] font-semibold ${!ok ? 'text-gray-300' : col === 5 ? 'text-blue-500' : col === 6 ? 'text-red-500' : 'text-gray-800'}`}>{dn}</span>
                {p && (
                  <span className="mx-[2px] mt-0.5 rounded-[5px] text-white font-bold text-center leading-tight py-0.5" style={{ backgroundColor: p.color }}>
                    <span className="block text-[15px]">{p.mark}</span>
                    <span className="block text-[10px]">{t?.start && t?.end && a !== 'unavailable' ? `${short(t.start)}-${short(t.end)}` : p.label}</span>
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {open && (
        <>
          {/* 数と、残りの一括 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-sm text-gray-700">
              <span className="font-bold" style={{ color: '#F08C00' }}>◎{count('preferred')}</span>
              <span className="font-bold ml-2" style={{ color: '#2F9E44' }}>○{count('available')}</span>
              <span className="font-bold ml-2" style={{ color: '#E03131' }}>×{count('unavailable')}</span>
              {left > 0 && <span className="ml-2 text-gray-500">未入力 {left}日</span>}
            </p>
            {left > 0 && (
              <div className="flex gap-1.5 ml-auto">
                <button onClick={() => fillRest('available')} className="px-3 py-1.5 text-sm font-bold rounded-lg border-2" style={{ borderColor: '#2F9E44', color: '#2F9E44' }}>残りを全部○</button>
                <button onClick={() => fillRest('unavailable')} className="px-3 py-1.5 text-sm font-bold rounded-lg border-2" style={{ borderColor: '#E03131', color: '#E03131' }}>残りを全部×</button>
              </div>
            )}
          </div>

          {/* 時間の希望（任意） */}
          {timeDays.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200">
              <button onClick={() => setShowTimes(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
                <Clock className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-bold text-gray-800 whitespace-nowrap">時間の希望を書く（任意）</span>
                <ChevronDown className={`w-4 h-4 text-gray-400 ml-auto transition-transform ${showTimes ? 'rotate-180' : ''}`} />
              </button>
              {showTimes && (
                <div className="divide-y divide-gray-100 border-t border-gray-100">
                  {timeDays.map(d => (
                    <div key={d} className="flex items-center gap-2 px-4 py-2">
                      <span className="text-sm font-semibold w-20 shrink-0" style={{ color: penOf(entries[d]).color }}>{penOf(entries[d]).mark} {md(d)}</span>
                      <select value={times[d]?.start || ''} onChange={e => setTime(d, 'start', e.target.value)} className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                        <option value="">何時から</option>
                        {withValue(times[d]?.start).map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <span className="text-gray-400">〜</span>
                      <select value={times[d]?.end || ''} onChange={e => setTime(d, 'end', e.target.value)} className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                        <option value="">何時まで</option>
                        {withValue(times[d]?.end).map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 提出（いつでも押せる位置に） */}
          <div className="sticky bottom-0 -mx-4 sm:mx-0 px-4 py-3 bg-white/95 backdrop-blur border-t border-gray-200 sm:rounded-xl sm:border">
            <button
              onClick={submit}
              disabled={submitting || (!dirty && submittedBefore)}
              className="w-full py-3.5 rounded-xl bg-blue-600 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:bg-gray-300"
            >
              <Send className="w-5 h-5" />
              {submitting ? '送信中…' : !dirty && submittedBefore ? '提出済みです' : submittedBefore ? '直した内容で提出し直す' : `提出する（${filled.length}/${target.length}日）`}
            </button>
            {dirty && left > 0 && <p className="text-xs text-center text-gray-500 mt-1.5">未入力の日は「希望なし」として店長に届きます</p>}
          </div>
        </>
      )}
    </div>
  )
}
