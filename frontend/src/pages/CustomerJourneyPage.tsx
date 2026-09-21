import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, LogIn, AlertTriangle, CheckCircle2, Clock, UserX, Sprout } from 'lucide-react'
import { api } from '../api/client'

// お客様ごとに「どこから入って → いつ各ステップに着いて → どこで止まって → いつから来ていないか」を追う画面。
// データは /api/admin/journeys（1社1行の要約）と /api/admin/journeys/:id/timeline（足取り）。

type Status = 'internal' | 'onboarding' | 'stuck' | 'active' | 'at_risk' | 'churned'

interface Journey {
  id: number
  name: string
  created_at: string
  internal: boolean
  admin: { name: string | null; email: string | null }
  plan: string
  trial_days_left: number | null
  entry: {
    source: string | null; medium: string | null; campaign: string | null
    landing_path: string | null; referrer: string | null; platform: string | null
    pre_signup_paths: string[]; first_seen_at: string | null
  }
  milestones: { key: string; label: string; at: string | null }[]
  step: string
  stuck_days: number
  status: Status
  status_reason: string
  last_seen_at: string | null
  last_path: string | null
  last_actor: string | null
  days_since_seen: number | null
  staff: { total: number; used_7d: number; punched_7d: number }
  counts: { punches_7d: number; punches_total: number; shifts_upcoming: number; sessions_7d: number; api_errors_7d: number; feedback_open: number }
  onboarding: { last_step: string | null; exit: string | null }
  activity: { date: string; admin: number; staff: number; punch: number }[]
  next_action: string
}

type TimelineItem =
  | { kind: 'session'; at: string; end: string; minutes: number; actor: string; role: string | null; platform: string; paths: string[]; actions: { event: string; path: string | null; meta: any; at: string }[] }
  | { kind: 'fact'; at: string; label: string; detail?: string; tone?: 'good' | 'bad' | 'info' }

interface Funnel {
  days: number
  steps: { key: string; label: string; n: number }[]
  exits: { path: string | null; n: number }[]
  ctas: { label: string | null; location: string | null; n: number }[]
  sources: { source: string; n: number }[]
  clicks: { code: string; n: number }[]
}

const STATUS: Record<Status, { label: string; cls: string; icon: any; order: number }> = {
  churned: { label: '離脱', cls: 'bg-gray-800 text-white border-gray-800', icon: UserX, order: 0 },
  at_risk: { label: '離脱の恐れ', cls: 'bg-red-50 text-red-700 border-red-300', icon: AlertTriangle, order: 1 },
  stuck: { label: '詰まり', cls: 'bg-amber-50 text-amber-800 border-amber-300', icon: Clock, order: 2 },
  onboarding: { label: '立ち上げ中', cls: 'bg-blue-50 text-blue-700 border-blue-300', icon: Sprout, order: 3 },
  active: { label: '定着', cls: 'bg-green-50 text-green-700 border-green-300', icon: CheckCircle2, order: 4 },
  internal: { label: '社内', cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: LogIn, order: 5 },
}

// 画面パス → 日本語名（足取りを読むため）
const PATH_LABEL: Record<string, string> = {
  '/': 'LP', '/login': 'ログイン/登録', '/dashboard': 'ダッシュボード', '/shifts': 'シフト作成', '/staff': 'スタッフ',
  '/report': 'レポート', '/stores': '店舗', '/companies': '会社', '/timecards': 'タイムカード', '/shift-requests': '希望シフト',
  '/labor': '人件費', '/absence': '欠勤', '/templates': 'テンプレ', '/line-settings': 'LINE設定', '/settings': '設定',
  '/help': 'ヘルプ', '/feedback': 'ご意見', '/audit-logs': '操作履歴', '/skills': 'スキル', '/swaps': '交代',
  '/payroll': '給与', '/auto-schedule': '自動作成', '/admin-hub': '管理ハブ', '/setup-guide': '使い方ガイド',
  '/organization': '組織', '/my-shifts': '自分のシフト', '/qr-poster': 'QRポスター', '/kiosk': 'タイムレコーダー',
}
const pathLabel = (p: string | null) => (p ? PATH_LABEL[p] || p : '—')

const EVENT_LABEL: Record<string, string> = {
  register_start: '登録フォームを開く', register_complete: '登録完了', cta_click: 'LPボタン', campaign_landing: '広告から着地',
  onboarding_view: '初期設定を表示', onboarding_step: '初期設定', onboarding_exit: '初期設定を終了',
  api_error: '保存/読込の失敗', checkout_click: '課金ボタン', pro_upgrade_success: 'Pro契約',
}

