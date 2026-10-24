import { useEffect, useState } from 'react'
import { QrCode, Play, Square, Coffee, CheckCircle2, Loader2, MapPin, CalendarClock, AlertTriangle, Package } from 'lucide-react'
import { invApi, liffApi, QrClockAction, QrClockStatus } from '../api/client'
import { readPosition } from './QrClockPage'

// LINE の中で開く、本人専用の打刻画面（LIFF）。/liff/punch/:companyId
// LINE のメニュー「打刻する」から開く → LINE が本人を確かめる → ブースのQRを読む → 打刻。
// 名前を選ぶ画面はない（ほかの人の打刻はできない）。会場QRは「どこか」を示すだけ。

declare global { interface Window { liff?: any } }

const LIFF_SDK = 'https://static.line-scdn.net/liff/edge/2/sdk.js'
const LABEL: Record<QrClockAction, string> = { 'clock-in': '出勤', 'clock-out': '退勤', 'break-start': '休憩開始', 'break-end': '休憩終了' }

function loadSdk(): Promise<any> {
  if (window.liff) return Promise.resolve(window.liff)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = LIFF_SDK
    s.onload = () => resolve(window.liff)
    s.onerror = () => reject(new Error('LINEの部品を読み込めませんでした'))
    document.head.appendChild(s)
  })
}

type Shift = { start_time: string; end_time: string; store_id: number | null; store_name: string | null }

