import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Store, Users, Calendar, Smartphone, MessageCircle, CreditCard, CheckCircle2, Copy, Download, Sparkles, ExternalLink, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'

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
  const appUrl = 'https://shiftlog-production.up.railway.app/'

  const copy = (txt: string, label = 'コピーしました') => {
    navigator.clipboard.writeText(txt)
    toast.success(label)
  }

  const ownerSteps: Step[] = [
    {
      id: 'store',
      title: '1. 店舗を追加',
      icon: Store,
      owner: true,
      body: (
        <div>
          <p>左メニュー「店舗管理」→「+ 店舗追加」から店舗を1つ追加します。店舗名のみ必須。</p>
          <p className="text-xs text-gray-500 mt-1">無料プランでは1店舗まで。2店舗目以降は月額¥980/店舗のアップグレードが必要です。</p>
          <Link to="/stores" className="inline-flex items-center gap-1 mt-2 text-blue-600 hover:underline text-sm">
            店舗管理へ <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      ),
    },
    {
      id: 'staff',
      title: '2. スタッフを登録（3つの方法から選べます）',
      icon: Users,
      owner: true,
      body: (
        <div className="space-y-2">
          <div className="bg-gray-50 rounded p-3">
            <p className="font-semibold text-sm">A. 1人ずつ追加（少人数向け）</p>
            <p className="text-xs text-gray-600">スタッフ管理 →「+ スタッフ追加」で氏名・個人PIN（4桁）・時給を入力</p>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <p className="font-semibold text-sm">B. CSV一括登録（10名以上の場合推奨）</p>
            <p className="text-xs text-gray-600">スタッフ管理 →「CSV一括登録」→ テンプレートをダウンロード → Excel編集 → アップロード</p>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <p className="font-semibold text-sm">C. 既存スタッフにメール招待（今後追加予定）</p>
            <p className="text-xs text-gray-500">本人がメール経由で自己登録</p>
          </div>
          <Link to="/staff" className="inline-flex items-center gap-1 mt-1 text-blue-600 hover:underline text-sm">
            スタッフ管理へ <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      ),
    },
    {
      id: 'invite',
      title: '3. スタッフに使い方を共有（最重要！）',
      icon: MessageCircle,
      owner: true,
      body: (
        <div className="space-y-2">
          <p className="text-sm">スタッフが登録されても、<b>本人に使い方が伝わらないと利用されません</b>。下のメッセージをLINEやメールでスタッフに送ってください:</p>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 relative">
            <button
              onClick={() => copy(staffInvitationMessage({ companyName: selectedCompany?.name || '', companyPin, appUrl }), 'LINE用メッセージをコピーしました')}
              className="absolute top-2 right-2 px-2 py-1 text-xs bg-white border border-green-300 rounded hover:bg-green-50 flex items-center gap-1"
            >
              <Copy className="w-3 h-3" /> コピー
            </button>
            <pre className="text-xs text-gray-800 whitespace-pre-wrap pr-20 font-sans">
{staffInvitationMessage({ companyName: selectedCompany?.name || '○○○', companyPin: companyPin || '(会社管理画面で確認)', appUrl })}
            </pre>
          </div>
        </div>
      ),
    },
    {
      id: 'shift',
      title: '4. シフトを作成（2通り）',
      icon: Calendar,
      owner: true,
      body: (
        <div className="space-y-2">
          <div className="bg-gray-50 rounded p-3">
            <p className="font-semibold text-sm">A. 手動作成（少人数・シンプル）</p>
            <p className="text-xs text-gray-600">ダッシュボードのカレンダーで日付をクリック → スタッフ/時間を指定</p>
          </div>
          <div className="bg-purple-50 rounded p-3">
            <p className="font-semibold text-sm flex items-center gap-1"><Sparkles className="w-3 h-3 text-purple-600" /> B. 自動生成（スタッフ多数）</p>
            <p className="text-xs text-gray-600">左メニュー「シフト自動生成」→ 必要な日時・人数を入力 → 希望シフトとスキルを考慮して自動で割り当て</p>
          </div>
          <p className="text-xs text-gray-500">作成したら「シフト公開」ボタンでスタッフに通知されます。</p>
        </div>
      ),
    },
    {
      id: 'timecard',
      title: '5. 出退勤打刻を運用',
      icon: Smartphone,
      owner: true,
      body: (
        <div className="space-y-1 text-sm">
          <p>スタッフは各自のスマホから「タイムカード」画面で出退勤を打刻します。</p>
          <p>店舗共用タブレットを置く場合は、ログイン画面「出退勤タイムレコーダー」から会社PINでキオスクモード起動。</p>
          <p className="text-xs text-gray-500 mt-2">打刻データは「勤務集計」「給与エクスポート」で月次集計・CSV出力可能。freee/MoneyForward/KING OF TIME形式に対応。</p>
        </div>
      ),
    },
    {
      id: 'billing',
      title: '6. 店舗を増やす場合（月額¥980/店舗）',
      icon: CreditCard,
      owner: true,
      body: (
        <div className="text-sm">
          <p>店舗管理画面の「アップグレード」から Stripe Checkout で決済。いつでもキャンセル可能、解約は次回更新時に無料プランに戻ります。</p>
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
            <li>個人PIN（4桁）を入力</li>
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
          <p className="font-semibold mb-1">📋 スタッフ用案内をPDFで配布</p>
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
5. 個人PIN（4桁・別途お伝えします）を入力

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