const toMs = (s: string) => new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')).getTime()
const jst = (s: string | null, withYear = false) => {
  if (!s) return '—'
  const d = new Date(toMs(s) + 9 * 3600 * 1000).toISOString()
  return `${withYear ? d.slice(0, 4) + '/' : ''}${d.slice(5, 7)}/${d.slice(8, 10)} ${d.slice(11, 16)}`
}
const dayDiff = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / 86400000 * 10) / 10

function sourceLabel(e: Journey['entry']): string {
  const parts = [e.source, e.medium, e.campaign].filter(Boolean)
  if (parts.length) return parts.join(' / ')
  if (e.referrer) { try { return `参照: ${new URL(e.referrer).hostname}` } catch { return `参照: ${e.referrer}` } }
  return e.platform === 'ios' ? 'iOSアプリから直接' : '直接（流入元なし）'
}

export default function CustomerJourneyPage() {
  const [rows, setRows] = useState<Journey[]>([])
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [loading, setLoading] = useState(true)
  const [showInternal, setShowInternal] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [j, f] = await Promise.all([
        api.get<{ companies: Journey[] }>('/admin/journeys'),
        api.get<Funnel>('/admin/signup-funnel?days=30').catch(() => ({ data: null })),
      ])
      setRows(j.data.companies)
      setFunnel(f.data)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const visible = useMemo(() => rows
    .filter(r => showInternal || !r.internal)
    .sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || toMs(b.created_at) - toMs(a.created_at)), [rows, showInternal])
  const counts = useMemo(() => {
    const c: Partial<Record<Status, number>> = {}
    rows.filter(r => !r.internal).forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    return c
  }, [rows])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">お客様の動き</h3>
          <p className="text-xs text-gray-500 mt-1">どこから来て、どこまで進み、どこで止まり、いつから来ていないか。社内・審査用アカウントは除外しています。</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={showInternal} onChange={e => setShowInternal(e.target.checked)} /> 社内も表示
          </label>
          <button onClick={load} className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" /> 再読込
          </button>
        </div>
      </div>

      {/* 状態の内訳 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {(['active', 'onboarding', 'stuck', 'at_risk', 'churned'] as Status[]).map(s => {
          const Icon = STATUS[s].icon
          return (
            <div key={s} className={`rounded-xl border p-3 ${STATUS[s].cls}`}>
              <p className="text-xs flex items-center gap-1"><Icon className="w-3.5 h-3.5" />{STATUS[s].label}</p>
              <p className="text-2xl font-bold mt-1">{counts[s] || 0}<span className="text-xs font-normal ml-0.5">社</span></p>
            </div>
          )
        })}
      </div>

      {/* 会社ごと */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">読み込み中...</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">お客様の会社はまだありません</div>
        ) : visible.map(j => (
          <JourneyCard key={j.id} j={j} open={open === j.id} onToggle={() => setOpen(open === j.id ? null : j.id)} />
        ))}
      </div>

      {/* 登録前のファネル */}
      {funnel && <SignupFunnel f={funnel} />}
    </div>
  )
}

