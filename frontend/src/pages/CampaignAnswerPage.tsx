import { useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Send, CheckCircle2, X, MessageCircle, Sun, Moon } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  campaignsApi, CampaignMine, CampaignAnswerInput, CampaignAvailability, CampaignPart, CampaignDay,
} from '../api/client'
import { storeColorMap, storeShortNames } from '../lib/storeColors'

// 期間の募集（マーケットなど）にスタッフが答える画面。LINE の本人専用リンクから開く前提でスマホ向け。
// 上から「何の募集か・いつまでか」→「最初の質問（必須は会場と日数だけ）」→「カレンダーで ◎○×」→ 画面下の提出ボタン。
// カレンダーは希望を出す画面（StaffRequestView）と同じペン方式・月曜はじまり。候補日（どこかの会場が開く日）だけ押せる。
// 昼と夜に分かれる長い日は、◎○ を付けると「昼／夜／通し」を選ぶ欄が出る（何も選ばなければ通し）。

type Pen = CampaignAvailability | 'clear'
type Entry = { availability: CampaignAvailability; part: CampaignPart | null }

const DOW = ['日', '月', '火', '水', '木', '金', '土']
const WEEK = ['月', '火', '水', '木', '金', '土', '日']
const WEEK_DOW = [1, 2, 3, 4, 5, 6, 0]

const PENS: { key: Pen; mark: string; label: string; color: string }[] = [
  { key: 'preferred', mark: '◎', label: '入りたい', color: '#F08C00' },
  { key: 'available', mark: '○', label: '入れる', color: '#2F9E44' },
  { key: 'unavailable', mark: '×', label: '無理', color: '#E03131' },
  { key: 'clear', mark: '－', label: '消す', color: '#868E96' },
]
const penOf = (a: CampaignAvailability) => PENS.find(p => p.key === a)!
const PART_LABEL: Record<CampaignPart, string> = { a: '昼', b: '夜', full: '通し' }
const DPW: { key: '1-2' | '3-4' | '5+'; label: string }[] = [
  { key: '1-2', label: '1〜2日' }, { key: '3-4', label: '3〜4日' }, { key: '5+', label: '5日以上' },
]

