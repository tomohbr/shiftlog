import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Sparkles, Send, Trash2, RefreshCw, CheckCircle2, ClipboardList, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { venueScheduleApi, storesApi, SlotRule, DraftView, DraftSummary, Store } from '../api/client'
import { storeColorMap } from '../lib/storeColors'
import SlotRulesEditor from '../components/venue-schedule/SlotRulesEditor'
import DraftBoard from '../components/venue-schedule/DraftBoard'

// 希望から自動でシフトを作る。
//  ① 会場ごとの必要人数（枠）を登録 → ② 期間を決めて下書きを作る → ③ 表で手直しして確定
// 下書きは確定するまで shifts に入らない（スタッフには見えない）。

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthRange = (y: number, m: number) => [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))] as const
const md = (date: string) => { const [, m, d] = date.split('-').map(Number); return `${m}/${d}` }

export default function VenueSchedulePage() {
  const [params] = useSearchParams()
  const [stores, setStores] = useState<Store[]>([])
  const [rules, setRules] = useState<SlotRule[]>([])
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [view, setView] = useState<DraftView | null>(null)
  const [tab, setTab] = useState<'rules' | 'draft'>('rules')
  const [loading, setLoading] = useState(true)

  // 期間の初期値: ?month=2026-11 があればその月、なければ来月
  const initial = useMemo(() => {
    const q = params.get('month')
    const now = new Date()
    const [y, m] = q && /^\d{4}-\d{2}$/.test(q) ? q.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 2]
    const d = new Date(y, m - 1, 1)
    return monthRange(d.getFullYear(), d.getMonth() + 1)
  }, [params])
  const [startDate, setStartDate] = useState(initial[0])
  const [endDate, setEndDate] = useState(initial[1])
  const [includeUnsubmitted, setIncludeUnsubmitted] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [committing, setCommitting] = useState(false)

  const colorOf = storeColorMap(stores)
  const venues = useMemo(() => {
    const sorted = [...stores].sort((a, b) => a.id - b.id)
    // 会場を登録していないお店は「会場指定なし」1つで使える
    return sorted.length > 0
      ? sorted.map(s => ({ id: s.id as number | null, name: s.name, color: colorOf(s.id) }))
      : [{ id: null as number | null, name: '会場指定なし', color: colorOf(null) }]
  }, [stores])

  const loadRules = useCallback(async () => {
    const r = await venueScheduleApi.getRules()
    setRules(r.data.rules)
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const [st, , dr] = await Promise.all([storesApi.getAll(), loadRules(), venueScheduleApi.listDrafts()])
        setStores(st.data.stores)
        setDrafts(dr.data.drafts)
        // 作りかけの下書きがあれば、そこから再開する
        const open = dr.data.drafts.find(d => d.status === 'draft')
        if (open) {
          const v = await venueScheduleApi.getDraft(open.id)
          setView(v.data)
          setStartDate(open.start_date)
          setEndDate(open.end_date)
          setTab('draft')
        }
      } catch {
        toast.error('読み込みに失敗しました')
      } finally { setLoading(false) }
    })()
  }, [loadRules])

  const refreshDrafts = async () => {
    try { setDrafts((await venueScheduleApi.listDrafts()).data.drafts) } catch { /* 一覧は補助なので無視 */ }
  }

  const generate = async () => {
    const open = drafts.find(d => d.status === 'draft' && !(d.end_date < startDate || d.start_date > endDate))
    if (open && !confirm(`${md(open.start_date)}〜${md(open.end_date)} の作りかけの下書き（手直しした分も含む）は破棄して、作り直します。よろしいですか？`)) return
    setGenerating(true)
    try {
      const r = await venueScheduleApi.createDraft({ start_date: startDate, end_date: endDate, include_unsubmitted: includeUnsubmitted })
      setView(r.data)
      setTab('draft')
      refreshDrafts()
      toast.success(r.data.totals.short_people > 0
        ? `下書きを作りました。あと${r.data.totals.short_people}人足りません`
        : '下書きを作りました。全部の枠が埋まっています')
    } catch (e: any) {
      toast.error(e.response?.data?.error || '作成に失敗しました')
    } finally { setGenerating(false) }
  }

  const openDraft = async (id: number) => {
    try {
      const r = await venueScheduleApi.getDraft(id)
      setView(r.data)
      setTab('draft')
    } catch { toast.error('下書きを開けませんでした') }
  }

  const commit = async () => {
    if (!view) return
    const t = view.totals
    const msg = `下書きの ${t.draft_count} 件をシフトに入れます。` +
      (t.short_people > 0 ? `\n足りない ${t.short_slots} 枠（あと${t.short_people}人）は空いたままになります。` : '') +
      '\n入れたあとは「シフト管理」で1件ずつ直せます。よろしいですか？'
    if (!confirm(msg)) return
    setCommitting(true)
    try {
      const r = await venueScheduleApi.commit(view.draft.id)
      const sk = r.data.skipped
      toast.success(`${r.data.created} 件をシフトに入れました${sk.length ? `（重なる ${sk.length} 件は入れていません）` : ''}`, { duration: 6000 })
      if (sk.length) console.warn('入れなかった割当', sk)
      setView((await venueScheduleApi.getDraft(view.draft.id)).data)
      refreshDrafts()
    } catch (e: any) {
      toast.error(e.response?.data?.error || '確定に失敗しました')
    } finally { setCommitting(false) }
  }

  const discard = async () => {
    if (!view || !confirm('この下書きを捨てますか？（シフトには何も入りません）')) return
    try {
      await venueScheduleApi.discard(view.draft.id)
      setView(null)
      setTab('rules')
      refreshDrafts()
      toast.success('下書きを捨てました')
    } catch { toast.error('破棄に失敗しました') }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const committed = view?.draft.status === 'committed'
  const shiftMonth = view ? view.draft.start_date.slice(0, 7) : ''

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-600" />
            希望から自動で作る
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            会場ごとの必要人数と、スタッフの希望から下書きを作ります。確定するまでスタッフには見えません。
          </p>
        </div>
        <Link to="/shift-requests" className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
          <ClipboardList className="w-4 h-4" />希望の集まり具合を見る
        </Link>
      </div>

      {/* 手順のタブ */}
      <div className="flex gap-1 border-b border-gray-200">
        {([['rules', '① 会場ごとの必要人数'], ['draft', '② 下書きを確認して確定']] as const).map(([k, label]) => (
          <button key={k} onClick={() => (k === 'rules' || view) && setTab(k)} disabled={k === 'draft' && !view}
            className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${tab === k ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800 disabled:text-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'rules' && (
        <div className="space-y-4">
          <SlotRulesEditor venues={venues} rules={rules} onChange={() => { loadRules().catch(() => toast.error('枠の読み込みに失敗しました')) }} />

          {/* 下書きを作る */}
          <div className="card space-y-3">
            <h3 className="text-sm font-bold text-gray-800">下書きを作る期間</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-field py-1.5 w-auto" />
              <span className="text-gray-400">〜</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-field py-1.5 w-auto" />
              {[0, 1].map(off => {
                const now = new Date()
                const d = new Date(now.getFullYear(), now.getMonth() + off, 1)
                const [s, e] = monthRange(d.getFullYear(), d.getMonth() + 1)
                return (
                  <button key={off} onClick={() => { setStartDate(s); setEndDate(e) }}
                    className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">
                    {d.getMonth() + 1}月
                  </button>
                )
              })}
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={includeUnsubmitted} onChange={e => setIncludeUnsubmitted(e.target.checked)} className="mt-1" />
              <span>希望を出していない日の人も、足りないときの最後の候補に入れる
                <span className="block text-xs text-gray-400">オフにすると、◎希望・○出勤可 を出した日にだけ入れます</span>
              </span>
            </label>
            <div className="text-xs text-gray-500 space-y-0.5">
              <p>・◎希望の人を先に、○出勤可の人を次に入れます。出勤不可の日には入れません</p>
              <p>・希望の時間帯があれば、枠と合う人を優先します（一部だけ合う人は、足りないときだけ・印付き）</p>
              <p>・同じ日に時間の重なる2か所には入れません。勤務日数と時間がなるべく均等になるようにします</p>
              <p>・すでに入っている確定シフトは消さず、その分を差し引いて空いている枠だけ埋めます</p>
            </div>
            <button onClick={generate} disabled={generating || rules.length === 0}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-bold px-5 py-2.5 rounded-lg text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4" />{generating ? '作成中...' : '希望から下書きを作る'}
            </button>
            {rules.length === 0 && <p className="text-xs text-amber-700">先に上で会場ごとの枠を登録してください</p>}
          </div>

          {drafts.length > 0 && (
            <div className="text-xs text-gray-500">
              <p className="font-bold mb-1">これまでの下書き</p>
              <ul className="space-y-0.5">
                {drafts.slice(0, 5).map(d => (
                  <li key={d.id}>
                    <button onClick={() => openDraft(d.id)} className="hover:text-gray-900 underline-offset-2 hover:underline">
                      {md(d.start_date)}〜{md(d.end_date)}（{d.assignment_count}件）{d.status === 'committed' ? '・確定済み' : '・作りかけ'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'draft' && view && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-gray-800">
              {md(view.draft.start_date)}〜{md(view.draft.end_date)} の下書き
              {committed
                ? <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800">確定済み</span>
                : <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">下書き（スタッフには見えません）</span>}
            </p>
            {!committed && (
              <div className="flex flex-wrap gap-2 ml-auto">
                <button onClick={() => setTab('rules')} className="btn-secondary text-sm py-1.5 flex items-center gap-1.5"><RefreshCw className="w-4 h-4" />枠を直して作り直す</button>
                <button onClick={discard} className="btn-secondary text-sm py-1.5 flex items-center gap-1.5 text-red-600"><Trash2 className="w-4 h-4" />捨てる</button>
                <button onClick={commit} disabled={committing || view.totals.draft_count === 0} className="btn-primary text-sm py-1.5 flex items-center gap-1.5 disabled:opacity-50">
                  <Send className="w-4 h-4" />{committing ? '入れています...' : '確定してシフトに入れる'}
                </button>
              </div>
            )}
          </div>

          {committed && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex flex-wrap items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{view.draft.committed_count ?? 0} 件をシフトに入れました。この月が未公開なら、ダッシュボードの「シフト公開」でスタッフに見えるようになります（公開中の月はすぐ見えます）。</span>
              <Link to={`/shifts?month=${shiftMonth}`} className="ml-auto font-bold flex items-center gap-1 hover:underline">シフト管理を開く<ArrowRight className="w-4 h-4" /></Link>
            </div>
          )}

          <DraftBoard view={view} colorOf={colorOf} onChange={setView} />
        </div>
      )}
    </div>
  )
}