function JourneyCard({ j, open, onToggle }: { j: Journey; open: boolean; onToggle: () => void }) {
  const st = STATUS[j.status]
  const Icon = st.icon
  const maxAct = Math.max(1, ...j.activity.map(a => a.admin + a.staff + a.punch))
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-4 space-y-3">
        {/* 見出し */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-bold text-gray-900">
              {j.name}
              <span className="ml-2 text-xs font-normal text-gray-400">#{j.id} {j.admin.name || ''}</span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              登録 {jst(j.created_at, true)}・{j.plan === 'pro' ? 'Pro' : j.trial_days_left !== null ? `無料体験 残り${j.trial_days_left}日` : '無料'}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-semibold ${st.cls}`}>
            <Icon className="w-3.5 h-3.5" />{st.label}
          </span>
        </div>

        {/* 次の一手 */}
        <div className={`text-sm rounded-lg px-3 py-2 ${j.status === 'active' ? 'bg-green-50 text-green-900' : j.status === 'onboarding' ? 'bg-blue-50 text-blue-900' : 'bg-amber-50 text-amber-900'}`}>
          <span className="font-semibold">{j.status_reason}</span>
          <span className="mx-1.5 text-gray-400">→</span>{j.next_action}
        </div>

        {/* 入口 */}
        <div className="text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
          <span><b className="text-gray-800">入口</b> {sourceLabel(j.entry)}</span>
          {j.entry.landing_path && <span>着地 {j.entry.landing_path}</span>}
          {j.entry.pre_signup_paths.length > 0 && (
            <span>登録前の足取り {j.entry.pre_signup_paths.map(pathLabel).join(' → ')}</span>
          )}
          {j.entry.first_seen_at && <span>初訪問 {jst(j.entry.first_seen_at)}</span>}
        </div>

        {/* 到達ステップ */}
        <Milestones j={j} />

        {/* 数字 */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <Stat label="スタッフ" value={`${j.staff.total}人`} sub={`7日で使った ${j.staff.used_7d}人`} warn={j.staff.total > 0 && j.staff.used_7d === 0} />
          <Stat label="打刻（7日）" value={`${j.counts.punches_7d}件`} sub={`累計 ${j.counts.punches_total}件・打刻した人 ${j.staff.punched_7d}`} warn={j.step === 'done' && j.counts.punches_7d === 0} />
          <Stat label="今後のシフト" value={`${j.counts.shifts_upcoming}件`} sub="今日以降に入っている" warn={j.step !== 'store' && j.counts.shifts_upcoming === 0} />
          <Stat label="最後に来た" value={j.days_since_seen === null ? '—' : j.days_since_seen === 0 ? '今日' : `${j.days_since_seen}日前`} sub={j.last_path ? `${j.last_actor || ''}・「${pathLabel(j.last_path)}」画面` : (j.last_actor || '')} warn={(j.days_since_seen ?? 0) >= 7} />
          <Stat label="つまずき" value={`失敗${j.counts.api_errors_7d}・FB${j.counts.feedback_open}`} sub={j.onboarding.exit ? `初期設定: ${j.onboarding.exit}` : j.onboarding.last_step ? `初期設定: ${j.onboarding.last_step}で止まる` : '初期設定の記録なし'} warn={j.counts.api_errors_7d > 0 || j.counts.feedback_open > 0} />
        </div>

        {/* 直近14日 */}
        <div>
          <p className="text-[11px] text-gray-400 mb-1">直近14日（青=管理者の画面表示／緑=スタッフ／橙=打刻）</p>
          <div className="flex items-end gap-1 h-12">
            {j.activity.map(a => {
              const total = a.admin + a.staff + a.punch
              return (
                <div key={a.date} className="flex-1 flex flex-col justify-end h-full" title={`${a.date} 管理者${a.admin}・スタッフ${a.staff}・打刻${a.punch}`}>
                  {total === 0 ? <div className="h-0.5 bg-gray-200 rounded" /> : (
                    <div className="flex flex-col-reverse rounded overflow-hidden" style={{ height: `${Math.max(12, (total / maxAct) * 100)}%` }}>
                      {a.admin > 0 && <div className="bg-blue-400" style={{ flex: a.admin }} />}
                      {a.staff > 0 && <div className="bg-green-400" style={{ flex: a.staff }} />}
                      {a.punch > 0 && <div className="bg-orange-400" style={{ flex: a.punch }} />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>{j.activity[0]?.date.slice(5)}</span><span>今日</span>
          </div>
        </div>
      </div>

      <button onClick={onToggle} className="w-full flex items-center gap-1 px-4 py-2 text-xs font-medium text-indigo-700 bg-gray-50 border-t border-gray-100 hover:bg-gray-100">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        足取りを見る（いつ・誰が・どの画面を・何をしたか）
      </button>
      {open && <Timeline companyId={j.id} />}
    </div>
  )
}

function Milestones({ j }: { j: Journey }) {
  const ms = j.milestones.filter(m => m.key !== 'pro' || m.at)
  return (
    <div className="flex flex-wrap items-stretch gap-1">
      {ms.map((m, i) => {
        const prev = ms.slice(0, i).reverse().find(x => x.at)
        const gap = m.at && prev?.at ? dayDiff(prev.at, m.at) : null
        const isNext = !m.at && ms.slice(0, i).every(x => x.at)
        return (
          <div key={m.key} className="flex items-center">
            {i > 0 && <span className="text-[10px] text-gray-400 px-1 whitespace-nowrap">{gap !== null ? (gap < 1 ? '当日' : `${gap}日`) : ''}→</span>}
            <div className={`rounded-lg border px-2 py-1 text-[11px] leading-tight ${m.at ? 'border-green-200 bg-green-50 text-green-900' : isNext ? 'border-amber-400 bg-amber-50 text-amber-900 font-semibold' : 'border-gray-200 text-gray-400'}`}>
              <p>{m.label}</p>
              <p className="text-[10px] opacity-75">{m.at ? jst(m.at) : isNext ? `ここで止まる${j.stuck_days ? `（${j.stuck_days}日）` : ''}` : '未到達'}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${warn ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
      <p className="text-gray-500">{label}</p>
      <p className="text-base font-bold text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-500 truncate" title={sub}>{sub}</p>
    </div>
  )
}

function Timeline({ companyId }: { companyId: number }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null)
  useEffect(() => {
    api.get<{ items: TimelineItem[] }>(`/admin/journeys/${companyId}/timeline?days=60`)
      .then(r => setItems(r.data.items)).catch(() => setItems([]))
  }, [companyId])
  if (!items) return <div className="px-4 py-6 text-xs text-gray-500">読み込み中...</div>
  if (!items.length) return <div className="px-4 py-6 text-xs text-gray-500">記録がありません</div>
  return (
    <ol className="px-4 py-3 space-y-2 border-t border-gray-100 max-h-[560px] overflow-y-auto">
      {items.map((it, i) => it.kind === 'fact' ? (
        <li key={i} className="flex gap-3 text-xs">
          <span className="w-24 shrink-0 text-gray-400 font-mono">{jst(it.at)}</span>
          <span className={`font-semibold ${it.tone === 'bad' ? 'text-red-600' : it.tone === 'good' ? 'text-green-700' : 'text-gray-700'}`}>● {it.label}</span>
          {it.detail && <span className="text-gray-500 break-all">{it.detail}</span>}
        </li>
      ) : (
        <li key={i} className="flex gap-3 text-xs">
          <span className="w-24 shrink-0 text-gray-400 font-mono">{jst(it.at)}</span>
          <div className="min-w-0 flex-1 rounded-lg bg-gray-50 border border-gray-100 px-2 py-1.5">
            <p className="text-gray-700">
              <b>{it.actor}</b>{it.role === 'staff' ? '（スタッフ）' : ''}
              <span className="text-gray-400 ml-1">{it.platform}・{it.minutes}分</span>
            </p>
            {it.paths.length > 0 && <p className="text-gray-600 mt-0.5">{it.paths.map(pathLabel).join(' → ')}</p>}
            {it.actions.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {it.actions.slice(0, 12).map((a, k) => (
                  <li key={k} className={a.event === 'api_error' ? 'text-red-600' : 'text-indigo-700'}>
                    ・{EVENT_LABEL[a.event] || a.event}
                    {a.meta && <span className="text-gray-500"> {describeMeta(a.event, a.meta)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function describeMeta(event: string, m: any): string {
  if (!m || typeof m !== 'object') return ''
  if (event === 'api_error') return `${m.method || ''} ${m.endpoint || ''} → ${m.status}${m.message ? `「${m.message}」` : ''}`
  if (event === 'onboarding_step') return `${m.step}を${m.action === 'skip' ? 'スキップ' : '完了'}`
  if (event === 'onboarding_view') return m.step || ''
  if (event === 'onboarding_exit') return `${m.step}で${m.via === 'complete' ? '完了' : '全部スキップ'}`
  if (event === 'cta_click') return `${m.label || ''}（${m.location || ''}）`
  return Object.entries(m).map(([k, v]) => `${k}=${v}`).join(' ').slice(0, 80)
}

function SignupFunnel({ f }: { f: Funnel }) {
  const base = Math.max(1, f.steps[0]?.n || 0)
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">登録前のファネル（直近{f.days}日・セッション単位）</p>
        <p className="text-[11px] text-gray-500">LP に来た人がどこで帰ったか。既存ユーザーのログインは除外。</p>
      </div>
      <div className="space-y-1.5">
        {f.steps.map((s, i) => {
          const prev = i > 0 ? f.steps[i - 1].n : s.n
          const drop = prev > 0 ? Math.round((1 - s.n / prev) * 100) : 0
          return (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className="w-36 shrink-0 text-gray-600">{s.label}</span>
              <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
                <div className="bg-indigo-400 h-full" style={{ width: `${(s.n / base) * 100}%` }} />
              </div>
              <span className="w-10 text-right font-mono">{s.n}</span>
              <span className={`w-16 text-right ${i > 0 && drop >= 50 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{i > 0 ? `-${drop}%` : ''}</span>
            </div>
          )
        })}
      </div>
      <div className="grid sm:grid-cols-3 gap-3 text-xs">
        <div>
          <p className="font-semibold text-gray-700 mb-1">登録せず帰った画面</p>
          {f.exits.length ? f.exits.map((e, i) => <p key={i}>{pathLabel(e.path)} <span className="text-gray-400">{e.n}</span></p>) : <p className="text-gray-400">記録なし</p>}
        </div>
        <div>
          <p className="font-semibold text-gray-700 mb-1">押されたLPボタン</p>
          {f.ctas.length ? f.ctas.map((c, i) => <p key={i}>{c.label}（{c.location}）<span className="text-gray-400"> {c.n}</span></p>) : <p className="text-gray-400">記録なし</p>}
        </div>
        <div>
          <p className="font-semibold text-gray-700 mb-1">登録した会社の流入元</p>
          {f.sources.length ? f.sources.map((s, i) => <p key={i}>{s.source} <span className="text-gray-400">{s.n}</span></p>) : <p className="text-gray-400">記録なし</p>}
          {f.clicks.length > 0 && <p className="mt-1 text-gray-500">配布リンク: {f.clicks.map(c => `${c.code}=${c.n}`).join(', ')}</p>}
        </div>
      </div>
    </div>
  )
}
