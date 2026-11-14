import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Calendar, Check, Plus, QrCode, FileSpreadsheet, Send, Eye, EyeOff, Users, MessageCircle } from 'lucide-react'
import { track } from '../lib/analytics'
import './landing.css'

/* シフトログ LP（2026-11-14 作り直し）
 *
 * 設計メモ
 * - 客の行動を一文にすると「店長が月に1回シフトを組み、スタッフに届け、毎日だれが来たかを見る」。
 *   なのでページの背骨は「1か月の流れ（集める→組む→届ける→打刻→締める）」にした。
 * - 一番の違いは「スタッフはいつもの LINE だけ」「人数で値段が上がらない」の2つ。ヒーローと料金で言い切る。
 * - 画面の見本は作り物にしない。LINE のカード・公開の帯・今日の状況の文言は、本物（backend/src/routes/line.ts・
 *   PublicationBar・TodayByVenue）からそのまま写した。数字の入った架空のダッシュボードは載せない。
 * - 料金比較の他社の数字は公式サイトで確認した日付を注記に書く（2026-11-14 確認）。
 * - 文字が1文字だけ次の行に落ちないよう、public/nobr.js を LP のときだけ動かす。
 */

const REGISTER = '/login?mode=register'

/* 見出しは「|」で区切った言葉のまとまりの間でしか改行しない（「こ／の5つで」のような切れ方を防ぐ） */
function Ph({ t }: { t: string }) {
  return <>{t.split('|').map((x, i) => <span key={i} className="ph">{x}</span>)}</>
}
const CONTACT = 'shibahara@ashilog.jp'

function Cta({ location, label = '無料で店舗をつくる', className = '' }: { location: string; label?: string; className?: string }) {
  return (
    <Link to={REGISTER} onClick={() => track('cta_click', { label, location })} className={`btn btn-main ${className}`}>
      {label}
      <ArrowRight className="w-4 h-4" />
    </Link>
  )
}

/* ---------- スクロールで出す ---------- */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.lp [data-reveal]'))
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('is-in')); return }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) } })
    }, { rootMargin: '0px 0px -8% 0px' })
    els.forEach(e => io.observe(e))
    return () => io.disconnect()
  }, [])
}

/* ---------- LP だけで読むもの（字体・改行の部品） ---------- */
function useLpAssets() {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.lp = '1'
    const added: HTMLElement[] = []
    if (!document.getElementById('lp-fonts')) {
      const pre = document.createElement('link'); pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com'; pre.crossOrigin = ''
      const link = document.createElement('link'); link.id = 'lp-fonts'; link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800&family=Noto+Sans+JP:wght@400;500;700&family=Zen+Kaku+Gothic+New:wght@700;900&display=swap'
      document.head.append(pre, link); added.push(pre, link)
    }
    if (!document.getElementById('lp-nobr')) {
      const s = document.createElement('script'); s.id = 'lp-nobr'; s.src = '/nobr.js'; s.defer = true
      document.body.appendChild(s)
    } else {
      ;(window as any).__nobrFix?.()
    }
    return () => { delete root.dataset.lp; added.forEach(e => e.remove()) }
  }, [])
}

/* ===================== ヒーローの LINE 画面 ===================== */
function LinePhone() {
  // 届く順: 募集のカード → 自分の返事 → （しばらくして）公開のカード
  const [typingGone, setTypingGone] = useState(false)
  useEffect(() => { const t = setTimeout(() => setTypingGone(true), 2600); return () => clearTimeout(t) }, [])
  return (
    <div className="phone mx-auto" aria-label="スタッフのLINEに届くお知らせの例">
      <div className="phone-screen">
        <div className="line-head">
          <span className="text-gray-400 text-base leading-none">‹</span>
          <span className="truncate">カフェさくら スタッフ連絡</span>
        </div>
        <div className="line-body">
          <div className="line-row arrive" style={{ animationDelay: '.5s' }}>
            <div className="line-avatar"><Calendar className="w-4 h-4 text-white" /></div>
            <div className="flex-card">
              <p className="h">【12月】シフトの希望を教えてください</p>
              <p className="s mt-1">期間 12/1〜12/31 ／ 締切 11/25</p>
              <div className="flex-btn" style={{ background: '#06C755' }}>希望を出す</div>
            </div>
            <span className="line-time">18:02</span>
          </div>
          <div className="line-row line-me arrive" style={{ animationDelay: '1.4s' }}>
            <span className="line-time">既読 18:10</span>
            <div className="bubble-me">出しました</div>
          </div>
          {!typingGone && <div className="line-row arrive" style={{ animationDelay: '1.9s' }}><div className="line-avatar" style={{ opacity: 0 }} /><span className="typing"><i /><i /><i /></span></div>}
          <div className="line-row arrive" style={{ animationDelay: '2.7s' }}>
            <div className="line-avatar"><Calendar className="w-4 h-4 text-white" /></div>
            <div className="flex-card">
              <p className="h">12月のシフトが公開されました</p>
              <p className="s mt-2">次の勤務</p>
              <p className="big num">12/3（水） 17:00–22:00</p>
              <p className="s mt-1.5">佐藤さん専用のボタンです。名前を選ばずに開けます。</p>
              <div className="flex-btn" style={{ background: '#1C7ED6' }}>12月のシフトを見る</div>
            </div>
            <span className="line-time">11/28</span>
          </div>
        </div>
        <div className="rich-menu"><img src="/guide-menu.png" alt="LINEのメニュー：シフトを見る・希望を出す・休みの連絡・打刻する" /></div>
      </div>
    </div>
  )
}

