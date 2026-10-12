import { useCallback, useEffect, useRef, useState } from 'react'
import { MapPin, Play, Square, Coffee, CheckCircle2, UserRound, Loader2, Search, CalendarClock, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { qrClockApi, QrClockAction, QrClockInfo, QrClockStatus } from '../api/client'
import { storeColorByIndex } from '../lib/storeColors'
import { useAuth } from '../contexts/AuthContext'

// 会場QRの打刻画面（/q/<token>）。ブースに貼ったポスターをスタッフが自分のスマホで読み取って開く。
//
// - ログイン不要。初回だけ自分の名前を選び、端末に「選んだ名前（userId）」だけを覚える。
//   ログイントークンは発行しない（覚えるのは会社ごとなので、同じ会社の別会場のQRでも名前選択は不要）
// - すでにログイン済みで、その会社のスタッフなら本人として扱う（LINEのリンクから入った人など）
// - 押せるボタンは今日の状態に応じて出し分ける。押したら時刻と会場名を大きく出して完了を伝える
// - 位置情報は取れたら一緒に送る（不正防止の参考記録。拒否・失敗でも打刻は止めない）

type Phase = 'loading' | 'error' | 'select' | 'punch'
interface Me { id: number; name: string }
interface Position { lat: number; lng: number; accuracy: number }
interface Done { action: QrClockAction; time: string; storeName: string; userName: string }

const ACTION_DONE: Record<QrClockAction, { label: string; color: string }> = {
  'clock-in': { label: '出勤しました', color: 'bg-green-600' },
  'break-start': { label: '休憩に入りました', color: 'bg-yellow-500' },
  'break-end': { label: '休憩から戻りました', color: 'bg-blue-600' },
  'clock-out': { label: '退勤しました', color: 'bg-red-600' },
}

// 端末に覚える「この会社では自分はこの人」。localStorage が使えない環境では毎回名前を選ぶ
const rememberKey = (companyId: number) => `shiftlog:qrClockUser:${companyId}`
function readRemembered(companyId: number): Me | null {
  try {
    const raw = localStorage.getItem(rememberKey(companyId))
    if (!raw) return null
    const v = JSON.parse(raw)
    return typeof v?.id === 'number' && typeof v?.name === 'string' ? { id: v.id, name: v.name } : null
  } catch { return null }
}
function writeRemembered(companyId: number, me: Me | null) {
  try {
    if (me) localStorage.setItem(rememberKey(companyId), JSON.stringify(me))
    else localStorage.removeItem(rememberKey(companyId))
  } catch { /* 保存できなくても打刻はできる */ }
}

// 現在地を1回だけ取る。拒否・非対応・時間切れは null（打刻は止めない）
export function readPosition(timeoutMs: number): Promise<Position | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { resolve(null); return }
    let settled = false
    const finish = (p: Position | null) => { if (!settled) { settled = true; resolve(p) } }
    const timer = setTimeout(() => finish(null), timeoutMs + 500)
    try {
      navigator.geolocation.getCurrentPosition(
        p => { clearTimeout(timer); finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }) },
        () => { clearTimeout(timer); finish(null) },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
      )
    } catch { clearTimeout(timer); finish(null) }
  })
}

