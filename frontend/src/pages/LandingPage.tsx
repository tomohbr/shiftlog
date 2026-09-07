import { track } from '../lib/analytics'
import { Link } from 'react-router-dom'
import {
  Calendar,
  Clock,
  BarChart2,
  FileSpreadsheet,
  MessageCircle,
  Sparkles,
  Check,
  ArrowRight,
  X,
  Coffee,
} from 'lucide-react'

/* ---------- 製品モックアップ（CSSで実画面を再現） ---------- */

function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[270px] sm:w-[290px]">
      <div className="rounded-[2.2rem] bg-gray-900 p-2.5 shadow-2xl shadow-blue-900/40">
        <div className="rounded-[1.8rem] bg-gray-50 overflow-hidden">
          {/* status bar */}
          <div className="h-7 bg-white flex items-center justify-between px-5">
            <span className="text-[10px] font-semibold text-gray-800">9:41</span>
            <div className="flex gap-1">
              <div className="w-3.5 h-2 rounded-sm bg-gray-800" />
              <div className="w-2 h-2 rounded-full bg-gray-300" />
            </div>
          </div>
          {/* app header */}
          <div className="bg-white px-4 pb-3 border-b border-gray-100 flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
              <Calendar className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-gray-900">タイムカード</span>
          </div>
          {/* clock */}
          <div className="bg-white px-4 py-4 text-center">
            <p className="text-[10px] text-gray-400">7月3日（金）</p>
            <p className="text-3xl font-bold text-gray-900 tracking-tight">18:24</p>
          </div>
          {/* staff rows */}
          <div className="px-3 pb-3 space-y-1.5">
            {[
              { name: '佐藤', color: '#4A90E2', status: '勤務中', dot: 'bg-green-400', time: '17:00〜' },
              { name: '田中', color: '#E24A6F', status: '休憩中', dot: 'bg-yellow-400', time: '11:00〜' },
              { name: '鈴木', color: '#50B86C', status: '退勤済', dot: 'bg-blue-400', time: '9:00-15:00' },
            ].map(s => (
              <div key={s.name} className="bg-white rounded-xl px-3 py-2.5 flex items-center gap-2.5 shadow-sm">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ backgroundColor: s.color }}
                >
                  {s.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900">{s.name}</p>
                  <div className="flex items-center gap-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    <span className="text-[10px] text-gray-500">{s.status}・{s.time}</span>
                  </div>
                </div>
              </div>
            ))}
            {/* punch buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1.5">
              <div className="bg-blue-600 text-white text-center text-xs font-bold rounded-xl py-3">出勤</div>
              <div className="bg-white text-gray-700 border border-gray-200 text-center text-xs font-bold rounded-xl py-3">退勤</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DashboardMockup() {
  return (
    <div className="rounded-2xl bg-white shadow-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">今日の店舗状況</p>
        <p className="text-xs text-gray-400">7月3日（金）</p>
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-100">
        {[
          { label: '出勤中', value: '3人', color: 'text-green-600' },
          { label: '本日のシフト', value: '7件', color: 'text-blue-600' },
          { label: '今月の人件費', value: '¥312,400', color: 'text-gray-900' },
        ].map(c => (
          <div key={c.label} className="px-4 py-4 text-center">
            <p className="text-[11px] text-gray-400 mb-1">{c.label}</p>
            <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>
      <div className="px-5 py-3 bg-gray-50 space-y-2">
        {[
          { name: '佐藤', shift: '17:00 - 23:00', tag: 'ホール', color: '#4A90E2' },
          { name: '田中', shift: '11:00 - 20:00', tag: 'キッチン', color: '#E24A6F' },
        ].map(r => (
          <div key={r.name} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-gray-100">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold"
              style={{ backgroundColor: r.color }}
            >
              {r.name.charAt(0)}
            </div>
            <span className="text-xs font-medium text-gray-800">{r.name}</span>
            <span className="text-xs text-gray-500 ml-auto">{r.shift}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">{r.tag}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReportMockup() {
  return (
    <div className="rounded-2xl bg-white shadow-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">6月の勤務集計</p>
        <div className="flex items-center gap-1.5 bg-blue-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg">
          <FileSpreadsheet className="w-3 h-3" />
          CSV出力
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 border-b border-gray-100">
            <th className="text-left font-medium px-5 py-2.5">スタッフ</th>
            <th className="text-right font-medium px-3 py-2.5">勤務時間</th>
            <th className="text-right font-medium px-5 py-2.5">概算給与</th>
          </tr>
        </thead>
        <tbody className="text-gray-700">
          {[
            { name: '佐藤', h: '96.5h', pay: '¥106,150' },
            { name: '田中', h: '124.0h', pay: '¥136,400' },
            { name: '鈴木', h: '88.0h', pay: '¥96,800' },
          ].map(r => (
            <tr key={r.name} className="border-b border-gray-50">
              <td className="px-5 py-2.5 font-medium">{r.name}</td>
              <td className="px-3 py-2.5 text-right">{r.h}</td>
              <td className="px-5 py-2.5 text-right font-semibold">{r.pay}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-5 py-2.5 bg-gray-50 flex gap-2">
        {['freee', 'マネーフォワード', 'KING OF TIME'].map(f => (
          <span key={f} className="text-[10px] px-2 py-1 rounded-md bg-white border border-gray-200 text-gray-500">{f}</span>
        ))}
      </div>
    </div>
  )
}

/* ---------- LP本体 ---------- */

const PAINS = [
  {
    icon: Coffee,
    title: '紙のシフト表、まだ書いてますか',
    desc: '希望回収はLINE、清書は紙、変更のたびに書き直し。シフトを組むだけで毎週数時間が消えていく。',
  },
  {
    icon: Clock,
    title: '「今日誰が来るんだっけ」',
    desc: '店にいないと出勤状況がわからない。休憩に入ったのか、まだ来ていないのか、電話で確認する日々。',
  },
  {
    icon: BarChart2,
    title: '月末の集計が憂鬱',
    desc: 'タイムカードを1枚ずつ電卓で集計して給与計算へ。締め日のたびに深夜作業になっていませんか。',
  },
]

const FREE_ITEMS = ['出退勤打刻（スマホ / 店舗タブレット）', 'シフト作成・希望収集', '当月の勤務集計・人件費', 'スタッフ5名まで', 'LINE通知・シフト自動生成']
const PRO_ITEMS = ['Freeの全機能', '過去月の集計・履歴', '勤怠・シフトのCSV出力', '給与ソフト連携（freee / マネフォ / KOT）', 'スタッフ無制限', '年払いなら ¥9,800/年（2ヶ月分お得）', '追加店舗（+¥980/店舗）']

const FAQS = [
  {
    q: 'Airシフトのデータはそのまま移せますか？',
    a: 'スタッフ情報・店舗設定はこちらで無料で移行代行します。過去の打刻履歴の移行は内容によりますので、メール（shibahara.724@gmail.com）でご相談ください。',
  },
  {
    q: 'なぜこんなに安いのですか？',
    a: '個人開発で、広告費も営業部隊もかけていないためです。作者自身が飲食店の現場で毎日使うために作ったツールを、そのまま提供しています。',
  },
  {
    q: '個人開発で、急にサービスが終わったりしませんか？',
    a: '作者自身の店舗運営に必須のツールとして毎日稼働しています。万一の際もCSVで全データをお手元に出力できます（Pro機能）。',
  },
  {
    q: 'スタッフへの説明が面倒なのですが。',
    a: 'スタッフはアプリのインストール不要で、スマホでURLを開いてPINコードを入力するだけです。導入時にそのまま使える「スタッフ向け案内文」もお渡しします。',
  },
  {
    q: '無料期間が終わるとデータは消えますか？',
    a: '消えません。トライアル終了後は自動的にFreeプランに切り替わり、登録したスタッフ・シフト・打刻データはすべてそのまま使えます。',
  },
  {
    q: '登録にクレジットカードは必要ですか？',
    a: '不要です。メールアドレスだけで登録でき、30日間Proの全機能を無料でお試しいただけます。',
  },
  {
    q: 'スタッフ側の設定は大変ですか？',
    a: 'スタッフはアプリのインストール不要。マネージャーから共有されるPINコードを入力するだけで、自分のスマホから打刻とシフト確認ができます。',
  },
  {
    q: '解約はすぐできますか？',
    a: 'はい。設定ページからいつでも解約でき、請求期間の終了まで利用できます。解約後もFreeプランとしてデータは残ります。',
  },
]

// CTAの表示位置を付けてクリックを計測する。
function CTAButton({ large = false, label = '無料で乗り換える', location }: { large?: boolean; label?: string; location: string }) {
  return (
    <Link
      to="/login?mode=register"
      onClick={() => track('cta_click', { label, location })}
      className={`inline-flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 transition-colors shadow-lg shadow-blue-600/30 ${
        large ? 'px-9 py-4 text-base' : 'px-6 py-3 text-sm'
      }`}
    >
      {label}
      <ArrowRight className="w-4 h-4" />
    </Link>
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="absolute top-0 inset-x-0 z-10">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-white">シフトログ</span>
          </div>
          <Link
            to="/login"
            onClick={() => track('cta_click', { label: 'ログイン', location: 'header' })}
            className="px-4 py-2 text-sm font-medium text-white/90 hover:text-white border border-white/25 rounded-lg hover:bg-white/10 transition-colors"
          >
            ログイン
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 overflow-hidden">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-20 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl" />
        <div className="relative max-w-6xl mx-auto px-5 pt-28 pb-16 sm:pt-36 sm:pb-24 grid lg:grid-cols-2 gap-12 items-center">
          <div className="text-center lg:text-left">
            <p className="inline-block px-3 py-1 rounded-full bg-blue-500/15 border border-blue-400/30 text-blue-200 text-xs font-medium mb-6">
              現役の飲食店マネージャーが、自分の店のために作りました
            </p>
            <h1 className="text-[clamp(1.4rem,6.5vw,3rem)] sm:text-5xl font-bold text-white leading-[1.3] sm:leading-[1.25] mb-6">
              Airシフトが有料になって、
              <br />
              困っていませんか？
            </h1>
            <p className="text-base sm:text-lg text-slate-300 leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0">
              シフトログなら<span className="text-blue-400 font-bold">10分</span>で乗り換えできます。
              1店舗・スタッフ5名までずっと無料。何人使っても月980円（税込）です。
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
              <CTAButton large location="hero" />
              <div className="text-sm text-slate-400 leading-snug text-center sm:text-left">
                クレカ登録不要・30日間全機能お試し
                <br />
                勝手に課金されることはありません
              </div>
            </div>
          </div>
          <div className="hidden sm:block">
            <PhoneMockup />
          </div>
        </div>
      </section>

      {/* 課題共感: 料金構造のちがい */}
      <section className="py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-5">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center leading-snug mb-3">
            シフト管理に、スタッフの
            <br className="sm:hidden" />
            人数分の料金はいりません。
          </h2>
          <p className="text-center text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            Airシフトは2026年4月に有料化され、スタッフ1人あたり月330円（最低990円/月）がかかるようになりました。
            人数が増えるほど月額も増えていく仕組みです。シフトログは、何人使っても定額です。
          </p>
          <div className="rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
                  <th className="text-left font-medium px-2.5 sm:px-6 py-3.5 whitespace-nowrap">スタッフ数</th>
                  <th className="text-right font-medium px-2 sm:px-6 py-3.5 whitespace-nowrap">人数課金の場合<span className="hidden sm:inline">（Airシフト）</span></th>
                  <th className="text-right font-medium px-2.5 sm:px-6 py-3.5 text-blue-600 whitespace-nowrap">シフトログ</th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                {[
                  { staff: '3名', air: '月990円', log: '¥0（Freeプラン）' },
                  { staff: '5名', air: '月1,650円', log: '¥0（Freeプラン）' },
                  { staff: '10名', air: '月3,300円', log: '月980円（定額）' },
                  { staff: '30名', air: '月9,900円', log: '月980円（定額）' },
                ].map(r => (
                  <tr key={r.staff} className="border-b border-gray-100 last:border-0">
                    <td className="px-2.5 sm:px-6 py-3.5 font-medium whitespace-nowrap">{r.staff}</td>
                    <td className="px-2 sm:px-6 py-3.5 text-right text-gray-500 whitespace-nowrap">{r.air}</td>
                    <td className="px-2.5 sm:px-6 py-3.5 text-right font-bold text-blue-600 whitespace-nowrap">{r.log}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-4 leading-relaxed">
            ※2026年4月の有料化時点のAirシフト公表料金（スタッフ1人あたり月330円・最低990円/月）に基づく試算です。最新の料金は各公式サイトをご確認ください。
          </p>
        </div>
      </section>

      {/* Migration steps */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-5">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-3">
            Airシフトからの乗り換えは、
            <br className="sm:hidden" />
            10分で終わります。
          </h2>
          <p className="text-center text-gray-500 mb-12">面倒な移行作業は、こちらで代行します。</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                step: '1',
                title: 'スタッフの名前一覧を送る',
                desc: 'LINE・メール・写真でOK。手元のシフト表の写真をそのまま送っていただいても大丈夫です。',
              },
              {
                step: '2',
                title: 'こちらで店舗とスタッフを登録',
                desc: '店舗設定・スタッフ登録はこちらで代行します。ここまでで約10分です。',
              },
              {
                step: '3',
                title: 'スタッフはスマホでそのまま打刻',
                desc: 'スタッフはアプリのインストール不要。スマホでQRを読んで打刻を始められます。紙の移行マニュアルも要りません。',
              },
            ].map(s => (
              <div key={s.step} className="rounded-2xl bg-white border border-gray-200 p-7">
                <div className="w-11 h-11 bg-blue-600 rounded-xl flex items-center justify-center mb-5 text-white font-bold text-lg">
                  {s.step}
                </div>
                <h3 className="font-bold text-gray-900 mb-2.5 leading-snug">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-gray-500 mt-8">
            移行作業はすべて無料。Zoomで画面を見ながら一緒に設定することもできます（15分）。
            <br />
            移行のご相談: <a href="mailto:shibahara.724@gmail.com" className="text-blue-600 font-medium hover:underline">shibahara.724@gmail.com</a>
          </p>
        </div>
      </section>

      {/* Pains */}
      <section className="py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-5">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-3">こんな毎日、続けますか</h2>
          <p className="text-center text-gray-500 mb-12">小さな店のシフト管理は、マネージャーの善意と残業でできている。</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {PAINS.map(p => {
              const Icon = p.icon
              return (
                <div key={p.title} className="rounded-2xl border border-gray-200 p-7">
                  <div className="w-11 h-11 bg-red-50 rounded-xl flex items-center justify-center mb-5">
                    <Icon className="w-5 h-5 text-red-500" />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2.5 leading-snug">{p.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{p.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Solution 1: 今の状況が見える */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-5 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div>
            <p className="text-sm font-bold text-blue-600 mb-3">01 — 見える</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-snug mb-5">
              店にいなくても、
              <br />
              今日の店が見える。
            </h2>
            <p className="text-gray-500 leading-relaxed mb-6">
              誰が出勤中で、誰が休憩中か。今日のシフトは何件で、今月の人件費はいくらか。
              スマホを開けば5秒でわかります。店への電話確認は、もう要りません。
            </p>
            <ul className="space-y-2.5">
              {['出勤・休憩・退勤がリアルタイムに反映', '今月の人件費を毎日自動計算', 'スタッフはPINコードだけ、アプリ不要'].map(t => (
                <li key={t} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <DashboardMockup />
        </div>
      </section>

      {/* Solution 2: シフト作成 */}
      <section className="py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-5 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="order-1 lg:order-2">
            <p className="text-sm font-bold text-blue-600 mb-3">02 — 集まる</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-snug mb-5">
              希望収集から確定まで、
              <br />
              LINEの往復をゼロに。
            </h2>
            <p className="text-gray-500 leading-relaxed mb-6">
              スタッフの希望シフトはアプリに集まり、カレンダー上でそのまま確定。
              確定したシフトはスタッフのLINEに自動通知。「見てなかった」も「聞いてない」もなくなります。
            </p>
            <ul className="space-y-2.5">
              {['希望シフトをアプリで回収', '確定シフトをLINEへ自動通知', '足りない枠はシフト自動生成が下書き'].map(t => (
                <li key={t} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="order-2 lg:order-1">
            <div className="rounded-2xl bg-white shadow-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-bold text-gray-900">7月第2週のシフト</p>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-green-50 text-green-600 font-bold">確定・通知済み</span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-8 gap-1 text-center text-[10px] text-gray-400 mb-2">
                  <div />
                  {['月', '火', '水', '木', '金', '土', '日'].map(d => (
                    <div key={d} className={d === '土' ? 'text-blue-500' : d === '日' ? 'text-red-400' : ''}>{d}</div>
                  ))}
                </div>
                {[
                  { name: '佐藤', color: '#4A90E2', days: [1, 1, 0, 1, 1, 1, 0] },
                  { name: '田中', color: '#E24A6F', days: [0, 1, 1, 1, 0, 1, 1] },
                  { name: '鈴木', color: '#50B86C', days: [1, 0, 1, 0, 1, 1, 0] },
                ].map(r => (
                  <div key={r.name} className="grid grid-cols-8 gap-1 items-center mb-1.5">
                    <div className="flex items-center gap-1">
                      <div className="w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center" style={{ backgroundColor: r.color }}>
                        {r.name.charAt(0)}
                      </div>
                    </div>
                    {r.days.map((on, i) => (
                      <div key={i} className={`h-7 rounded-md ${on ? '' : 'bg-gray-50'}`} style={on ? { backgroundColor: r.color + '22', border: `1px solid ${r.color}55` } : {}}>
                        {on ? <p className="text-[8px] text-center pt-1.5 font-medium" style={{ color: r.color }}>17-23</p> : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Solution 3: 月末 */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-5 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div>
            <p className="text-sm font-bold text-blue-600 mb-3">03 — 終わる</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-snug mb-5">
              月末の集計は、
              <br />
              ボタン1つで終わり。
            </h2>
            <p className="text-gray-500 leading-relaxed mb-6">
              打刻データから勤務時間と概算給与を自動集計。freee・マネーフォワード・KING OF TIME形式のCSVをそのまま出力できるので、
              給与計算は「ダウンロードして取り込むだけ」になります。
            </p>
            <ul className="space-y-2.5">
              {['スタッフ別の勤務時間・残業・深夜を自動集計', '主要給与ソフト3社の形式でCSV出力', '締め日の深夜作業をゼロに'].map(t => (
                <li key={t} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <ReportMockup />
        </div>
      </section>

      {/* Story */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-5">
          <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 p-8 sm:p-12 text-center">
            <p className="text-sm font-bold text-blue-400 mb-5">作った人について</p>
            <p className="text-white text-lg sm:text-xl font-bold leading-relaxed mb-5">
              シフトログは、現役の飲食店マネージャーが
              <br className="hidden sm:block" />
              自分の店のために作ったアプリです。
            </p>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-xl mx-auto">
              紙のシフト表を書き、LINEで希望を集め、月末に電卓を叩く——その毎日を自分の店でなくすために作り、
              今もこのアプリで自分の店を回しています。だから、現場で本当に使う機能しか入っていません。
              困りごとや要望には、同じ現場の人間として返信します。
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-5">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-3">
            人数で課金しません。
            <br className="sm:hidden" />
            何人使っても、この料金です。
          </h2>
          <p className="text-center text-gray-500 mb-12">
            登録した日から30日間、Proの全機能が無料。クレジットカードの登録は一切不要なので、勝手に課金されることはありません。
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-white border border-gray-200 p-8">
              <h3 className="text-lg font-bold text-gray-900">Free</h3>
              <p className="text-4xl font-bold text-gray-900 mt-3 mb-1">
                ¥0<span className="text-base font-normal text-gray-400">/月</span>
              </p>
              <p className="text-sm text-gray-500 mb-7">スタッフ5名までの店は、ずっと無料</p>
              <ul className="space-y-3">
                {FREE_ITEMS.map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-white border-2 border-blue-600 p-8 relative shadow-xl shadow-blue-600/10">
              <span className="absolute -top-3.5 left-7 px-3.5 py-1 bg-blue-600 text-white text-xs font-bold rounded-full">
                30日間無料トライアル
              </span>
              <h3 className="text-lg font-bold text-gray-900">Pro</h3>
              <p className="text-4xl font-bold text-gray-900 mt-3 mb-1">
                ¥980<span className="text-base font-normal text-gray-400">/月（税込）</span>
              </p>
              <p className="text-sm text-gray-500 mb-7">年払いなら ¥9,800/年。月末の給与計算まで、これひとつで</p>
              <ul className="space-y-3">
                {PRO_ITEMS.map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-center text-sm text-gray-600 mt-8">
            Airシフトはスタッフ10人で月¥3,300（¥330/人）。シフトログのProは何人使っても月¥980です。
          </p>
          <p className="text-center text-sm text-gray-400 mt-2">
            トライアル終了後は自動でFreeプランに。<span className="font-medium text-gray-500">データは消えず、請求も発生しません。</span>
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-5">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-12">よくある質問</h2>
          <div className="space-y-4">
            {FAQS.map(f => (
              <div key={f.q} className="rounded-2xl border border-gray-200 p-6 sm:p-7">
                <h3 className="font-bold text-gray-900 mb-2.5 flex items-start gap-3">
                  <span className="text-blue-600 shrink-0">Q.</span>
                  {f.q}
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed pl-7">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 py-16 sm:py-20 text-center px-5">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
          乗り換えに、
          <br className="sm:hidden" />
          覚悟はいりません。
        </h2>
        <p className="text-slate-400 mb-8">登録は3分、移行は10分。合わなくても、Freeのまま使い続けられます。</p>
        <CTAButton large location="bottom" />
        <p className="text-sm text-slate-500 mt-4">30日間Proを無料でお試し・クレジットカード不要</p>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
              <Calendar className="w-3.5 h-3.5 text-white" />
            </div>
            <p className="text-sm text-slate-500">© シフトログ</p>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link to="/legal/tokusho" className="hover:text-slate-300 transition-colors">特定商取引法に基づく表記</Link>
            <Link to="/login" onClick={() => track('cta_click', { label: 'ログイン', location: 'footer' })} className="hover:text-slate-300 transition-colors">ログイン</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