/* ===================== 1か月の流れ: 各段の画面 ===================== */
const DAYS = [1, 2, 3, 4, 5, 6, 7]
const DOW = ['月', '火', '水', '木', '金', '土', '日']

function ScreenCollect() {
  const marks: Record<number, string> = { 1: '◎', 2: '○', 3: '×', 4: '○', 5: '◎', 6: '◎', 7: '×' }
  return (
    <div className="sheet w-full max-w-[400px] p-5">
      <p className="text-xs text-[color:var(--faint)]">スタッフの画面</p>
      <p className="display text-lg mt-0.5">12月の希望を出す</p>
      <div className="flex gap-2 mt-3 text-xs font-bold">
        <span className="px-2.5 py-1 rounded-full bg-[color:var(--blue)] text-white">◎ 入りたい</span>
        <span className="px-2.5 py-1 rounded-full border border-[color:var(--rule)]">○ 入れる</span>
        <span className="px-2.5 py-1 rounded-full border border-[color:var(--rule)]">× 入れない</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5 mt-4 text-center">
        {DOW.map(d => <span key={d} className="text-[11px] text-[color:var(--faint)]">{d}</span>)}
        {DAYS.map(d => (
          <div key={d} className="rounded-lg border border-[color:var(--rule)] py-1.5">
            <p className="num text-[11px] text-[color:var(--sub)]">{d}</p>
            <p className={`text-base font-bold ${marks[d] === '×' ? 'text-[color:var(--red)]' : marks[d] === '◎' ? 'text-[color:var(--blue)]' : 'text-[color:var(--green)]'}`}>{marks[d]}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-[color:var(--sub)] mt-4">締切までは何度でも直せます。出した希望は、そのまま店長のシフト表に並びます。</p>
    </div>
  )
}

function ScreenBuild() {
  const rows = [
    { d: '12/3（水）', need: 3, names: ['佐藤', '田中', '鈴木'] },
    { d: '12/4（木）', need: 3, names: ['田中', '高橋'] },
    { d: '12/5（金）', need: 4, names: ['佐藤', '伊藤', '鈴木', '高橋'] },
  ]
  const colors = ['#2563eb', '#0f766e', '#7c3aed', '#c2410c', '#be185d']
  const cOf = (n: string) => colors[['佐藤', '田中', '鈴木', '高橋', '伊藤'].indexOf(n)]
  return (
    <div className="sheet w-full max-w-[420px] p-5">
      <p className="text-xs text-[color:var(--faint)]">店長の画面 ／ シフト自動作成</p>
      <p className="display text-lg mt-0.5">希望から、下書きができました</p>
      <div className="mt-4 space-y-2">
        {rows.map(r => (
          <div key={r.d} className="flex items-center gap-2 rounded-xl border border-[color:var(--rule)] px-3 py-2.5">
            <span className="num text-sm font-bold w-[5.6rem] shrink-0">{r.d}</span>
            <div className="flex flex-wrap gap-1 flex-1">
              {r.names.map(n => <span key={n} className="chip" style={{ background: cOf(n) }}>{n}</span>)}
              {r.names.length < r.need && <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}>あと{r.need - r.names.length}人</span>}
            </div>
            <span className="text-[11px] text-[color:var(--faint)] shrink-0">{r.names.length}/{r.need}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-[color:var(--sub)] mt-4">曜日ごとの必要人数を決めておくと、希望をもとに埋めます。直すのは気になるマスだけです。</p>
    </div>
  )
}

function ScreenPublish({ active }: { active: boolean }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!active) { setOn(false); return }
    const t = setTimeout(() => setOn(true), 1100)
    return () => clearTimeout(t)
  }, [active])
  return (
    <div className="sheet w-full max-w-[420px] p-5">
      <p className="text-xs text-[color:var(--faint)]">店長の画面 ／ シフト管理</p>
      <p className="display text-lg mt-0.5">12月のシフト</p>
      <div className={`pub mt-4 ${on ? 'onn' : 'off'}`}>
        {on ? <Eye className="w-4 h-4 mt-0.5 shrink-0 text-green-700" /> : <EyeOff className="w-5 h-5 shrink-0 text-amber-700" />}
        <div className="flex-1">
          {on ? (
            <p className="text-sm text-green-900"><b>12月のシフトは公開中。</b>スタッフの画面に表示されています。</p>
          ) : (
            <>
              <p className="text-sm font-bold text-amber-900">12月のシフト62件は、まだスタッフに見えていません</p>
              <p className="text-xs text-amber-800 mt-0.5">下書きの状態です。公開すると、スタッフに知らせます。</p>
              <span className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold"><Send className="w-3.5 h-3.5" />スタッフに公開する</span>
            </>
          )}
        </div>
      </div>
      <div className={`mt-3 rounded-xl px-3 py-2.5 text-xs font-bold flex items-center gap-2 transition-opacity duration-500 ${on ? 'opacity-100' : 'opacity-0'}`} style={{ background: '#16181d', color: '#fff' }}>
        <Check className="w-4 h-4 text-green-400 shrink-0" />12月のシフトをスタッフに公開しました。LINEで知らせます
      </div>
      <p className="text-xs text-[color:var(--sub)] mt-4">公開すると、つながっているスタッフ全員のLINEに「シフトが公開されました」が届きます。公開したあとの変更も、確かめてからまとめて知らせられます。</p>
    </div>
  )
}

function ScreenClock() {
  const rows = [
    { n: '佐藤', t: '17:00–22:00', label: '勤務中 17:02〜', cls: 'bg-green-100 text-green-800' },
    { n: '鈴木', t: '16:00–22:00', label: '休憩中', cls: 'bg-amber-100 text-amber-800' },
    { n: '田中', t: '17:00–21:00', label: 'まだ来ていない（12分）', cls: 'bg-red-100 text-red-700' },
    { n: '高橋', t: '18:00–23:00', label: '出勤前', cls: 'bg-blue-50 text-blue-700' },
  ]
  return (
    <div className="sheet w-full max-w-[420px] overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-[color:var(--rule)]">
        <p className="display text-base">今日の店舗</p>
        <span className="num text-sm text-[color:var(--sub)]">12/3（水）</span>
        <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white whitespace-nowrap">まだ来ていない 1人</span>
      </div>
      <div className="divide-y divide-[color:var(--rule)]">
        {rows.map(r => (
          <div key={r.n} className="flex items-center gap-3 px-5 py-2.5">
            <span className="text-sm font-bold w-10 shrink-0">{r.n}</span>
            <span className="num text-xs text-[color:var(--sub)] whitespace-nowrap">{r.t}</span>
            <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${r.cls}`}>{r.label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 px-5 py-3 bg-[color:var(--paper)]">
        <QrCode className="w-8 h-8 text-[color:var(--ink)] shrink-0" />
        <p className="text-xs text-[color:var(--sub)]">打刻は、店に貼ったQRをスタッフが自分のスマホで読むだけ。1分ごとに更新されます。</p>
      </div>
    </div>
  )
}

function ScreenClose() {
  const rows = [['佐藤', '96.5', '106,150'], ['田中', '124.0', '136,400'], ['鈴木', '88.0', '96,800']]
  return (
    <div className="sheet w-full max-w-[420px] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--rule)]">
        <p className="display text-base">11月の勤務集計</p>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[color:var(--blue)] text-white"><FileSpreadsheet className="w-3.5 h-3.5" />CSV</span>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-[11px] text-[color:var(--faint)]"><th className="text-left font-medium px-5 py-2">スタッフ</th><th className="text-right font-medium px-3 py-2">勤務時間</th><th className="text-right font-medium px-5 py-2">概算給与</th></tr></thead>
        <tbody>
          {rows.map(([n, h, p]) => (
            <tr key={n} className="border-t border-[color:var(--rule)]"><td className="px-5 py-2 font-bold">{n}</td><td className="num text-right px-3 py-2">{h}h</td><td className="num text-right px-5 py-2 font-bold">¥{p}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="px-5 py-3 bg-[color:var(--paper)] flex flex-wrap gap-1.5">
        {['freee 人事労務', 'マネーフォワード', 'KING OF TIME'].map(f => <span key={f} className="text-[11px] px-2 py-1 rounded-md bg-white border border-[color:var(--rule)] text-[color:var(--sub)]">{f} の形で出力</span>)}
      </div>
    </div>
  )
}

const STEPS = [
  { no: '01', name: '集める', title: '希望は、|LINEに1回送るだけで|集まります。', body: '期間と締切を決めて「募集」を送ると、スタッフのLINEに「希望を出す」ボタンが届きます。スタッフは日付に ◎ ○ × を付けるだけ。出してくれない人には、選んで催促を送れます。' },
  { no: '02', name: '組む', title: '下書きは、|希望から|自動でできます。', body: '曜日ごとに必要な人数を決めておけば、出た希望で埋めた下書きを作ります。足りない日は「あと1人」と出るので、そこだけ考えれば済みます。' },
  { no: '03', name: '届ける', title: '公開した瞬間、|全員のLINEに|届きます。', body: '「シフト出ましたか」と聞かれることがなくなります。公開していない月は画面の上に琥珀色の帯で出るので、出し忘れもしません。公開後の変更は、確かめてからまとめて本人に知らせます。' },
  { no: '04', name: '打刻する', title: '店にいなくても、|今日だれが来たか|分かります。', body: '店に貼ったQRを、スタッフが自分のスマホで読んで打刻します。店長のスマホには、勤務中・休憩中・まだ来ていない人が並びます。' },
  { no: '05', name: '締める', title: '月末の集計は、|もう電卓を|出しません。', body: '打刻から勤務時間と概算給与を出します。freee 人事労務・マネーフォワード・KING OF TIME の形でCSVにして、給与ソフトに読み込めます（CSVと過去月の集計は Pro）。' },
]

function MonthFlow() {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i)) })
    }, { rootMargin: '-45% 0px -45% 0px' })
    refs.current.forEach(el => el && io.observe(el))
    return () => io.disconnect()
  }, [])
  const screens = [<ScreenCollect key="c" />, <ScreenBuild key="b" />, <ScreenPublish key="p" active={active === 2} />, <ScreenClock key="k" />, <ScreenClose key="z" />]
  return (
    <div className="grid lg:grid-cols-[1fr_1.05fr] gap-10 lg:gap-16">
      {/* 左: 画面（PCでは追従して切り替わる） */}
      <div className="hidden lg:block">
        <div className="sticky top-24 h-[calc(100vh-8rem)] max-h-[640px] min-h-[520px] rounded-[28px] grid-paper bg-[color:var(--paper-2)] border border-[color:var(--rule)] relative">
          {screens.map((s, i) => <div key={i} className={`stage-item px-8 ${active === i ? 'on' : ''}`}>{s}</div>)}
          <div className="absolute left-6 bottom-6 flex items-center gap-2">
            {STEPS.map((s, i) => <span key={s.no} className={`rail-dot ${active === i ? 'on' : ''}`} />)}
            <span className="ml-2 text-xs font-bold text-[color:var(--sub)]">{STEPS[active].no} {STEPS[active].name}</span>
          </div>
        </div>
      </div>
      {/* 右: 説明（スマホでは各段のすぐ下に画面） */}
      <div>
        {STEPS.map((s, i) => (
          <article
            key={s.no}
            data-i={i}
            ref={el => { refs.current[i] = el }}
            className={`step lg:min-h-[78vh] flex flex-col justify-center py-10 lg:py-0 border-t border-[color:var(--rule)] first:border-t-0 ${active === i ? 'on' : ''}`}
          >
            <p className="flex items-baseline gap-3">
              <span className="num text-[2.6rem] leading-none font-extrabold text-[color:var(--blue)]">{s.no}</span>
              <span className="display text-lg">{s.name}</span>
            </p>
            <h3 className="text-[1.45rem] sm:text-[1.7rem] font-black leading-snug mt-4"><Ph t={s.title} /></h3>
            <p className="text-[15px] text-[color:var(--sub)] mt-4 max-w-[34rem]">{s.body}</p>
            <div className="lg:hidden mt-7 rounded-[22px] grid-paper bg-[color:var(--paper-2)] border border-[color:var(--rule)] p-4 sm:p-6 flex justify-center">
              {screens[i]}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

/* ===================== 料金 ===================== */
const ROWS = [
  { n: 3, air: 990, log: 0 },
  { n: 5, air: 1650, log: 0 },
  { n: 10, air: 3300, log: 980 },
  { n: 20, air: 6600, log: 980 },
  { n: 30, air: 9900, log: 980 },
]
const yen = (v: number) => (v === 0 ? '0円' : `${v.toLocaleString()}円`)

const FAQS = [
  { q: 'お店のLINE公式アカウントがなくても使えますか。', a: '使えます。スタッフはスマホのブラウザで、シフトの確認・希望の提出・打刻ができます。LINEに届くようにするには、お店のLINE公式アカウント（無料で作れます）とつなぎます。つなぐ作業は、こちらで手伝います。' },
  { q: 'スタッフにアプリを入れてもらう必要はありますか。', a: 'ありません。LINEにつないだお店なら、スタッフはいつものLINEのメニューから使います。つないでいない場合も、送られたリンクやQRをスマホで開くだけです。' },
  { q: '無料期間が終わると、どうなりますか。', a: '自動でFreeプランに戻ります。登録したスタッフ・シフト・打刻はそのまま残り、請求もありません。登録にクレジットカードは使わないので、勝手に課金されることはありません。' },
  { q: 'Freeプランでは何ができませんか。', a: '6人目からのスタッフ登録、過去の月の集計、CSV出力の3つです。打刻・シフト作成と公開・LINEでのお知らせ・希望の受付・シフト自動作成は、Freeでも使えます。' },
  { q: 'いま別のシフト管理を使っています。移れますか。', a: '移れます。スタッフの名前の一覧（写真やメモで大丈夫です）を送ってもらえれば、店舗とスタッフの登録はこちらで済ませます。料金はかかりません。過去の打刻の移し替えは、内容を見て相談させてください。' },
  { q: '2店舗以上あります。', a: '2店舗目からは、1店舗につき月980円です。店舗ごとにシフトと打刻を分けて見られます。' },
  { q: '解約はすぐできますか。', a: '設定からいつでも解約できます。支払い済みの期間の終わりまで使え、そのあとはFreeプランに戻ります。データは消えません。' },
  { q: '個人で作っているサービスですよね。急に終わりませんか。', a: '作った本人が、自分の職場で毎日使っています。止める予定はありません。困ったことはメールで、作った本人が直接お返事します。' },
]

/* ===================== 本体 ===================== */
export default function LandingPage() {
  useLpAssets()
  useReveal()
  return (
    <div className="lp min-h-screen">
      {/* ヘッダー */}
      <header className="sticky top-0 z-30 backdrop-blur lp-head border-b border-[color:var(--rule)]">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <span className="w-8 h-8 bg-[color:var(--blue)] rounded-lg grid place-items-center"><Calendar className="w-[18px] h-[18px] text-white" /></span>
            <span className="display text-[1.05rem] font-black">シフトログ</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-[color:var(--sub)]">
            <a href="#flow" className="hover:text-[color:var(--ink)]">使い方</a>
            <a href="#price" className="hover:text-[color:var(--ink)]">料金</a>
            <a href="#faq" className="hover:text-[color:var(--ink)]">よくある質問</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/login" onClick={() => track('cta_click', { label: 'ログイン', location: 'header' })} className="text-sm font-bold px-3 py-2 whitespace-nowrap text-[color:var(--sub)] hover:text-[color:var(--ink)]">ログイン</Link>
            <span className="hidden sm:inline"><Link to={REGISTER} onClick={() => track('cta_click', { label: '無料で始める', location: 'header' })} className="btn btn-main !py-2 !px-4 text-sm">無料で始める</Link></span>
          </div>
        </div>
      </header>

      {/* 1. ヒーロー: 何か・何が得られるか */}
      <section className="relative grid-paper">
        <div className="max-w-6xl mx-auto px-5 pt-14 pb-16 sm:pt-20 sm:pb-24 grid lg:grid-cols-[1.15fr_1fr] gap-12 lg:gap-8 items-center">
          <div>
            <p className="kicker hero-in">小さなお店のシフト管理</p>
            <h1 className="hero-in mt-5 text-[2.35rem] leading-[1.25] sm:text-[3.4rem] sm:leading-[1.18] font-black" style={{ animationDelay: '0.13s' }}>
              <Ph t="シフトの連絡は、" /><br /><Ph t="ぜんぶLINEで。" />
            </h1>
            <p className="hero-in mt-6 text-base sm:text-[17px] text-[color:var(--sub)] max-w-[34rem]" style={{ animationDelay: '0.21s' }}>
              希望の受付も、シフトの公開も、休みの連絡と代わりの募集も。スタッフはいつものLINEで受け取り、アプリを入れる必要はありません。
            </p>
            <p className="hero-in mt-5 display text-lg sm:text-xl" style={{ animationDelay: '0.21s' }}>
              <Ph t="スタッフ5人まで、|ずっと無料。" /><br className="sm:hidden" /><Ph t="何人いても|月980円。" />
            </p>
            <div className="hero-in mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: '0.29s' }}>
              <Cta location="hero" />
              <a href="#flow" className="btn btn-sub">使い方を見る</a>
            </div>
            <p className="hero-in mt-4 text-xs text-[color:var(--faint)]" style={{ animationDelay: '0.29s' }}>クレジットカード不要。登録した日から30日間、すべての機能を無料で使えます。</p>
          </div>
          <div className="relative">
            <LinePhone />
          </div>
        </div>
        <div className="ruler max-w-6xl mx-auto" />
      </section>

      {/* 2. 何が消えるか（今のやり方との違い） */}
      <section className="py-20 sm:py-28">
        <div className="max-w-5xl mx-auto px-5">
          <p className="kicker" data-reveal>店長の手間</p>
          <h2 className="mt-4 text-[1.8rem] sm:text-[2.4rem] font-black leading-snug" data-reveal><Ph t="店長の夜の仕事が、|3つ消えます。" /></h2>
          <div className="mt-12 sheet divide-y divide-[color:var(--rule)]" data-reveal="mask">
            {[
              { before: 'LINEで1人ずつ希望を聞いて、紙に写す', after: '期間を決めて「募集」を1回送るだけ。出た希望はシフト表に並びます。', icon: MessageCircle },
              { before: '「シフト出ましたか」と何度も聞かれる', after: '公開した瞬間に、全員のLINEに届きます。', icon: Send },
              { before: '「明日休みます」から、代わりを探して電話する', after: '休みの連絡も代わりの募集もLINEの中で。手を挙げた人を選ぶだけです。', icon: Users },
            ].map(r => {
              const Icon = r.icon
              return (
                <div key={r.before} className="grid sm:grid-cols-[1fr_auto_1.25fr] gap-3 sm:gap-6 items-center px-6 sm:px-8 py-6">
                  <p className="text-[15px] text-[color:var(--faint)] line-through decoration-[1.5px]">{r.before}</p>
                  <ArrowRight className="hidden sm:block w-5 h-5 text-[color:var(--blue)]" />
                  <p className="flex gap-3 items-start text-[15px] font-bold"><Icon className="w-5 h-5 mt-1 shrink-0 text-[color:var(--blue)]" /><span>{r.after}</span></p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* 3. 1か月の流れ（体験） */}
      <section id="flow" className="py-20 sm:py-24 bg-white border-y border-[color:var(--rule)] scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5">
          <p className="kicker" data-reveal>使い方</p>
          <h2 className="mt-4 text-[1.8rem] sm:text-[2.4rem] font-black leading-snug" data-reveal><Ph t="1か月のシフトは、|この5つで|回ります。" /></h2>
          <p className="mt-4 text-[15px] text-[color:var(--sub)] max-w-2xl" data-reveal>画面の見本は、実際のシフトログの画面とLINEのお知らせから写しています。</p>
          <div className="mt-12 lg:mt-4"><MonthFlow /></div>
        </div>
      </section>

      {/* 4. 料金（今見る理由） */}
      <section id="price" className="py-20 sm:py-28 scroll-mt-16">
        <div className="max-w-5xl mx-auto px-5">
          <p className="kicker" data-reveal>料金</p>
          <h2 className="mt-4 text-[1.8rem] sm:text-[2.4rem] font-black leading-snug" data-reveal><Ph t="人数で、|値段は|上がりません。" /></h2>
          <p className="mt-4 text-[15px] text-[color:var(--sub)] max-w-2xl" data-reveal>スタッフ1人ごとにかかるシフト管理と、月の料金をくらべました。</p>

          <div className="mt-10 sheet overflow-hidden" data-reveal="mask">
            <div className="overflow-x-auto">
              <table className="cmp w-full text-[15px] min-w-[300px]">
                <thead>
                  <tr className="text-xs text-[color:var(--sub)] bg-[color:var(--paper)]">
                    <th className="text-left font-bold">スタッフ</th>
                    <th className="text-right font-bold">人数ごとの料金<span className="hidden sm:inline">（Airシフトの場合）</span></th>
                    <th className="text-right font-bold text-[color:var(--blue)]">シフトログ</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(r => (
                    <tr key={r.n} className="border-t border-[color:var(--rule)]">
                      <td className="num font-bold whitespace-nowrap">{r.n}人</td>
                      <td className="num text-right text-[color:var(--sub)] whitespace-nowrap">月 {yen(r.air)}</td>
                      <td className="num text-right font-extrabold text-[color:var(--blue)] whitespace-nowrap">月 {yen(r.log)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-4 text-[15px] font-bold" data-reveal>スタッフ10人のお店なら、1年で <span className="num text-[color:var(--blue)]">27,840円</span> の差になります。</p>
          <p className="mt-2 text-xs text-[color:var(--faint)] leading-relaxed" data-reveal>
            ※Airシフトの料金は、公式サイトの「無料体験期間のあと、スタッフ1人あたり月額330円（税込）。2人以下は一律月額990円」（2026年11月14日に確認）をもとに計算しました。対象はスタッフ用アプリと連携しているスタッフです。最新の料金は各社の公式サイトでご確認ください。
          </p>

          <div className="mt-14 grid md:grid-cols-2 gap-5">
            <div className="sheet p-7 sm:p-8" data-reveal>
              <p className="display text-lg">Free</p>
              <p className="mt-2"><span className="num text-[2.6rem] font-extrabold">0</span><span className="text-sm text-[color:var(--sub)] ml-1">円 ／ ずっと</span></p>
              <p className="text-sm text-[color:var(--sub)]">1店舗・スタッフ5人まで</p>
              <ul className="mt-6 space-y-2.5 text-[14px]">
                {['スマホとQRで打刻', 'シフトの作成と公開', 'LINEでのお知らせ・希望の受付', 'シフト自動作成・期間で希望を募集', '休みの連絡と代わりの募集', '今月の勤務集計'].map(t => (
                  <li key={t} className="flex gap-2.5"><Check className="w-4 h-4 mt-1 shrink-0 text-[color:var(--green)]" /><span>{t}</span></li>
                ))}
              </ul>
            </div>
            <div className="sheet p-7 sm:p-8 relative !border-2 !border-[color:var(--blue)]" data-reveal data-delay="1">
              <span className="absolute -top-3 left-7 text-xs font-bold px-3 py-1 rounded-full bg-[color:var(--blue)] text-white">はじめの30日は無料</span>
              <p className="display text-lg">Pro</p>
              <p className="mt-2"><span className="num text-[2.6rem] font-extrabold">980</span><span className="text-sm text-[color:var(--sub)] ml-1">円 ／ 月（税込）</span></p>
              <p className="text-sm text-[color:var(--sub)]">年払いなら <span className="num font-bold text-[color:var(--ink)]">9,800</span>円（2か月分お得）</p>
              <ul className="mt-6 space-y-2.5 text-[14px]">
                {['Freeでできることすべて', 'スタッフの人数は無制限', '過去の月の勤務集計', '勤怠・シフトのCSV出力', 'freee 人事労務・マネーフォワード・KING OF TIME の形で出力', '2店舗目からは1店舗につき月980円'].map(t => (
                  <li key={t} className="flex gap-2.5"><Check className="w-4 h-4 mt-1 shrink-0 text-[color:var(--blue)]" /><span>{t}</span></li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-6 text-sm text-[color:var(--sub)]" data-reveal>30日のお試しが終わると、自動でFreeに戻ります。データは消えず、請求も起きません。</p>
        </div>
      </section>

      {/* 5. 作った人（信じられる理由） */}
      <section className="py-20 sm:py-28 bg-[color:var(--ink)] text-white">
        <div className="max-w-5xl mx-auto px-5 grid md:grid-cols-[1fr_1.4fr] gap-10 items-start">
          <div data-reveal>
            <p className="kicker" style={{ color: '#93b4ff' }}>作った人</p>
            <h2 className="mt-4 text-[1.8rem] sm:text-[2.3rem] font-black leading-snug"><Ph t="作ったのは、|シフトを組む側の|人間です。" /></h2>
          </div>
          <div className="space-y-5 text-[15px] text-white/80" data-reveal data-delay="1">
            <p>熊本で、飲食店のマネージャーをしています。毎月のシフトを組み、LINEで希望を集め、月末に電卓をたたく。その手間を自分の職場から消すために作ったのが、シフトログです。</p>
            <p>今も毎日、自分の職場で使っています。この冬は、いくつもの会場に出す催事のシフトも、これで組んでいます。現場で困るところは、自分が一番先に気づいて直します。</p>
            <p>「ここが分かりにくい」「こうしてほしい」は、作った本人がそのまま受け取ります。</p>
            <p className="display text-white text-lg pt-2">芝原 朋弥</p>
          </div>
        </div>
      </section>

      {/* 6. はじめ方（次にすること） */}
      <section className="py-20 sm:py-28">
        <div className="max-w-5xl mx-auto px-5">
          <p className="kicker" data-reveal>はじめ方</p>
          <h2 className="mt-4 text-[1.8rem] sm:text-[2.4rem] font-black leading-snug" data-reveal><Ph t="今日の10分で、|ここまで|終わります。" /></h2>
          <ol className="mt-12 grid md:grid-cols-3 gap-5">
            {[
              { t: 'お店の名前とメールで登録', d: '入れた名前で、店舗がすぐにできます。クレジットカードは使いません。' },
              { t: 'スタッフの名前を入れる', d: '名前だけで大丈夫です。あとから何人でも足せます。' },
              { t: 'シフトを入れて、公開する', d: '公開すると、スタッフの画面とLINEに届きます。スタッフには招待のQRを見せるだけです。' },
            ].map((s, i) => (
              <li key={s.t} className="sheet p-7" data-reveal data-delay={String(i)}>
                <span className="num text-sm font-extrabold text-[color:var(--blue)]">STEP {i + 1}</span>
                <p className="display text-lg mt-2 leading-snug">{s.t}</p>
                <p className="text-sm text-[color:var(--sub)] mt-3">{s.d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-2xl border border-dashed border-[color:var(--blue)] bg-[color:var(--blue-soft)] px-6 py-5 flex flex-col sm:flex-row gap-4 sm:items-center" data-reveal>
            <Plus className="w-6 h-6 text-[color:var(--blue)] shrink-0" />
            <p className="text-[15px] flex-1"><b>手が回らないときは、こちらで登録します。</b>スタッフの名前の一覧を送ってもらえれば、店舗とスタッフの登録まで済ませます。料金はかかりません。</p>
            <a href={`mailto:${CONTACT}?subject=${encodeURIComponent('シフトログの登録をお願いしたい')}`} onClick={() => track('cta_click', { label: '登録代行メール', location: 'setup' })} className="btn btn-sub text-sm shrink-0" style={{ background: '#fff' }}>メールで頼む</a>
          </div>
        </div>
      </section>

      {/* 7. よくある質問 */}
      <section id="faq" className="py-20 sm:py-24 bg-white border-y border-[color:var(--rule)] scroll-mt-16">
        <div className="max-w-3xl mx-auto px-5">
          <p className="kicker" data-reveal>よくある質問</p>
          <h2 className="mt-4 text-[1.8rem] sm:text-[2.2rem] font-black leading-snug" data-reveal><Ph t="はじめる前に、|よく聞かれること" /></h2>
          <div className="mt-10 divide-y divide-[color:var(--rule)] border-y border-[color:var(--rule)]">
            {FAQS.map(f => (
              <details key={f.q} className="py-1">
                <summary className="flex items-center gap-4 py-4 font-bold text-[15px]">
                  <span className="flex-1">{f.q}</span>
                  <Plus className="plus w-5 h-5 text-[color:var(--blue)] shrink-0" />
                </summary>
                <p className="pb-5 pr-9 text-[14.5px] text-[color:var(--sub)]">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-8 text-sm text-[color:var(--sub)]">ほかに聞きたいことは <a href={`mailto:${CONTACT}`} className="text-[color:var(--blue)] font-bold underline underline-offset-4">{CONTACT}</a> へ。作った本人がお返事します。</p>
        </div>
      </section>

      {/* 8. 最後の一押し */}
      <section className="py-24 sm:py-32 grid-paper text-center">
        <div className="max-w-3xl mx-auto px-5">
          <h2 className="text-[2rem] sm:text-[2.8rem] font-black leading-tight" data-reveal><Ph t="来月のシフトから、|LINEで。" /></h2>
          <p className="mt-5 text-[15px] text-[color:var(--sub)]" data-reveal>登録は3分。合わなければ、Freeのまま使い続けられます。</p>
          <div className="mt-9" data-reveal><Cta location="bottom" className="!px-9 !py-4 text-base" /></div>
          <p className="mt-4 text-xs text-[color:var(--faint)]">クレジットカード不要・30日間すべての機能を無料で</p>
        </div>
      </section>

      {/* フッター */}
      <footer className="border-t border-[color:var(--rule)] py-10">
        <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row gap-5 sm:items-center justify-between text-sm text-[color:var(--sub)]">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 bg-[color:var(--blue)] rounded-md grid place-items-center"><Calendar className="w-3.5 h-3.5 text-white" /></span>
            <span>© シフトログ　運営 芝原 朋弥</span>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/legal/tokusho" className="hover:text-[color:var(--ink)]">特定商取引法に基づく表記</Link>
            <Link to="/legal/terms" className="hover:text-[color:var(--ink)]">利用規約</Link>
            <Link to="/legal/privacy" className="hover:text-[color:var(--ink)]">プライバシーポリシー</Link>
            <Link to="/login" onClick={() => track('cta_click', { label: 'ログイン', location: 'footer' })} className="hover:text-[color:var(--ink)]">ログイン</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
