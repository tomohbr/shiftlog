import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Store, Users, Calendar, Smartphone, MessageCircle, CreditCard, CheckCircle2, Copy, Download, Sparkles, ExternalLink, ChevronRight, Mail, HeartHandshake, ClipboardList, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { PUBLIC_APP_ORIGIN } from '../native/platform'

interface Step {
  id: string
  title: string
  icon: any
  owner: boolean // true=オーナー向け, false=スタッフ向け
  body: React.ReactNode
}

export default function SetupGuidePage() {
  const { user, selectedCompany } = useAuth()
  const [audience, setAudience] = useState<'owner' | 'staff'>('owner')
  const companyPin = (selectedCompany as any)?.company_pin || ''
  const appUrl = `${PUBLIC_APP_ORIGIN}/`

  const copy = (txt: string, label = 'コピーしました') => {
    navigator.clipboard.writeText(txt)
    toast.success(label)
  }

  const ownerSteps: Step[] = [
    {
      id: 'store',
      title: '1. 店舗を確かめる',
      icon: Store,
      owner: true,
      body: (
        <div>
          <p>登録のときに入れた名前で店舗が1つできています。名前を直したいときや、店舗を増やしたいときだけ「会社・店舗」を開いてください。</p>
          <p className="text-xs text-gray-500 mt-1">無料で使えるのは1店舗・スタッフ5名までです。</p>
          <Link to="/organization" className="inline-flex items-center gap-1 mt-2 text-blue-600 hover:underline text-sm">
            会社・店舗へ <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      ),
    },
    {
      id: 'staff',
      title: '2. スタッフを登録する',
      icon: Users,
      owner: true,
      body: (
        <div className="space-y-2">
          <div className="bg-gray-50 rounded p-3">
            <p className="font-semibold text-sm">A. 1人ずつ（少人数のお店）</p>
            <p className="text-xs text-gray-600">スタッフ管理 →「スタッフ追加」。<b>名前だけ</b>で登録できます。時給は後からで大丈夫です</p>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <p className="font-semibold text-sm">B. まとめて（何人もいるお店）</p>
            <p className="text-xs text-gray-600">スタッフ管理 →「一括登録」。名前を改行で貼り付けるか、表の形（CSV）で読み込めます</p>
          </div>
          <p className="text-xs text-gray-500">無料のままで登録できるのは5名までです。6名以上はPro（月額¥980／年額¥9,800）になります。</p>
          <Link to="/staff" className="inline-flex items-center gap-1 mt-1 text-blue-600 hover:underline text-sm">
            スタッフ管理へ <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      ),
    },
    {
      id: 'invite',
      title: '3. スタッフに入り口を渡す（いちばん大事）',
      icon: MessageCircle,
      owner: true,
      body: (
        <div className="space-y-2">
          <p className="text-sm">登録しただけでは、スタッフはまだ何も見られません。<b>入り口を渡すところまで</b>やってください。</p>
          <div className="bg-gray-50 rounded p-3">
            <p className="font-semibold text-sm">おすすめ: QRコード</p>
            <p className="text-xs text-gray-600">スタッフ管理 →「QR」。印刷してレジ横やバックヤードに貼ると、スマホをかざすだけで入れます（会社PINの入力も要りません）</p>
          </div>
          <p className="text-sm">離れている人には、下の案内文をLINEやメールで送ってください。</p>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 relative">
            <button
              onClick={() => copy(staffInvitationMessage({ companyName: selectedCompany?.name || '', companyPin, appUrl }), 'LINE用メッセージをコピーしました')}
              className="absolute top-2 right-2 px-2 py-1 text-xs bg-white border border-green-300 rounded hover:bg-green-50 flex items-center gap-1"
            >
              <Copy className="w-3 h-3" /> コピー
            </button>
            <pre className="text-xs text-gray-800 whitespace-pre-wrap pr-20 font-sans">
{staffInvitationMessage({ companyName: selectedCompany?.name || '○○○', companyPin: companyPin || '(会社・店舗の画面で確認)', appUrl })}
            </pre>
          </div>
        </div>
      ),
    },
    {
      id: 'collect',
      title: '4. 希望を集める（手で作るなら飛ばしてOK）',
      icon: ClipboardList,
      owner: true,
      body: (
        <div className="space-y-2 text-sm">
          <p>「希望を集める」で期間と締切を決めて受付を始めると、スタッフが自分のスマホから ◎入りたい／○入れる／×無理 を出せます。</p>
          <p className="text-xs text-gray-600">LINE通知を設定していれば1人1通で届きます。設定していなくても、スタッフの「シフト希望提出」の画面に出ます。</p>
          <Link to="/request-campaigns" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm">
            希望を集めるへ <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      ),
    },
    {
      id: 'shift',
      title: '5. シフトを作る（3通り）',
      icon: Calendar,
      owner: true,
      body: (
        <div className="space-y-2">
          <div className="bg-gray-50 rounded p-3">
            <p className="font-semibold text-sm">A. 手で入れる（少人数・シンプル）</p>
            <p className="text-xs text-gray-600">シフト管理の表で「＋」を押して、スタッフと時間を決めます</p>
          </div>
          <div className="bg-purple-50 rounded p-3">
            <p className="font-semibold text-sm flex items-center gap-1"><Sparkles className="w-3 h-3 text-purple-600" /> B. 希望から自動で作る（人数が多いお店）</p>
            <p className="text-xs text-gray-600">「シフト自動作成」で、曜日ごとの必要人数（例：平日 17:00-22:00 2人）を決めると、集まった希望から下書きができます。表で手直しして確定します</p>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <p className="font-semibold text-sm">C. 先月をコピーする</p>
            <p className="text-xs text-gray-600">「テンプレート」から、よく使う形を保存して使い回せます</p>
          </div>
          <Link to="/auto-schedule" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm">
            シフト自動作成へ <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      ),
    },
    {
      id: 'publish',
      title: '6. スタッフに公開する（ここまでやらないと届きません）',
      icon: Send,
      owner: true,
      body: (
        <div className="space-y-2 text-sm">
          <p>作っただけのシフトは<b>下書き</b>です。スタッフの画面には何も出ていません。</p>
          <p>シフト管理かダッシュボードの<b>「スタッフに公開する」</b>を押すと、その月のシフトがスタッフの「シフト」画面に出ます。LINE通知を設定していれば、そのときにお知らせも届きます。</p>
          <p className="text-xs text-gray-500">直したいときは、公開したまま直して大丈夫です（変更はスタッフにも知らせます）。</p>
          <Link to="/shifts" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm">
            シフト管理へ <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      ),
    },
    {
      id: 'timecard',
      title: '7. 出退勤の打刻を始める',
      icon: Smartphone,
      owner: true,
      body: (
        <div className="space-y-1 text-sm">
          <p>スタッフは自分のスマホの「タイムカード」で出勤・退勤を押します。</p>
          <p>お店のタブレットを1台置くなら、ログイン画面の「出退勤タイムレコーダー」を開いて会社PINを入れておきます。</p>
          <p className="text-xs text-gray-500 mt-2">打刻は「勤務集計」でその月の合計が見られます。給与ソフト向けのCSV（freee・マネーフォワード・KING OF TIME）はProで出せます。</p>
        </div>
      ),
    },
    {
      id: 'billing',
      title: '8. 料金',
      icon: CreditCard,
      owner: true,
      body: (
        <div className="text-sm space-y-1">
          <p><b>無料</b>：1店舗・スタッフ5名まで。打刻もシフトもずっと無料で使えます。</p>
          <p><b>Pro（月額¥980／年額¥9,800）</b>：スタッフ6名以上、過去の月やこれから先の月の集計、給与ソフト向けCSV。登録から30日はProの機能をそのまま試せます。</p>
          <p className="text-xs text-gray-500">クレジットカードの登録は、Proにするときだけです。勝手に課金されることはありません。</p>
          <Link to="/settings" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm">
            プランを見る <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      ),
    },
  ]

  const staffSteps: Step[] = [
    {
      id: 'access',
      title: '1. アプリを開く',
      icon: Smartphone,
      owner: false,
      body: (
        <div className="space-y-2 text-sm">
          <p>ブラウザで以下のURLを開いてください。スマホの場合はホーム画面に追加すると便利です。</p>
          <div className="bg-gray-50 rounded p-2 flex items-center justify-between">
            <code className="text-xs">{appUrl}</code>
            <button onClick={() => copy(appUrl, 'URLをコピー')} className="px-2 py-1 text-xs bg-white border rounded hover:bg-gray-100">
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <p className="text-xs text-gray-500">iPhone Safari: 共有ボタン → ホーム画面に追加 / Android Chrome: メニュー → ホーム画面に追加</p>
        </div>
      ),
    },
    {
      id: 'login',
      title: '2. スタッフログイン',
      icon: Users,
      owner: false,
      body: (
        <div className="space-y-2 text-sm">
          <p>ログイン画面で「スタッフログイン」を選択。</p>
          <ol className="list-decimal ml-5 space-y-1 text-sm">
            <li>会社PIN（管理者から受け取った6桁の数字）を入力</li>
            <li>スタッフ一覧から自分の名前をタップ</li>
            <li>一覧から自分の名前を選択</li>
          </ol>
        </div>
      ),
    },
    {
      id: 'checkin',
      title: '3. 出退勤打刻',
      icon: CheckCircle2,
      owner: false,
      body: (
        <div className="space-y-1 text-sm">
          <p>「タイムカード」画面で「出勤」ボタンを押すと打刻完了。休憩・退勤も同じ画面から。</p>
          <p className="text-xs text-gray-500">打刻した時刻がズレていたら管理者に連絡してください。</p>
        </div>
      ),
    },
    {
      id: 'request',
      title: '4. 希望シフトを提出',
      icon: Calendar,
      owner: false,
      body: (
        <div className="space-y-1 text-sm">
          <p>「希望シフト提出」画面で日付をタップして <b>出勤可 / 希望 / 出勤不可</b> を切替。</p>
          <p className="text-xs text-gray-500">提出期間外は提出できません。管理者が募集期間を設定します。</p>
        </div>
      ),
    },
    {
      id: 'swap',
      title: '5. シフトを代わってもらいたいとき',
      icon: MessageCircle,
      owner: false,
      body: (
        <div className="space-y-1 text-sm">
          <p>「シフト交代」画面からリクエスト作成。他のスタッフが承諾すると自動でシフトが振替。</p>
        </div>
      ),
    },
    {
      id: 'absence',
      title: '6. 急な欠勤連絡',
      icon: Smartphone,
      owner: false,
      body: (
        <div className="space-y-1 text-sm">
          <p>「欠勤連絡」画面で日付と理由を入力して送信。管理者＋他スタッフに一斉連絡されます。</p>
        </div>
      ),
    },
  ]

  const steps = audience === 'owner' ? ownerSteps : staffSteps

  const downloadPdf = () => {
    // シンプルに印刷モードでPDF化。window.print() を利用。
    window.print()
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 print:max-w-full">
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 print:hidden">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900">導入手順書</h2>
            <p className="text-sm text-gray-600 mt-1">シフトログを使い始めるための step-by-step ガイド。オーナー向けとスタッフ向けで切り替え可能です。印刷してスタッフに配布することもできます。</p>
          </div>
        </div>
      </div>

      {/* 導入代行サービスの案内 */}
      <div className="bg-gradient-to-r from-pink-50 to-rose-50 border-2 border-pink-300 rounded-xl p-5 print:hidden">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-pink-600 rounded-lg flex items-center justify-center shrink-0">
            <HeartHandshake className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900">導入代行サービスもあります</h3>
            <p className="text-sm text-gray-700 mt-1">
              「セットアップが難しい」「スタッフへの共有をまとめて任せたい」という方向けに、
              <b className="text-pink-700">初期設定〜スタッフへのログイン案内までを代行</b>するサービスを行っています。
            </p>
            <ul className="text-xs text-gray-600 mt-2 space-y-0.5 list-disc ml-5">
              <li>会社情報・店舗・スタッフの一括登録</li>
              <li>各スタッフへのログイン案内文作成（LINE/メール向け）</li>
              <li>初回シフトの作成・公開サポート</li>
              <li>運用開始後の初期問合せ対応</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="mailto:shibahara.724@gmail.com?subject=%E3%82%B7%E3%83%95%E3%83%88%E3%83%AD%E3%82%B0%20%E5%B0%8E%E5%85%A5%E4%BB%A3%E8%A1%8C%E3%81%AE%E7%94%B3%E8%BE%BC&body=%E4%BC%9A%E7%A4%BE%E5%90%8D%EF%BC%9A%0A%E6%8B%85%E5%BD%93%E8%80%85%EF%BC%9A%0A%E3%82%B9%E3%82%BF%E3%83%83%E3%83%95%E6%95%B0%EF%BC%9A%0A%E5%B8%8C%E6%9C%9B%E3%81%99%E3%82%8B%E9%96%8B%E5%A7%8B%E3%82%BF%E3%82%A4%E3%83%9F%E3%83%B3%E3%82%B0%EF%BC%9A%0A%E3%81%94%E8%B3%AA%E5%95%8F%E3%83%BB%E3%81%94%E8%A6%81%E6%9C%9B%EF%BC%9A"
                className="inline-flex items-center gap-1.5 bg-pink-600 hover:bg-pink-700 text-white font-semibold px-4 py-2 rounded-lg text-sm"
              >
                <Mail className="w-4 h-4" /> メールで相談する
              </a>
              <button
                onClick={() => { window.location.href = '/feedback' }}
                className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 font-semibold px-4 py-2 rounded-lg text-sm"
              >
                <MessageCircle className="w-4 h-4" /> アプリ内から相談
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 print:hidden">
        <div className="inline-flex rounded-lg border border-gray-200 p-1 bg-white">
          <button
            onClick={() => setAudience('owner')}
            className={`px-4 py-1.5 rounded text-sm font-medium ${audience === 'owner' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
          >
            オーナー向け
          </button>
          <button
            onClick={() => setAudience('staff')}
            className={`px-4 py-1.5 rounded text-sm font-medium ${audience === 'staff' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
          >
            スタッフ向け
          </button>
        </div>
        <button
          onClick={downloadPdf}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50"
        >
          <Download className="w-3.5 h-3.5" />
          印刷/PDF保存
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y">
        {steps.map((step, i) => {
          const Icon = step.icon
          return (
            <div key={step.id} className="p-5 print:break-inside-avoid">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-gray-900 mb-2">{step.title}</h3>
                  <div className="text-sm text-gray-700">{step.body}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {audience === 'staff' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-gray-700 print:hidden">
          <p className="font-semibold mb-1">スタッフ用案内をPDFで配布</p>
          <p>上の「印刷/PDF保存」ボタンで、A4 1〜2枚に収まる配布用の手順書を出せます。LINEでも配信できます。</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5 print:hidden">
        <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
          <ExternalLink className="w-4 h-4" /> さらに詳しい使い方
        </h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Link to="/help" className="px-3 py-2 border border-gray-200 rounded hover:bg-gray-50 flex items-center justify-between">
            使い方ヘルプ (FAQ) <ChevronRight className="w-3 h-3" />
          </Link>
          <Link to="/feedback" className="px-3 py-2 border border-gray-200 rounded hover:bg-gray-50 flex items-center justify-between">
            質問を送る <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}

function staffInvitationMessage({ companyName, companyPin, appUrl }: { companyName: string; companyPin: string; appUrl: string }) {
  return `【シフトログご案内】${companyName}
スタッフ管理用アプリ「シフトログ」にあなたのアカウントを作成しました。
スマホ・PC どちらからでも使えます。

▼ URL
${appUrl}

▼ ログイン手順
1. 上のURLを開く
2. 「スタッフログイン」をタップ
3. 会社PIN: ${companyPin} を入力
4. スタッフ一覧から自分の名前をタップ

▼ 使える機能
・出退勤の打刻
・シフト確認／希望提出
・シフト交代の依頼
・急な欠勤の連絡

▼ スマホのホーム画面に追加すると便利です
iPhone(Safari): 共有 → ホーム画面に追加
Android(Chrome): メニュー → ホーム画面に追加

ご不明な点があれば気軽にご連絡ください。`
}
