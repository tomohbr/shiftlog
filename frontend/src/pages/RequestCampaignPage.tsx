import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Megaphone, Plus, Send, BellRing, Lock, Unlock, Trash2, Pencil, Eye, Sparkles, ArrowRight, AlertTriangle,
  CheckCircle2, ChevronDown, X, Users, CalendarDays,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { campaignsApi, Campaign, CampaignSummary } from '../api/client'
import { storeColorMap } from '../lib/storeColors'

// 期間をまたぐ希望の募集（マーケットなど）の管理者画面。
// 管理者が知りたい順に並べる: 「いま何人答えたか・誰がまだか」→「足りない日はどこか」→「一人ひとりの答え」。
//   ① 募集を作る（タイトル・期間・締切）→ 下書き（スタッフには見えない・何も送らない）
//   ② 「LINEで募集を送る」→ 確認 → 連携済みのスタッフに本人専用リンクのカードを1人1通
//   ③ 集まり具合を見て、未回答の人に催促 → 締め切る → この期間で自動作成へ
// 既存の「希望シフト収集」（月ごと）はそのまま。月をまたぐ期間はこちら、と分けている。

const DOW = ['日', '月', '火', '水', '木', '金', '土']
const md = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}/${d}（${DOW[new Date(y, m - 1, d).getDay()]}）`
}
const mdShort = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

const STATUS: Record<Campaign['status'], { label: string; cls: string }> = {
  draft: { label: '下書き（まだ送っていません）', cls: 'bg-yellow-100 text-yellow-800' },
  open: { label: '受付中', cls: 'bg-green-100 text-green-800' },
  closed: { label: '締め切り済み', cls: 'bg-gray-200 text-gray-700' },
}

type Form = { title: string; start_date: string; end_date: string; deadline: string }
const emptyForm: Form = { title: '', start_date: '', end_date: '', deadline: '' }

export default function RequestCampaignPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [summary, setSummary] = useState<CampaignSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Form | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ count: number; long: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'days' | 'people'>('days')
  const [onlyShort, setOnlyShort] = useState(false)
  const [openDay, setOpenDay] = useState<string | null>(null)

  const loadList = async (pick?: number) => {
    const r = await campaignsApi.list()
    setCampaigns(r.data.campaigns)
    const next = pick ?? selected ?? r.data.campaigns.find(c => c.status !== 'closed')?.id ?? r.data.campaigns[0]?.id ?? null
    setSelected(next)
    if (r.data.campaigns.length === 0) setForm(emptyForm)
  }
  const loadSummary = async (id: number) => {
    try { setSummary((await campaignsApi.summary(id)).data) } catch { toast.error('集まり具合を読み込めませんでした') }
  }

  useEffect(() => {
    loadList().catch(() => toast.error('読み込みに失敗しました')).finally(() => setLoading(false))
  }, [])
  useEffect(() => { if (selected) loadSummary(selected); else setSummary(null) }, [selected])

  // 期間を入れたら、候補日が何日あるかをすぐ見せる（会場の枠が無い期間で募集してしまわないように）
  useEffect(() => {
    if (!form?.start_date || !form?.end_date || form.start_date > form.end_date) { setPreview(null); return }
    const t = setTimeout(() => {
      campaignsApi.previewDays(form.start_date, form.end_date).then(r => setPreview(r.data)).catch(() => setPreview(null))
    }, 250)
    return () => clearTimeout(t)
  }, [form?.start_date, form?.end_date])

  const colorOf = useMemo(() => storeColorMap(summary?.stores || []), [summary])
  const storeName = (id: number | null) => summary?.stores.find(s => s.id === id)?.name || '会場指定なし'

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const body = { title: form.title, start_date: form.start_date, end_date: form.end_date, deadline: form.deadline || null }
      const r = editingId ? await campaignsApi.update(editingId, body) : await campaignsApi.create(body)
      toast.success(editingId ? '直しました' : '下書きで保存しました。まだ誰にも送っていません')
      setForm(null); setEditingId(null)
      await loadList(r.data.campaign.id)
      loadSummary(r.data.campaign.id)
    } catch (e: any) {
      toast.error(e.response?.data?.error || '保存できませんでした')
    } finally { setSaving(false) }
  }

  const act = async (fn: () => Promise<any>, after?: (r: any) => void) => {
    if (!summary) return
    setBusy(true)
    try {
      const r = await fn()
      after?.(r.data)
      await loadList(summary.campaign.id)
      await loadSummary(summary.campaign.id)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'うまくいきませんでした')
    } finally { setBusy(false) }
  }

  const send = () => act(() => campaignsApi.send(summary!.campaign.id), d => {
    setConfirmSend(false)
    toast.success(summary!.line_configured
      ? `受付を始めました。LINEを${d.sent}人に送りました${d.failed?.length ? `（${d.failed.join('・')}さんには送れませんでした）` : ''}`
      : '受付を始めました（LINEは未設定のため送っていません）', { duration: 6000 })
  })
  const remind = () => {
    const pending = summary!.staff.filter(s => !s.answered)
    const linked = pending.filter(s => s.linked)
    if (linked.length === 0) { toast('LINEで送れる未回答の人はいません'); return }
    if (!confirm(`まだ答えていない ${linked.length}人（${linked.map(s => s.name).join('・')}）に、LINEで催促を送ります。よろしいですか？`)) return
    act(() => campaignsApi.remind(summary!.campaign.id), d => toast.success(`催促を${d.sent}人に送りました`))
  }
  const sendSample = () => act(() => campaignsApi.preview(summary!.campaign.id), d => toast.success(d.sent ? 'あなたのLINEに見本を送りました' : '送れませんでした'))
  const close = () => {
    if (!confirm('締め切りますか？ スタッフは希望を出せなくなります（あとで受付に戻せます）')) return
    act(() => campaignsApi.close(summary!.campaign.id), () => toast.success('締め切りました'))
  }
  const reopen = () => act(() => campaignsApi.reopen(summary!.campaign.id), () => toast.success('受付に戻しました（LINEは送っていません）'))
  const remove = async () => {
    if (!summary || !confirm('この下書きを消しますか？')) return
    try {
      await campaignsApi.remove(summary.campaign.id)
      toast.success('消しました')
      setSelected(null)
      const r = await campaignsApi.list()
      setCampaigns(r.data.campaigns)
      setSelected(r.data.campaigns[0]?.id ?? null)
      if (r.data.campaigns.length === 0) setForm(emptyForm)
    } catch (e: any) { toast.error(e.response?.data?.error || '消せませんでした') }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
  }

  const c = summary?.campaign
  const pending = summary ? summary.staff.filter(s => !s.answered) : []
  const days = summary ? (onlyShort ? summary.days.filter(d => d.short) : summary.days) : []

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Megaphone className="w-6 h-6 text-green-600" />期間で希望を募集</h2>
          <p className="text-sm text-gray-500 mt-1">マーケットなど、月をまたぐ期間の希望を1回で集めます。候補日は「希望から自動作成」の会場の枠で営業している日です。</p>
        </div>
        {!form && (
          <button onClick={() => { setForm(emptyForm); setEditingId(null) }} className="btn-primary text-sm py-2 flex items-center gap-1.5">
            <Plus className="w-4 h-4" />新しく募集を作る
          </button>
        )}
      </div>

      {/* 作る・直す */}
      {form && (
        <div className="card space-y-3">
          <div className="flex items-center">
            <h3 className="text-base font-bold text-gray-900">{editingId ? '募集を直す' : '新しい募集'}</h3>
            {campaigns.length > 0 && <button onClick={() => { setForm(null); setEditingId(null) }} className="ml-auto p-1 text-gray-400"><X className="w-5 h-5" /></button>}
          </div>
          <label className="block">
            <span className="text-sm font-bold text-gray-700">タイトル</span>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} maxLength={30} placeholder="例：クリスマスマーケット"
              className="input-field mt-1" />
            <span className="text-xs text-gray-500">LINEでは「【{form.title || 'タイトル'}】シフトの希望を教えてください」と届きます</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-sm font-bold text-gray-700">期間（はじめ）</span>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="input-field mt-1" /></label>
            <label className="block"><span className="text-sm font-bold text-gray-700">期間（おわり）</span>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="input-field mt-1" /></label>
          </div>
          <label className="block"><span className="text-sm font-bold text-gray-700">締切</span>
            <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} className="input-field mt-1" /></label>
          {preview && (
            preview.count > 0
              ? <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">候補日 <b>{preview.count}日</b>（うち昼・夜に分かれる日 {preview.long}日）。会場が休みの日は出ません。</p>
              : <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>この期間には会場の枠がありません。先に<Link to="/auto-schedule" className="underline font-bold">希望から自動作成</Link>の①で会場ごとの必要人数を登録してください。</span></p>
          )}
          <button onClick={save} disabled={saving || !form.title || !form.start_date || !form.end_date} className="btn-primary w-full py-2.5 disabled:opacity-50">
            {saving ? '保存中…' : editingId ? '直す' : '下書きで保存（まだ送りません）'}
          </button>
        </div>
      )}

      {/* 募集の切り替え */}
      {campaigns.length > 1 && (
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
          {campaigns.map(x => (
            <button key={x.id} onClick={() => setSelected(x.id)}
              className={`flex-shrink-0 text-left rounded-xl border-2 px-3 py-1.5 ${selected === x.id ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white'}`}>
              <p className="text-sm font-bold text-gray-900 whitespace-nowrap">{x.title}</p>
              <p className="text-[11px] text-gray-500 whitespace-nowrap">{mdShort(x.start_date)}〜{mdShort(x.end_date)}・{STATUS[x.status].label.replace(/（.*/, '')}</p>
            </button>
          ))}
        </div>
      )}

      {summary && c && (
        <>
          {/* 募集の見出しと、いま押すべきボタン */}
          <div className="card space-y-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
                <h3 className="text-xl font-black text-gray-900 mt-1">{c.title}</h3>
                <p className="text-sm text-gray-700">{md(c.start_date)} 〜 {md(c.end_date)}・候補 {summary.totals.days}日</p>
                {c.deadline && (
                  <p className={`text-sm font-bold ${c.days_left !== null && c.days_left < 0 ? 'text-gray-500' : c.days_left !== null && c.days_left <= 2 ? 'text-red-600' : 'text-blue-700'}`}>
                    締切 {md(c.deadline)}{c.days_left !== null && (c.days_left < 0 ? '（過ぎました）' : c.days_left === 0 ? '（今日まで）' : `（あと${c.days_left}日）`)}
                  </p>
                )}
              </div>
              {c.status === 'draft' && (
                <div className="ml-auto flex gap-1 flex-shrink-0">
                  <button onClick={() => { setForm({ title: c.title, start_date: c.start_date, end_date: c.end_date, deadline: c.deadline || '' }); setEditingId(c.id) }} className="p-2 rounded-lg border border-gray-200 text-gray-600" aria-label="直す"><Pencil className="w-4 h-4" /></button>
                  <button onClick={remove} className="p-2 rounded-lg border border-gray-200 text-red-600" aria-label="消す"><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>

            {c.status === 'draft' && (
              <button onClick={() => setConfirmSend(true)} disabled={busy || summary.totals.days === 0}
                className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold flex items-center justify-center gap-2 disabled:bg-gray-300">
                <Send className="w-5 h-5" />LINEで募集を送る
              </button>
            )}
            {c.status === 'open' && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={remind} disabled={busy || pending.length === 0}
                  className="py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:bg-gray-300">
                  <BellRing className="w-4 h-4" />未回答の人に催促
                </button>
                <button onClick={close} disabled={busy} className="py-2.5 rounded-xl border-2 border-gray-300 text-gray-700 font-bold text-sm flex items-center justify-center gap-1.5">
                  <Lock className="w-4 h-4" />締め切る
                </button>
              </div>
            )}
            {c.status !== 'closed' && summary.line_configured && (
              <button onClick={sendSample} disabled={busy} className="w-full text-sm text-gray-600 underline underline-offset-2 py-1">
                自分のLINEに見本を送る（スタッフと同じカード・1通）
              </button>
            )}
            {c.status === 'closed' && (
              <button onClick={reopen} disabled={busy} className="w-full py-2.5 rounded-xl border-2 border-gray-300 text-gray-700 font-bold text-sm flex items-center justify-center gap-1.5">
                <Unlock className="w-4 h-4" />受付に戻す
              </button>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link to={`/campaign/${c.id}`} className="text-gray-600 hover:text-gray-900 flex items-center gap-1"><Eye className="w-4 h-4" />スタッフの画面を見る</Link>
              {c.status !== 'draft' && (
                <Link to={`/auto-schedule?start=${c.start_date}&end=${c.end_date}`} className="text-purple-700 font-bold hover:underline flex items-center gap-1">
                  <Sparkles className="w-4 h-4" />この期間で自動作成へ<ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          </div>

          {/* 集まり具合 */}
          {c.status !== 'draft' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="card py-3">
                <p className="text-xs font-bold text-gray-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" />回答</p>
                <p className="text-2xl font-black text-gray-900">{summary.totals.answered}<span className="text-base font-bold text-gray-500"> / {summary.totals.staff}人</span></p>
              </div>
              <div className="card py-3">
                <p className="text-xs font-bold text-gray-500 flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />人が足りない日</p>
                <p className={`text-2xl font-black ${summary.totals.short_days > 0 ? 'text-red-600' : 'text-green-700'}`}>{summary.totals.short_days}<span className="text-base font-bold text-gray-500"> / {summary.totals.days}日</span></p>
              </div>
            </div>
          )}

          {c.status !== 'draft' && pending.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-bold text-amber-900">まだ答えていない人（{pending.length}人）</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {pending.map(s => (
                  <span key={s.id} className="text-sm bg-white border border-amber-200 rounded-full px-2.5 py-0.5 text-gray-800">
                    {s.name}{!s.linked && <span className="ml-1 text-[11px] text-red-600 font-bold">LINE未連携</span>}
                  </span>
                ))}
              </div>
              {pending.some(s => !s.linked) && <p className="text-xs text-amber-800 mt-1.5">LINE未連携の人には催促が届きません。直接伝えてください。</p>}
            </div>
          )}
          {c.status !== 'draft' && pending.length === 0 && summary.totals.staff > 0 && (
            <p className="text-sm font-bold text-green-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />全員が答えました</p>
          )}

          {c.status !== 'draft' && (
            <div className="space-y-2">
              <div className="flex gap-1 border-b border-gray-200">
                {([['days', '日ごと（足りるか）'], ['people', '人ごと（質問の答え）']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)}
                    className={`px-3 py-2 text-sm font-bold border-b-2 -mb-px ${tab === k ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'}`}>{label}</button>
                ))}
              </div>

              {tab === 'days' && (
                <>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <label className="flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap"><input type="checkbox" checked={onlyShort} onChange={e => setOnlyShort(e.target.checked)} />足りない日だけ</label>
                    <span className="ml-auto text-right">◎○の人数 ／ 必要人数</span>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 -mx-4 sm:mx-0">
                    {days.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">足りない日はありません</p>}
                    {days.map(d => {
                      const opened = openDay === d.date
                      const dow = d.weekday
                      return (
                        <div key={d.date}>
                          <button onClick={() => setOpenDay(opened ? null : d.date)} className="w-full flex items-start gap-2 px-4 py-2 text-left">
                            <div className="w-[5.25rem] flex-shrink-0">
                              <p className={`text-sm font-bold whitespace-nowrap ${dow === 0 ? 'text-red-600' : dow === 6 ? 'text-blue-600' : 'text-gray-900'}`}>{mdShort(d.date)}<span className="text-xs ml-0.5">{DOW[dow]}</span></p>
                              {d.long && <span className="text-[10px] font-bold px-1 rounded bg-amber-100 text-amber-800">昼夜</span>}
                            </div>
                            <div className="flex-1 min-w-0 space-y-0.5">
                              {d.venues.map(v => {
                                const col = colorOf(v.store_id)
                                return (
                                  <div key={v.store_id ?? 0} className="flex items-center gap-1.5 text-sm">
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col.solid }} />
                                    <span className="font-bold truncate" style={{ color: col.text }}>{storeName(v.store_id)}</span>
                                    <span className="ml-auto tabular-nums text-gray-700 whitespace-nowrap">
                                      <span style={{ color: '#F08C00' }} className="font-bold">◎{v.preferred}</span>
                                      <span style={{ color: '#2F9E44' }} className="font-bold ml-1">○{v.available}</span>
                                      <span className="text-gray-400"> / {v.needed}</span>
                                    </span>
                                    {v.short > 0
                                      ? <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 whitespace-nowrap">あと{v.short}</span>
                                      : <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-green-50 text-green-700">OK</span>}
                                  </div>
                                )
                              })}
                            </div>
                            <ChevronDown className={`w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0 transition-transform ${opened ? 'rotate-180' : ''}`} />
                          </button>
                          {opened && (
                            <div className="px-4 pb-3 space-y-2">
                              {d.venues.map(v => (
                                <div key={v.store_id ?? 0} className="rounded-lg px-3 py-2" style={{ backgroundColor: colorOf(v.store_id).soft }}>
                                  <p className="text-xs font-bold" style={{ color: colorOf(v.store_id).text }}>{storeName(v.store_id)}</p>
                                  <div className="text-xs text-gray-600 mt-0.5 space-y-0.5">
                                    {v.slots.map(s => (
                                      <p key={s.start_time}>{s.start_time}–{s.end_time}{d.long ? `（${s.part === 'a' ? '昼' : '夜'}）` : ''}：入れる人 {s.candidates} ／ 必要 {s.needed}{s.short > 0 && <b className="text-red-600 ml-1">あと{s.short}人</b>}</p>
                                    ))}
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {v.people.length === 0 && <span className="text-xs text-gray-500">まだいません</span>}
                                    {v.people.map(p => (
                                      <span key={p.user_id} className="text-xs bg-white rounded-full px-2 py-0.5 border border-gray-200">
                                        <b style={{ color: p.availability === 'preferred' ? '#F08C00' : '#2F9E44' }}>{p.availability === 'preferred' ? '◎' : '○'}</b>{p.name}{p.part_label && <span className="text-gray-500">・{p.part_label}</span>}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-gray-500">「入れる人」は、その日に ◎○ を付けて、入りたい会場にその会場を選んだ（または「どこでも」）人です。昼の枠は昼・どちらか・通しの人、夜の枠は夜・どちらか・通しの人で数えます（「どちらか」の人は1日に片方しか入れないので、足りない数はそれも考えて出します）。同じ人が2つの会場に数えられることがあります。</p>
                </>
              )}

              {tab === 'people' && (
                <div className="space-y-2">
                  {summary.staff.map(s => (
                    <div key={s.id} className={`card py-3 ${s.answered ? '' : 'bg-gray-50'}`}>
                      <div className="flex items-center gap-2">
                        <p className="text-base font-bold text-gray-900">{s.name}</p>
                        {s.answered
                          ? <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-800">回答済み</span>
                          : <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">未回答</span>}
                        {!s.linked && <span className="text-[11px] font-bold text-red-600">LINE未連携</span>}
                        <span className="ml-auto text-sm tabular-nums whitespace-nowrap">
                          <b style={{ color: '#F08C00' }}>◎{s.counts.preferred}</b>
                          <b className="ml-1" style={{ color: '#2F9E44' }}>○{s.counts.available}</b>
                          <b className="ml-1" style={{ color: '#E03131' }}>×{s.counts.unavailable}</b>
                        </span>
                      </div>
                      {s.answer && (
                        <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-sm">
                          <dt className="text-gray-500">会場</dt>
                          <dd className="font-bold text-gray-900">{s.answer.venues_any ? 'どこでも' : s.answer.venue_names.join('・')}</dd>
                          <dt className="text-gray-500">週の日数</dt><dd className="text-gray-900">{s.answer.days_per_week_label || '—'}</dd>
                          <dt className="text-gray-500">入れない曜日</dt><dd className="text-gray-900">{s.answer.ng_label || 'なし'}</dd>
                          <dt className="text-gray-500">交通手段</dt>
                          <dd className="text-gray-900">{[...s.answer.transport, s.answer.transport_note].filter(Boolean).join('・') || '—'}</dd>
                          <dt className="text-gray-500">掛け持ち</dt>
                          <dd className="text-gray-900">{s.answer.other_job === 'yes' ? `あり${s.answer.other_job_note ? `（${s.answer.other_job_note}）` : ''}` : s.answer.other_job === 'none' ? 'なし' : '—'}</dd>
                          <dt className="text-gray-500">土日の通し</dt><dd className="text-gray-900">{s.answer.long_day_label || '—'}</dd>
                          {s.answer.referred_by && <><dt className="text-gray-500">紹介者</dt><dd className="font-bold text-gray-900">{summary.staff.find(x => x.id === s.answer!.referred_by)?.name || '—'}さんの紹介（なるべく一緒に入れる）</dd></>}
                          <dt className="text-gray-500">友だち紹介</dt>
                          <dd className={s.answer.referral === 'yes' || s.answer.referral === 'ask' ? 'font-bold text-green-700' : 'text-gray-900'}>{s.answer.referral_label ? `${s.answer.referral_label}${s.answer.referral_note ? `（${s.answer.referral_note}）` : ''}` : '—'}</dd>
                          {s.answer.comment && <><dt className="text-gray-500">ひとこと</dt><dd className="text-gray-900 whitespace-pre-wrap">{s.answer.comment}</dd></>}
                        </dl>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* LINEで送る前の確認 */}
      {confirmSend && summary && c && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setConfirmSend(false)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-5 pt-4 pb-2 flex items-center">
              <h3 className="text-lg font-bold text-gray-900">{summary.line_configured ? 'LINEで募集を送ります' : '受付を始めます'}</h3>
              <button onClick={() => setConfirmSend(false)} className="ml-auto p-1 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 pb-4 space-y-3 text-sm">
              {summary.line_configured ? (
                <>
                  <div className="rounded-xl border border-gray-200 p-3 bg-gray-50">
                    <p className="text-xs text-gray-500 mb-1">届くカード（1人1通・本人専用のボタン付き）</p>
                    <p className="font-bold text-gray-900">【{c.title}】シフトの希望を教えてください</p>
                    <p className="text-gray-700">期間 {mdShort(c.start_date)}〜{mdShort(c.end_date)}</p>
                    {c.deadline && <p className="text-gray-700">締切 {md(c.deadline)}{c.days_left !== null && c.days_left >= 0 ? `（あと${c.days_left}日）` : ''}</p>}
                    <p className="text-gray-700">{summary.contact}より</p>
                    <p className="mt-2 text-center text-white font-bold bg-green-600 rounded-lg py-1.5">希望を出す</p>
                  </div>
                  <p><b>{summary.staff.filter(s => s.linked).length}人</b>に送ります：{summary.staff.filter(s => s.linked).map(s => s.name).join('・') || 'なし'}</p>
                  {summary.staff.some(s => !s.linked) && (
                    <p className="text-amber-800 bg-amber-50 rounded-lg px-3 py-2">LINE未連携の{summary.staff.filter(s => !s.linked).length}人（{summary.staff.filter(s => !s.linked).map(s => s.name).join('・')}）には届きません。直接伝えてください。</p>
                  )}
                </>
              ) : (
                <p className="text-amber-800 bg-amber-50 rounded-lg px-3 py-2">LINE通知の設定がまだなので、LINEは送りません。受付だけ始めて、スタッフには希望シフトの画面から答えてもらいます。</p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => setConfirmSend(false)} className="py-2.5 rounded-xl border-2 border-gray-300 font-bold text-gray-700">やめる</button>
                <button onClick={send} disabled={busy} className="py-2.5 rounded-xl bg-green-600 text-white font-bold disabled:bg-gray-300 flex items-center justify-center gap-1.5">
                  <Send className="w-4 h-4" />{busy ? '送っています…' : summary.line_configured ? '送る' : '受付を始める'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
