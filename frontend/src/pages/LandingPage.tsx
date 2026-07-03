import { Link } from 'react-router-dom'
import {
  Calendar,
  Clock,
  Users,
  BarChart2,
  FileSpreadsheet,
  MessageCircle,
  Sparkles,
  Check,
  ArrowRight,
} from 'lucide-react'

const FEATURES = [
  {
    icon: Clock,
    title: 'スマホで出退勤打刻',
    desc: 'スタッフは自分のスマホから打刻。店舗共用のタイムレコーダーモードにも対応。誰が今働いているかが一目でわかります。',
  },
  {
    icon: Calendar,
    title: 'シフト作成と希望収集',
    desc: 'スタッフの希望シフトをアプリで収集して、カレンダー上でそのまま確定。紙とLINEのやり取りから解放されます。',
  },
  {
    icon: BarChart2,
    title: '勤務集計と人件費',
    desc: 'スタッフ別の勤務時間・概算給与を自動集計。今月の人件費が今日の時点でいくらか、いつでも確認できます。',
  },
  {
    icon: FileSpreadsheet,
    title: '給与ソフト連携CSV',
    desc: 'freee・マネーフォワード・KING OF TIME形式のCSVをワンクリック出力。月末の給与計算がそのまま終わります。',
  },
  {
    icon: MessageCircle,
    title: 'LINE通知',
    desc: 'シフト確定や交代依頼をスタッフのLINEへ自動通知。「見てなかった」をなくします。',
  },
  {
    icon: Sparkles,
    title: 'シフト自動生成',
    desc: '希望と必要人数から下書きシフトを自動生成。作成時間を大幅に短縮できます。',
  },
]

const FREE_ITEMS = ['出退勤打刻（スマホ / キオスク）', 'シフト作成・希望収集', '当月の勤務集計', 'スタッフ30名まで', '1店舗']
const PRO_ITEMS = ['Freeの全機能', '過去月の集計・履歴', 'CSV出力（勤怠・シフト）', '給与ソフト連携（freee / マネフォ / KOT）', 'スタッフ無制限', '追加店舗（+¥980/店舗）']

const FAQS = [
  {
    q: '無料期間が終わるとデータは消えますか？',
    a: '消えません。トライアル終了後は自動的にFreeプランに切り替わり、登録済みのスタッフ・シフト・打刻データはすべてそのまま使えます。',
  },
  {
    q: '登録にクレジットカードは必要ですか？',
    a: '不要です。メールアドレスだけで登録でき、30日間Proの全機能を無料でお試しいただけます。',
  },
  {
    q: '解約はすぐできますか？',
    a: 'はい。設定ページからいつでも解約でき、請求期間の終了まで利用できます。解約後もFreeプランとしてデータは残ります。',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">シフトログ</span>
          </div>
          <Link
            to="/login"
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            ログイン
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 pt-16 pb-14 text-center">
        <p className="inline-block px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-medium mb-5">
          飲食店・サロン・小規模店舗のためのシフト管理
        </p>
        <h1 className="text-3xl sm:text-5xl font-bold text-gray-900 leading-tight mb-5">
          打刻とシフトを、
          <br className="sm:hidden" />
          毎日見える状態に。
        </h1>
        <p className="text-base sm:text-lg text-gray-500 max-w-2xl mx-auto mb-8 leading-relaxed">
          出退勤の打刻、今日のシフト、勤務集計を1画面で。
          紙のシフト表とLINEのやり取りを、これひとつにまとめられます。
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/login?mode=register"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors text-base"
          >
            無料で店舗を作成する
            <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="text-sm text-gray-400">30日間Proを無料でお試し・クレジットカード不要</p>
        </div>
      </section>

      {/* Features */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">店舗運営に必要な機能を、まとめて</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => {
              const Icon = f.icon
              return (
                <div key={f.title} className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-3">料金プラン</h2>
          <p className="text-center text-gray-500 mb-10">新規登録から30日間は、Proの全機能を無料でお試しいただけます</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-gray-200 p-7">
              <h3 className="text-lg font-bold text-gray-900">Free</h3>
              <p className="text-3xl font-bold text-gray-900 mt-2 mb-1">
                ¥0<span className="text-base font-normal text-gray-400">/月</span>
              </p>
              <p className="text-sm text-gray-500 mb-6">1店舗の日々の運用はずっと無料</p>
              <ul className="space-y-2.5">
                {FREE_ITEMS.map(item => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border-2 border-blue-600 p-7 relative">
              <span className="absolute -top-3 left-6 px-3 py-0.5 bg-blue-600 text-white text-xs font-semibold rounded-full">
                30日間無料トライアル
              </span>
              <h3 className="text-lg font-bold text-gray-900">Pro</h3>
              <p className="text-3xl font-bold text-gray-900 mt-2 mb-1">
                ¥980<span className="text-base font-normal text-gray-400">/月（税込）</span>
              </p>
              <p className="text-sm text-gray-500 mb-6">月末の給与計算まで、これひとつで</p>
              <ul className="space-y-2.5">
                {PRO_ITEMS.map(item => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">よくある質問</h2>
          <div className="space-y-4">
            {FAQS.map(f => (
              <div key={f.q} className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-bold text-gray-900 mb-2">{f.q}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 text-center px-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">今日のシフトから、見える状態に。</h2>
        <Link
          to="/login?mode=register"
          className="inline-flex items-center gap-2 px-8 py-3.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
        >
          無料で店舗を作成する
          <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="text-sm text-gray-400 mt-3">30日間Proを無料でお試し・クレジットカード不要</p>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-gray-400">© シフトログ</p>
          <div className="flex items-center gap-5 text-sm text-gray-400">
            <Link to="/legal/tokusho" className="hover:text-gray-600">特定商取引法に基づく表記</Link>
            <Link to="/login" className="hover:text-gray-600">ログイン</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