const md = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}/${d}（${DOW[new Date(y, m - 1, d).getDay()]}）`
}
const hm = (t: string) => { const [h, m] = t.split(':'); return m === '00' ? `${Number(h)}時` : `${Number(h)}:${m}` }
const pad = (n: number) => String(n).padStart(2, '0')

// 長い日の「昼」「夜」が何時から何時か（その日に開く会場の枠から）
function partRange(day: CampaignDay, part: 'a' | 'b') {
  const slots = day.venues.flatMap(v => v.slots).filter(s => s.part === part)
  if (slots.length === 0) return ''
  const s = slots.map(x => x.start_time).sort()[0]
  const e = slots.map(x => x.end_time).sort().reverse()[0]
  return `${hm(s)}〜${hm(e)}`
}

const emptyAnswer: CampaignAnswerInput = {
  venues: [], days_per_week: null, ng_weekdays: [], transport: [], transport_note: '',
  other_job: null, other_job_note: '', comment: '',
}

export default function CampaignAnswerPage() {
  const { id } = useParams()
  const campaignId = Number(id)
  const [data, setData] = useState<CampaignMine | null>(null)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState<CampaignAnswerInput>(emptyAnswer)
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [savedKey, setSavedKey] = useState('')
  const [pen, setPen] = useState<Pen>('preferred')
  const [focusDay, setFocusDay] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const questionsRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    try {
      const r = await campaignsApi.mine(campaignId)
      setData(r.data)
      const a = r.data.answer
      const ans: CampaignAnswerInput = a ? {
        venues: a.venues_any ? 'any' : a.venue_ids,
        days_per_week: a.days_per_week, ng_weekdays: a.ng_weekdays, transport: a.transport,
        transport_note: a.transport_note, other_job: a.other_job, other_job_note: a.other_job_note, comment: a.comment,
      } : emptyAnswer
      setAnswer(ans)
      setEntries(r.data.entries)
      setSavedKey(a ? JSON.stringify([ans, r.data.entries]) : '')
    } catch (e: any) {
      setError(e.response?.data?.error || '読み込めませんでした。電波の良い所で開き直してください')
    }
  }
  useEffect(() => { load() }, [campaignId])

  const dirty = !!data && JSON.stringify([answer, entries]) !== savedKey
  // 出す前に画面を離れようとしたら止める
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const dayOf = useMemo(() => new Map((data?.days || []).map(d => [d.date, d])), [data])
  const colorOf = useMemo(() => storeColorMap(data?.stores || []), [data])
  const shortOf = useMemo(() => storeShortNames(data?.stores || []), [data])

  if (error) {
    return (
      <div className="max-w-xl mx-auto mt-10 text-center space-y-3">
        <p className="text-gray-800 font-semibold">{error}</p>
        <Link to="/shift-requests" className="text-blue-600 underline text-sm">希望シフトの画面へ</Link>
      </div>
    )
  }
  if (!data) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
  }

  const c = data.campaign
  const open = c.accepting
  const submitted = !!data.answer?.submitted_at
  const days = data.days
  const filled = days.filter(d => entries[d.date]).length
  const count = (a: CampaignAvailability) => days.filter(d => entries[d.date]?.availability === a).length
  const left = days.length - filled
  const hasStores = data.stores.length > 0

  const setA = <K extends keyof CampaignAnswerInput>(k: K, v: CampaignAnswerInput[K]) => setAnswer(prev => ({ ...prev, [k]: v }))

  const tap = (date: string) => {
    if (!open) return
    const day = dayOf.get(date)
    if (!day) return
    if (pen === 'clear') {
      setEntries(prev => { const n = { ...prev }; delete n[date]; return n })
      if (focusDay === date) setFocusDay(null)
      return
    }
    const cur = entries[date]
    const longOk = day.long && pen !== 'unavailable'
    setEntries(prev => ({ ...prev, [date]: { availability: pen, part: longOk ? (cur && cur.availability !== 'unavailable' && cur.part ? cur.part : 'full') : null } }))
    setFocusDay(longOk ? date : null)
  }
  const setPart = (date: string, part: CampaignPart) => {
    setEntries(prev => (prev[date] ? { ...prev, [date]: { ...prev[date], part } } : prev))
  }
  const fillRest = (a: CampaignAvailability) => {
    setEntries(prev => {
      const n = { ...prev }
      for (const d of days) if (!n[d.date]) n[d.date] = { availability: a, part: d.long && a !== 'unavailable' ? 'full' : null }
      return n
    })
    setFocusDay(null)
  }

  // 毎週入れない曜日: 押すとカレンダーのその曜日に × がまとめて入る（もう一度押すと外れる）
  const toggleNg = (dow: number) => {
    if (!open) return
    const on = !answer.ng_weekdays.includes(dow)
    setA('ng_weekdays', on ? [...answer.ng_weekdays, dow].sort() : answer.ng_weekdays.filter(x => x !== dow))
    const targets = days.filter(d => d.weekday === dow)
    setEntries(prev => {
      const n = { ...prev }
      for (const d of targets) {
        if (on) n[d.date] = { availability: 'unavailable', part: null }
        else if (n[d.date]?.availability === 'unavailable') delete n[d.date]
      }
      return n
    })
    if (on && targets.length) toast(`${DOW[dow]}曜日の${targets.length}日に×を入れました`)
  }

  const toggleVenue = (sid: number | 'any') => {
    if (!open) return
    if (sid === 'any') { setA('venues', answer.venues === 'any' ? [] : 'any'); return }
    const cur = answer.venues === 'any' ? [] : answer.venues
    setA('venues', cur.includes(sid) ? cur.filter(x => x !== sid) : [...cur, sid])
  }
  const toggleTransport = (t: string) => {
    if (!open) return
    setA('transport', answer.transport.includes(t) ? answer.transport.filter(x => x !== t) : [...answer.transport, t])
  }

  const submit = async () => {
    const venueMissing = hasStores && answer.venues !== 'any' && answer.venues.length === 0
    if (venueMissing || !answer.days_per_week) {
      toast.error(venueMissing ? '①入りたい会場を選んでください' : '②週に入りたい日数を選んでください')
      questionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setSubmitting(true)
    try {
      const list = Object.entries(entries).map(([date, e]) => ({ date, availability: e.availability, part: e.part }))
      await campaignsApi.submit(c.id, { answer: hasStores ? answer : { ...answer, venues: 'any' }, entries: list })
      toast.success('希望を提出しました。ありがとうございます！')
      setFocusDay(null)
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || '提出できませんでした。電波の良い所でもう一度押してください')
    } finally {
      setSubmitting(false)
    }
  }

  // カレンダー: 期間にかかる月ごとに、期間にかかる週だけ（月曜はじまり）
  const months: { y: number; m: number; cells: (string | null)[] }[] = []
  {
    let y = Number(c.start_date.slice(0, 4)), m = Number(c.start_date.slice(5, 7))
    const ey = Number(c.end_date.slice(0, 4)), em = Number(c.end_date.slice(5, 7))
    while (y < ey || (y === ey && m <= em)) {
      const n = new Date(y, m, 0).getDate()
      const all: (string | null)[] = [...Array((new Date(y, m - 1, 1).getDay() + 6) % 7).fill(null)]
      for (let d = 1; d <= n; d++) all.push(`${y}-${pad(m)}-${pad(d)}`)
      while (all.length % 7) all.push(null)
      const cells: (string | null)[] = []
      for (let w = 0; w < all.length; w += 7) {
        const week = all.slice(w, w + 7)
        if (week.some(d => d && d >= c.start_date && d <= c.end_date)) cells.push(...week)
      }
      months.push({ y, m, cells })
      if (++m > 12) { m = 1; y++ }
    }
  }

  const focus = focusDay ? dayOf.get(focusDay) : undefined
  const focusEntry = focusDay ? entries[focusDay] : undefined
  const longMarked = days.filter(d => d.long && entries[d.date] && entries[d.date].availability !== 'unavailable')

  return (
    <div className="space-y-4 max-w-xl mx-auto pb-2">
      {/* 何の募集か・いつまでか */}
      <div className={`rounded-2xl border-2 p-4 ${open ? 'bg-white border-green-200' : 'bg-gray-50 border-gray-200'}`}>
        <p className="text-xs font-bold text-green-700">シフトの希望を教えてください</p>
        <h1 className="text-2xl font-black text-gray-900 leading-tight">{c.title}</h1>
        <p className="text-base font-bold text-gray-800 mt-1">{md(c.start_date)} 〜 {md(c.end_date)}</p>
        <p className="text-xs text-gray-500">このうち会場が開く {days.length}日 が候補日です</p>
        {open ? (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {c.deadline && (
              <span className={`text-sm font-bold px-2.5 py-1 rounded-full ${c.days_left !== null && c.days_left <= 2 ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                締切 {md(c.deadline)}・{c.days_left === 0 ? '今日まで' : `あと${c.days_left}日`}
              </span>
            )}
            {submitted
              ? <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />提出済み（締切まで直せます）</span>
              : <span className="text-sm font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">まだ提出していません</span>}
          </div>
        ) : (
          <p className="mt-3 text-base font-semibold text-gray-700">
            {c.status === 'draft'
              ? 'まだ募集前です。始まったらLINEでお知らせするので、それまでお待ちください。'
              : `締め切りました。${submitted ? '出した希望は下のとおりです。' : ''}変更したいときは、${data.contact}にLINEで連絡してください。`}
          </p>
        )}
        <p className="mt-3 text-xs text-gray-500 flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />わからないことは、LINEのトークで{data.contact}へ</p>
      </div>

      {/* 1. 最初の質問 */}
      <section ref={questionsRef} className="bg-white rounded-2xl border border-gray-200 p-4 space-y-5 scroll-mt-4">
        <h2 className="text-lg font-black text-gray-900">1. まず教えてください</h2>

        {hasStores && (
          <div>
            <p className="text-sm font-bold text-gray-800 mb-1.5">① 入りたい会場 <span className="text-xs text-red-600">必須</span><span className="text-xs font-normal text-gray-500 ml-1">（いくつでも）</span></p>
            <div className="flex flex-wrap gap-2">
              {data.stores.map(s => {
                const on = answer.venues !== 'any' && answer.venues.includes(s.id)
                const col = colorOf(s.id)
                return (
                  <button key={s.id} onClick={() => toggleVenue(s.id)} disabled={!open}
                    className={`px-3 py-2 rounded-xl border-2 text-sm font-bold flex items-center gap-1.5 ${on ? 'text-white' : 'bg-white text-gray-800'}`}
                    style={on ? { backgroundColor: col.solid, borderColor: col.solid } : { borderColor: col.solid + '55' }}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: on ? '#fff' : col.solid }} />{s.name}
                  </button>
                )
              })}
              <Chip on={answer.venues === 'any'} color="#495057" disabled={!open} onClick={() => toggleVenue('any')}>どこでも</Chip>
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-bold text-gray-800 mb-1.5">{hasStores ? '②' : '①'} 週に入りたい日数 <span className="text-xs text-red-600">必須</span></p>
          <div className="grid grid-cols-3 gap-2">
            {DPW.map(o => <Chip key={o.key} on={answer.days_per_week === o.key} disabled={!open} onClick={() => setA('days_per_week', o.key)}>{o.label}</Chip>)}
          </div>
        </div>

        <div>
          <p className="text-sm font-bold text-gray-800">③ 毎週入れない曜日</p>
          <p className="text-xs text-gray-500 mb-1.5">押すと、下のカレンダーのその曜日に × がまとめて入ります</p>
          <div className="grid grid-cols-7 gap-1">
            {WEEK_DOW.map(dow => {
              const on = answer.ng_weekdays.includes(dow)
              return (
                <button key={dow} onClick={() => toggleNg(dow)} disabled={!open}
                  className={`py-2 rounded-xl border-2 text-sm font-bold ${on ? 'text-white' : 'bg-white'} ${!on && dow === 6 ? 'text-blue-600' : !on && dow === 0 ? 'text-red-600' : !on ? 'text-gray-700' : ''}`}
                  style={on ? { backgroundColor: '#E03131', borderColor: '#E03131' } : { borderColor: '#E9ECEF' }}>
                  {on ? '×' : ''}{DOW[dow]}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <p className="text-sm font-bold text-gray-800 mb-1.5">④ 会場までの交通手段 <span className="text-xs font-normal text-gray-500">（いくつでも）</span></p>
          <div className="flex flex-wrap gap-2">
            {data.transports.map(t => <Chip key={t} on={answer.transport.includes(t)} disabled={!open} onClick={() => toggleTransport(t)}>{t}</Chip>)}
          </div>
          <input value={answer.transport_note} onChange={e => setA('transport_note', e.target.value)} disabled={!open} maxLength={100}
            placeholder="そのほか（例：駅まで家族が送ります）" className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-base disabled:bg-gray-50" />
        </div>

        <div>
          <p className="text-sm font-bold text-gray-800 mb-1.5">⑤ ほかのバイトとの掛け持ち</p>
          <div className="grid grid-cols-2 gap-2">
            {(['none', 'yes'] as const).map(k => <Chip key={k} on={answer.other_job === k} disabled={!open} onClick={() => setA('other_job', answer.other_job === k ? null : k)}>{k === 'none' ? 'なし' : 'あり'}</Chip>)}
          </div>
          {answer.other_job === 'yes' && (
            <input value={answer.other_job_note} onChange={e => setA('other_job_note', e.target.value)} disabled={!open} maxLength={100}
              placeholder="どれくらい？（例：週2日・平日の夜）" className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-base disabled:bg-gray-50" />
          )}
        </div>

        <div>
          <p className="text-sm font-bold text-gray-800 mb-1.5">⑥ ひとこと</p>
          <textarea value={answer.comment} onChange={e => setA('comment', e.target.value)} disabled={!open} maxLength={300} rows={2}
            placeholder="例：12/24は早めに上がりたいです" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base disabled:bg-gray-50" />
        </div>
      </section>

      {/* 2. カレンダー */}
      <section className="space-y-3">
        <div className="px-1">
          <h2 className="text-lg font-black text-gray-900">2. 入れる日に印をつける</h2>
          {hasStores && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {data.stores.map(s => (
                <span key={s.id} className="text-xs font-bold flex items-center gap-1" style={{ color: colorOf(s.id).text }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorOf(s.id).solid }} />{s.name}が開く日
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-500 mt-1"><span className="inline-block px-1 rounded bg-amber-100 text-amber-800 font-bold text-[10px] mr-1">昼夜</span>の日は、昼だけ・夜だけ・通しを選べます</p>
        </div>

        {open && (
          <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur py-1.5 -mx-1 px-1">
            <div className="grid grid-cols-4 gap-1.5">
              {PENS.map(p => {
                const on = pen === p.key
                return (
                  <button key={p.key} onClick={() => setPen(p.key)}
                    className={`rounded-xl py-1.5 border-2 flex flex-col items-center leading-tight ${on ? 'text-white shadow' : 'bg-white'}`}
                    style={on ? { backgroundColor: p.color, borderColor: p.color } : { borderColor: '#E9ECEF', color: p.color }}>
                    <span className="text-xl font-bold">{p.mark}</span>
                    <span className="text-xs font-bold">{p.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {months.map(mo => (
          <div key={`${mo.y}-${mo.m}`} className="-mx-4 sm:mx-0 bg-white sm:rounded-xl sm:border sm:border-gray-200 overflow-hidden">
            <p className="px-3 pt-2 pb-1 text-base font-black text-gray-800">{mo.m}月</p>
            <div className="grid grid-cols-7 border-b border-gray-200">
              {WEEK.map((l, i) => (
                <div key={l} className={`text-center text-xs font-semibold py-1 ${i === 5 ? 'text-blue-500' : i === 6 ? 'text-red-500' : 'text-gray-500'}`}>{l}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {mo.cells.map((d, i) => {
                if (!d) return <div key={`e${i}`} className="min-h-[78px] border-b border-r border-gray-100 bg-gray-50/50" />
                const day = dayOf.get(d)
                const col = i % 7
                const e = entries[d]
                const p = e ? penOf(e.availability) : null
                const focused = focusDay === d
                return (
                  <button key={d} onClick={() => tap(d)} disabled={!open || !day}
                    className={`min-h-[78px] border-b border-r border-gray-100 flex flex-col items-stretch pt-0.5 pb-1 ${day ? 'bg-white active:bg-blue-50' : 'bg-gray-50'} ${focused ? 'ring-2 ring-inset ring-amber-400' : ''}`}>
                    <span className="flex items-center justify-center gap-0.5">
                      <span className={`text-[13px] font-semibold ${!day ? 'text-gray-300' : col === 5 ? 'text-blue-500' : col === 6 ? 'text-red-500' : 'text-gray-800'}`}>{Number(d.slice(8))}</span>
                      {day?.long && <span className="text-[8px] font-bold px-0.5 rounded bg-amber-100 text-amber-800 leading-tight">昼夜</span>}
                    </span>
                    {p && (
                      <span className="mx-[2px] mt-0.5 rounded-[5px] text-white font-bold text-center leading-tight py-0.5" style={{ backgroundColor: p.color }}>
                        <span className="block text-[15px]">{p.mark}</span>
                        <span className="block text-[10px]">{e.part ? PART_LABEL[e.part] : p.label}</span>
                      </span>
                    )}
                    {day && (
                      <span className="mt-auto flex flex-col items-start px-[3px] pt-0.5">
                        {day.venues.map(v => (
                          <span key={v.store_id ?? 0} className="flex items-center gap-[2px] text-[9px] font-bold leading-[11px] truncate max-w-full" style={{ color: colorOf(v.store_id).text }}>
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(v.store_id).solid }} />
                            {hasStores ? shortOf(v.store_id) : ''}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {open && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
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
        )}

        {/* 昼夜の日の一覧（あとから見直す用） */}
        {longMarked.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200">
            <p className="px-4 pt-3 pb-1 text-sm font-bold text-gray-800">昼夜の日の時間（{longMarked.length}日）</p>
            <div className="divide-y divide-gray-100">
              {longMarked.map(d => (
                <PartRow key={d.date} day={d} entry={entries[d.date]} disabled={!open} onPick={part => setPart(d.date, part)} />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* いま印をつけた昼夜の日の時間 ＋ 提出（いつでも押せる位置に） */}
      {open && (
        <div className="sticky bottom-0 -mx-4 sm:mx-0 bg-white/95 backdrop-blur border-t border-gray-200 sm:rounded-xl sm:border">
          {focus && focusEntry && focusEntry.availability !== 'unavailable' && (
            <div className="px-4 pt-3 pb-1 border-b border-gray-100">
              <div className="flex items-center">
                <p className="text-sm font-bold text-gray-800">{md(focus.date)} はどの時間？</p>
                <button onClick={() => setFocusDay(null)} className="ml-auto p-1 text-gray-400" aria-label="閉じる"><X className="w-4 h-4" /></button>
              </div>
              <PartButtons day={focus} value={focusEntry.part || 'full'} onPick={part => setPart(focus.date, part)} />
            </div>
          )}
          <div className="px-4 py-3">
            <button onClick={submit} disabled={submitting || (!dirty && submitted)}
              className="w-full py-3.5 rounded-xl bg-green-600 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:bg-gray-300">
              <Send className="w-5 h-5" />
              {submitting ? '送信中…' : !dirty && submitted ? '提出済みです' : `${submitted ? '直した内容で出し直す' : '提出する'}（${filled}/${days.length}日）`}
            </button>
            {dirty && left > 0 && <p className="text-xs text-center text-gray-500 mt-1.5">印のない日は「希望なし」として届きます</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({ on, onClick, disabled, color = '#1C7ED6', children }: { on: boolean; onClick: () => void; disabled?: boolean; color?: string; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-3 py-2 rounded-xl border-2 text-sm font-bold ${on ? 'text-white' : 'bg-white text-gray-700 border-gray-200'} ${disabled ? 'opacity-70' : ''}`}
      style={on ? { backgroundColor: color, borderColor: color } : undefined}>
      {children}
    </button>
  )
}

function PartButtons({ day, value, onPick, disabled }: { day: CampaignDay; value: CampaignPart; onPick: (p: CampaignPart) => void; disabled?: boolean }) {
  const opts: { key: CampaignPart; label: string; sub: string; icon?: typeof Sun }[] = [
    { key: 'a', label: '昼だけ', sub: partRange(day, 'a'), icon: Sun },
    { key: 'b', label: '夜だけ', sub: partRange(day, 'b'), icon: Moon },
    { key: 'full', label: '通し', sub: 'どちらでも' },
  ]
  return (
    <div className="grid grid-cols-3 gap-1.5 py-2">
      {opts.map(o => {
        const on = value === o.key
        const Icon = o.icon
        return (
          <button key={o.key} onClick={() => onPick(o.key)} disabled={disabled}
            className={`rounded-xl border-2 py-1.5 leading-tight ${on ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-gray-200 text-gray-800'}`}>
            <span className="text-sm font-bold flex items-center justify-center gap-1">{Icon && <Icon className="w-3.5 h-3.5" />}{o.label}</span>
            <span className={`block text-[11px] ${on ? 'text-white' : 'text-gray-500'}`}>{o.sub || '—'}</span>
          </button>
        )
      })}
    </div>
  )
}

// 見直し用の1行（日付と 昼／夜／通し）
function PartRow({ day, entry, onPick, disabled }: { day: CampaignDay; entry: Entry; onPick: (p: CampaignPart) => void; disabled: boolean }) {
  const p = penOf(entry.availability)
  const value = entry.part || 'full'
  return (
    <div className="px-4 py-1.5 flex items-center gap-2">
      <p className="text-sm font-semibold w-[6.5rem] flex-shrink-0 whitespace-nowrap" style={{ color: p.color }}>{p.mark} {md(day.date)}</p>
      <div className="flex-1 grid grid-cols-3 gap-1">
        {(['a', 'b', 'full'] as CampaignPart[]).map(k => (
          <button key={k} onClick={() => onPick(k)} disabled={disabled} title={k === 'full' ? '' : partRange(day, k)}
            className={`rounded-lg border-2 py-1 text-sm font-bold ${value === k ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-gray-200 text-gray-700'}`}>
            {PART_LABEL[k]}
          </button>
        ))}
      </div>
    </div>
  )
}