export default function LiffPunchPage({ companyId }: { companyId: number }) {
  const [phase, setPhase] = useState<'loading' | 'error' | 'unlinked' | 'ready'>('loading')
  const [error, setError] = useState('')
  const [company, setCompany] = useState('')
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [shifts, setShifts] = useState<Shift[]>([])
  const [status, setStatus] = useState<QrClockStatus | null>(null)
  const [venue, setVenue] = useState<{ qr: string; id: number; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ action: QrClockAction; time: string; store: string } | null>(null)
  const [now, setNow] = useState(new Date())
  const [stockOn, setStockOn] = useState(false)

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t) }, [])

  useEffect(() => {
    (async () => {
      try {
        const cfg = await liffApi.config(companyId)
        setCompany(cfg.data.company_name)
        const liff = await loadSdk()
        await liff.init({ liffId: cfg.data.liff_id })
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return }
        const idToken = liff.getIDToken()
        if (!idToken) throw new Error('LINEの本人確認ができませんでした')
        const r = await liffApi.session(companyId, idToken)
        if (!r.data.linked) { setPhase('unlinked'); return }
        setKey(r.data.key); setName(r.data.user.name); setShifts(r.data.today_shifts)
        setStatus({ record: r.data.record, breaks: r.data.breaks, on_break: r.data.on_break })
        setPhase('ready')
        // 催事の在庫が有効なら、退勤の前に閉店の締めへ行けるボタンを出す
        invApi(r.data.key).me().then(m => setStockOn(m.data.enabled)).catch(() => {})
        readPosition(8000) // 位置の許可を先に聞いておく（押した瞬間に待たせないため）
      } catch (e: any) {
        setError(e.response?.data?.error || e.message || '開けませんでした')
        setPhase('error')
      }
    })()
  }, [companyId])

  const scan = async () => {
    const liff = window.liff
    if (!liff?.isApiAvailable?.('scanCodeV2')) {
      setError('QRを読むには、LINEアプリの中で開いてください（LINEのメニュー「打刻する」から）')
      return
    }
    try {
      const r = await liff.scanCodeV2()
      if (!r?.value) return
      const v = await liffApi.venue(key, r.value)
      setVenue({ qr: r.value, ...v.data.store }); setError('')
    } catch (e: any) {
      setError(e.response?.data?.error || 'QRを読めませんでした。もう一度読んでください')
    }
  }

  const punch = async (action: QrClockAction) => {
    if (!venue) return
    setBusy(true)
    try {
      const pos = await readPosition(4000)
      const r = await liffApi.punch(key, venue.qr, action, pos)
      setStatus({ record: r.data.record, breaks: r.data.breaks, on_break: r.data.on_break })
      setDone({ action, time: r.data.time, store: r.data.store_name })
      setVenue(null)
    } catch (e: any) {
      setError(e.response?.data?.error || '打刻できませんでした。電波の良い所でもう一度押してください')
      if (e.response?.status === 401) setPhase('error')
    } finally {
      setBusy(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 pt-4 pb-3 text-center">
        <p className="text-xs text-gray-500">{company}</p>
        <p className="text-4xl font-mono font-bold text-gray-900 tabular-nums">{now.toTimeString().slice(0, 5)}</p>
        <p className="text-sm text-gray-500">{now.getMonth() + 1}月{now.getDate()}日（{'日月火水木金土'[now.getDay()]}）</p>
      </header>
      <main className="flex-1 w-full max-w-md mx-auto px-4 py-5 space-y-4">{children}</main>
    </div>
  )

  if (phase === 'loading') return shell(<div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>)
  if (phase === 'error') return shell(<p className="text-center text-gray-800 font-semibold py-10">{error}</p>)
  if (phase === 'unlinked') {
    return shell(
      <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-2">
        <p className="text-lg font-bold text-gray-900">まだシフトログと連携されていません</p>
        <p className="text-sm text-gray-600">お店の人からもらった「LINE招待」のQRを読んで、連携してから使ってください。</p>
      </div>
    )
  }

  const record = status?.record || null
  const state = !record ? 'not_started' : record.status === 'closed' ? 'finished' : status?.on_break ? 'on_break' : 'working'
  const actions: { a: QrClockAction; icon: typeof Play; color: string }[] =
    state === 'not_started' || state === 'finished' ? [{ a: 'clock-in', icon: Play, color: 'bg-green-600' }]
      : state === 'working' ? [{ a: 'break-start', icon: Coffee, color: 'bg-amber-500' }, { a: 'clock-out', icon: Square, color: 'bg-red-600' }]
      : [{ a: 'break-end', icon: Play, color: 'bg-blue-600' }]

  if (done) {
    return shell(
      <div className="bg-white rounded-2xl border-2 border-green-500 p-6 text-center space-y-2">
        <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
        <p className="text-2xl font-bold text-gray-900">{LABEL[done.action]}しました</p>
        <p className="text-4xl font-bold tabular-nums text-gray-900">{done.time}</p>
        <p className="text-base text-gray-700 flex items-center justify-center gap-1"><MapPin className="w-4 h-4" />{done.store}</p>
        <p className="text-sm text-gray-500">{name}さん</p>
        <div className="grid grid-cols-2 gap-2 pt-3">
          <button onClick={() => setDone(null)} className="py-3 rounded-xl border border-gray-300 font-bold text-gray-700">戻る</button>
          <button onClick={() => window.liff?.closeWindow?.()} className="py-3 rounded-xl bg-gray-900 text-white font-bold">閉じる</button>
        </div>
      </div>
    )
  }

  return shell(
    <>
      <div className="flex items-center justify-between">
        <p className="text-lg font-bold text-gray-900">{name}さん</p>
        <span className={`text-sm font-bold px-3 py-1 rounded-full ${
          state === 'working' ? 'bg-green-100 text-green-800' : state === 'on_break' ? 'bg-amber-100 text-amber-800' : state === 'finished' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
        }`}>
          {state === 'working' ? `勤務中${record?.store_name ? `（${record.store_name}）` : ''}` : state === 'on_break' ? '休憩中' : state === 'finished' ? '今日の勤務は終了' : 'まだ出勤していません'}
        </span>
      </div>

      {shifts.length > 0 && (
        <div className="rounded-xl bg-white border border-gray-200 px-4 py-3">
          <p className="text-xs font-bold text-gray-500 flex items-center gap-1"><CalendarClock className="w-4 h-4" />今日の予定</p>
          {shifts.map((t, i) => (
            <p key={i} className="text-lg font-bold text-gray-900 tabular-nums">
              {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}{t.store_name && <span className="ml-2 text-base">{t.store_name}</span>}
            </p>
          ))}
        </div>
      )}

      {error && <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">{error}</p>}

      {!venue ? (
        <button onClick={scan} className="w-full py-6 rounded-2xl bg-[#06C755] text-white text-xl font-bold flex items-center justify-center gap-3 shadow-sm active:opacity-90">
          <QrCode className="w-8 h-8" />ブースのQRを読む
        </button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl bg-white border-2 border-gray-900 px-4 py-3 flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            <span className="text-lg font-bold">{venue.name}</span>
            <button onClick={() => setVenue(null)} className="ml-auto text-sm text-gray-500 underline">読み直す</button>
          </div>
          {shifts.length > 0 && shifts.every(t => t.store_id && t.store_id !== venue.id) && (
            <div className="rounded-xl bg-amber-50 border-2 border-amber-300 px-4 py-3 flex gap-2 text-sm text-amber-900">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
              <span>今日は<b>{shifts[0].store_name}</b>の予定です。ヘルプでこちらに入るなら、このまま打刻してください。</span>
            </div>
          )}
          {actions.map(({ a, icon: Icon, color }) => (
            <button key={a} onClick={() => punch(a)} disabled={busy} className={`w-full py-6 rounded-2xl text-white text-2xl font-bold flex items-center justify-center gap-3 ${color} disabled:opacity-60`}>
              {busy ? <Loader2 className="w-7 h-7 animate-spin" /> : <Icon className="w-7 h-7" />}{LABEL[a]}
            </button>
          ))}
        </div>
      )}
      {stockOn && (
        <a href={`/liff/punch/${companyId}/stock`} className="w-full py-4 rounded-2xl border-2 border-gray-900 bg-white text-gray-900 text-lg font-bold flex items-center justify-center gap-2">
          <Package className="w-6 h-6" />閉店の締め・在庫
        </a>
      )}
      <p className="text-xs text-center text-gray-400">打刻のとき、不正防止のため位置情報を記録します（許可しなくても打刻できます）</p>
    </>
  )
}