export default function QrClockPage({ token }: { token: string }) {
  const { user, companies, loading: authLoading } = useAuth()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [info, setInfo] = useState<QrClockInfo | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [status, setStatus] = useState<QrClockStatus | null>(null)
  // 今日のシフト（違う会場のQRを読んだら気づけるように）
  const [todayShifts, setTodayShifts] = useState<{ start_time: string; end_time: string; store_id: number | null; store_name: string | null }[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(new Date())
  const lastPosition = useRef<{ pos: Position; at: number } | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // 会場・会社・スタッフ一覧
  useEffect(() => {
    qrClockApi.info(token)
      .then(res => setInfo(res.data))
      .catch((e: any) => {
        setError(e.response?.data?.error || '打刻画面を開けませんでした。電波の良い場所でもう一度読み取ってください')
        setPhase('error')
      })
  }, [token])

  // 打刻する本人を決める: 端末に覚えた人 → ログイン中の本人（その会社の所属なら）→ 名前選択
  useEffect(() => {
    if (!info || authLoading) return
    if (choosing) { setPhase('select'); return }
    const inCompany = (id: number) => info.staff.some(s => s.id === id)
    const remembered = readRemembered(info.company.id)
    if (remembered && inCompany(remembered.id)) {
      setMe(remembered)
    } else if (user && companies.some(c => c.id === info.company.id) && inCompany(user.id)) {
      setMe({ id: user.id, name: user.name })
    } else {
      if (remembered) writeRemembered(info.company.id, null)
      setMe(null)
      setPhase('select')
    }
  }, [info, authLoading, user, companies, choosing])

  const loadStatus = useCallback(async (target: Me) => {
    try {
      const res = await qrClockApi.status(token, target.id)
      setStatus(res.data)
      setTodayShifts(res.data.today_shifts || [])
      setPhase('punch')
    } catch (e: any) {
      // 退職などで会社から外れた人を覚えていた場合は、名前選択からやり直す
      if (e.response?.status === 403 && info) {
        writeRemembered(info.company.id, null)
        setMe(null)
        setPhase('select')
        return
      }
      setError(e.response?.data?.error || '今日の打刻状況を読み込めませんでした')
      setPhase('error')
    }
  }, [token, info])

  // 本人が決まったら今日の状況を読み、位置の取得も先に始めておく（押した瞬間に待たせないため）
  useEffect(() => {
    if (!me) return
    loadStatus(me)
    readPosition(8000).then(pos => { if (pos) lastPosition.current = { pos, at: Date.now() } })
  }, [me, loadStatus])

  // 名前は最初の1回だけ選ぶ。以後この端末はその人として打刻する（「別の人で打刻」は代理打刻につながるので置かない）。
  // 選び間違えると直せないので、ここで一度だけ確かめる
  const selectMe = (staff: Me) => {
    if (!info) return
    if (!window.confirm(`${staff.name}さんで間違いないですか？\nこのスマホは、これから${staff.name}さんとして打刻します。`)) return
    writeRemembered(info.company.id, staff)
    setChoosing(false)
    setQuery('')
    setDone(null)
    setMe(staff)
  }


  const doPunch = async (action: QrClockAction) => {
    if (!me || busy) return
    setBusy(true)
    try {
      // 2分以内に取れた位置があればそれを使い、無ければ少しだけ待って取る
      const cached = lastPosition.current && Date.now() - lastPosition.current.at < 2 * 60 * 1000 ? lastPosition.current.pos : null
      const pos = cached || await readPosition(4000)
      const res = await qrClockApi.punch(token, { userId: me.id, action, ...(pos || {}) })
      setStatus(res.data)
      setDone({ action, time: res.data.time, storeName: res.data.store_name, userName: res.data.user?.name || me.name })
    } catch (e: any) {
      const data = e.response?.data
      toast.error(data?.error || '打刻できませんでした。電波の良い場所でもう一度押してください')
      // 状態がずれていた（別の端末で打刻済みなど）ときは最新の状態に合わせる
      if (data && 'record' in data) setStatus({ record: data.record, breaks: data.breaks || [], on_break: !!data.on_break })
    } finally {
      setBusy(false)
    }
  }

  const venueName = info?.store.name || ''
  // 会場の色（シフト画面・管理画面と同じ色）。ブースを間違えていないか色でも分かるように
  const venueColor = storeColorByIndex(info?.store.color_index)
  const header = (
    <header className="bg-white border-b border-gray-200 px-4 pt-5 pb-4 text-center border-t-8" style={{ borderTopColor: venueName ? venueColor.solid : 'transparent' }}>
      {info && <p className="text-xs text-gray-500 break-words">{info.company.name}</p>}
      <h1 className="mt-1 flex items-center justify-center gap-1.5 text-2xl font-bold text-gray-900 break-words">
        {venueName && <MapPin className="w-6 h-6 shrink-0" style={{ color: venueColor.solid }} />}
        <span className="min-w-0">{venueName || 'シフトログ'}</span>
      </h1>
      <p className="mt-2 text-4xl font-mono font-bold text-gray-900 tabular-nums">{now.toTimeString().slice(0, 5)}</p>
      <p className="text-sm text-gray-500">
        {now.getMonth() + 1}月{now.getDate()}日（{'日月火水木金土'[now.getDay()]}）
      </p>
    </header>
  )

  // 「打刻は本人のLINEからだけ」のお店: 名前を選ぶ打刻はさせず、LINE の「打刻する」へ案内する
  if (info?.line_only) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <main className="flex-1 w-full max-w-md mx-auto px-4 py-8 text-center space-y-4">
          <p className="text-lg font-bold text-gray-900">打刻はLINEからお願いします</p>
          <p className="text-sm text-gray-600">LINEの「{info.company.name}」のトーク画面で、下のメニューの<b>「打刻する」</b>を押してください。そこからこのQRを読むと打刻できます。</p>
          {info.liff_url && (
            <a href={info.liff_url} className="block w-full py-4 rounded-xl bg-[#06C755] text-white text-lg font-bold">LINEで打刻する</a>
          )}
        </main>
      </div>
    )
  }

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center max-w-sm w-full">
            <p className="text-gray-800 font-semibold break-words">{error}</p>
            <button onClick={() => window.location.reload()} className="mt-5 w-full min-h-[48px] rounded-xl bg-blue-600 text-white font-semibold">
              もう一度読み込む
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'select' && info) {
    const filtered = query.trim()
      ? info.staff.filter(s => s.name.replace(/\s/g, '').includes(query.replace(/\s/g, '')))
      : info.staff
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <main className="flex-1 w-full max-w-lg mx-auto px-4 py-5">
          <p className="text-lg font-bold text-gray-900 text-center">あなたの名前をタップしてください</p>
          <p className="text-xs text-gray-500 text-center mt-1">次回からはこのスマホで名前選びは不要です</p>
          {info.staff.length > 12 && (
            <div className="relative mt-4">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="名前で探す"
                className="w-full min-h-[48px] pl-9 pr-3 border border-gray-300 rounded-xl text-base"
              />
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            {filtered.map(s => (
              <button
                key={s.id}
                onClick={() => selectMe({ id: s.id, name: s.name })}
                className="min-h-[64px] px-3 py-3 bg-white border border-gray-200 rounded-xl text-left flex items-center gap-2 active:bg-blue-50 hover:border-blue-300"
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color || '#4A90E2' }} />
                <span className="text-base font-semibold text-gray-900 break-words min-w-0">{s.name}</span>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="mt-6 text-center text-sm text-gray-500">
              {info.staff.length === 0 ? 'スタッフが登録されていません。管理者に連絡してください' : '見つかりません'}
            </p>
          )}
        </main>
      </div>
    )
  }

  // 打刻画面
  const record = status?.record || null
  const state: 'not_started' | 'working' | 'on_break' | 'finished' =
    !record ? 'not_started'
      : record.status === 'closed' ? 'finished'
        : status?.on_break ? 'on_break' : 'working'

  if (done) {
    const meta = ACTION_DONE[done.action]
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className={`${meta.color} text-white flex-1 flex flex-col items-center justify-center px-6 text-center`}>
          <CheckCircle2 className="w-20 h-20" />
          <p className="mt-4 text-3xl font-bold">{meta.label}</p>
          <p className="mt-4 text-7xl font-mono font-bold tabular-nums">{done.time}</p>
          <p className="mt-5 flex items-center gap-1.5 text-xl font-semibold break-words">
            <MapPin className="w-5 h-5 shrink-0" />
            <span className="min-w-0">{done.storeName}</span>
          </p>
          <p className="mt-2 text-lg opacity-90 break-words">{done.userName}さん</p>
        </div>
        <div className="bg-white px-4 py-4">
          <button
            onClick={() => setDone(null)}
            className="w-full max-w-lg mx-auto block min-h-[52px] rounded-xl border border-gray-300 text-gray-700 font-semibold"
          >
            打刻画面に戻る
          </button>
        </div>
      </div>
    )
  }

  const bigButton = (action: QrClockAction, label: string, Icon: typeof Play, color: string) => (
    <button
      key={action}
      onClick={() => doPunch(action)}
      disabled={busy}
      className={`w-full min-h-[88px] rounded-2xl text-white text-2xl font-bold flex items-center justify-center gap-3 shadow-sm disabled:opacity-60 ${color}`}
    >
      {busy ? <Loader2 className="w-7 h-7 animate-spin" /> : <Icon className="w-7 h-7" />}
      {busy ? '打刻中…' : label}
    </button>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {header}
      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <UserRound className="w-5 h-5 text-gray-400 shrink-0" />
            <span className="text-lg font-bold text-gray-900 break-words min-w-0">{me?.name}さん</span>
          </div>
        </div>

        {/* 今日の予定。違う会場のQRなら注意を出す（打刻はそのままできる） */}
        {todayShifts.length > 0 && (() => {
          const here = todayShifts.some(t => !t.store_id || t.store_id === info?.store.id)
          const elsewhere = todayShifts.find(t => t.store_id && t.store_id !== info?.store.id)
          return (
            <div className="space-y-2">
              <div className="rounded-xl bg-white border border-gray-200 px-4 py-3">
                <p className="text-xs font-bold text-gray-500 flex items-center gap-1"><CalendarClock className="w-4 h-4" />今日の予定</p>
                {todayShifts.map((t, i) => (
                  <p key={i} className="text-lg font-bold text-gray-900 tabular-nums">
                    {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}
                    {t.store_name && <span className="ml-2 text-base">{t.store_name}</span>}
                  </p>
                ))}
              </div>
              {!here && elsewhere && (
                <div className="rounded-xl bg-amber-50 border-2 border-amber-300 px-4 py-3 flex gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-900">
                    今日は<span className="font-bold">{elsewhere.store_name}</span>の予定です。ここは<span className="font-bold">{venueName}</span>のQRです。<br />
                    ヘルプなどでこちらに入るなら、このまま打刻してください。
                  </p>
                </div>
              )}
            </div>
          )
        })()}

        <div className={`rounded-xl px-4 py-3 text-center text-base font-semibold ${
          state === 'not_started' ? 'bg-gray-100 text-gray-700' :
          state === 'working' ? 'bg-green-100 text-green-800' :
          state === 'on_break' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
        }`}>
          {state === 'not_started' ? 'まだ出勤していません' :
           state === 'working' ? '勤務中' :
           state === 'on_break' ? '休憩中' : '本日の勤務は終了しました'}
        </div>

        <div className="space-y-3">
          {state === 'not_started' && bigButton('clock-in', '出勤', Play, 'bg-green-600 active:bg-green-700')}
          {state === 'working' && (
            <>
              {bigButton('break-start', '休憩開始', Coffee, 'bg-yellow-500 active:bg-yellow-600')}
              {bigButton('clock-out', '退勤', Square, 'bg-red-600 active:bg-red-700')}
            </>
          )}
          {state === 'on_break' && bigButton('break-end', '休憩終了', Play, 'bg-blue-600 active:bg-blue-700')}
          {state === 'finished' && (
            <button
              onClick={() => doPunch('clock-in')}
              disabled={busy}
              className="w-full min-h-[48px] rounded-xl border border-gray-300 bg-white text-gray-700 text-sm font-semibold disabled:opacity-60"
            >
              もう一度出勤する
            </button>
          )}
        </div>

        {record && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-semibold text-gray-700 mb-2">今日の打刻</p>
            <ul className="space-y-1.5 text-sm text-gray-800">
              {record.clock_in && (
                <li className="flex justify-between gap-3">
                  <span>出勤</span>
                  <span className="font-mono">{record.clock_in}{record.store_name ? `（${record.store_name}）` : ''}</span>
                </li>
              )}
              {(status?.breaks || []).map((b, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>休憩{(status?.breaks.length || 0) > 1 ? i + 1 : ''}</span>
                  <span className="font-mono">{b.start_time}〜{b.end_time || '（休憩中）'}</span>
                </li>
              ))}
              {record.clock_out && (
                <li className="flex justify-between gap-3">
                  <span>退勤</span>
                  <span className="font-mono">{record.clock_out}{record.clock_out_store_name ? `（${record.clock_out_store_name}）` : ''}</span>
                </li>
              )}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-gray-400 text-center leading-relaxed">
          打刻のとき、不正防止のためスマホの位置情報を記録します（許可しなくても打刻できます）
        </p>
      </main>
    </div>
  )
}
