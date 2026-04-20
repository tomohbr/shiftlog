import { useState } from 'react'
import { ChevronDown, ChevronUp, Book, Users, Calendar, Clock, DollarSign, Store, MessageCircle, AlertCircle, HelpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

interface FaqItem {
  q: string
  a: string
}

interface Section {
  id: string
  title: string
  icon: any
  items: FaqItem[]
}

const SECTIONS: Section[] = [
  {
    id: 'getting-started',
    title: 'はじめに・基本操作',
    icon: Book,
    items: [
      {
        q: 'シフトログってどんなアプリ？',
        a: 'スマホ・PC両対応のシフト管理アプリです。管理者（オーナー・店長）がシフトを作成・公開し、スタッフがスマホから希望シフトの提出、出退勤打刻、欠勤連絡まで完結できます。1店舗完全無料、2店舗目以降¥980/月/店舗。',
      },
      {
        q: 'スタッフはどうやってログインする？',
        a: '①「オーナー・店長ログイン」ではなく「スタッフログイン」を選択 → ②会社PIN（6桁）を入力 → ③一覧から自分の名前をタップ → ④個人PIN（4桁）かパスワードでログイン。会社PINはオーナーが「会社管理」画面で確認できます。',
      },
      {
        q: 'データは安全？',
        a: '通信はすべてHTTPS、パスワードはbcryptでハッシュ化、JWTセッションは90日で自動失効。会社ごとにデータ分離されており、他社データは参照できません。',
      },
    ],
  },
  {
    id: 'shift',
    title: 'シフト作成・公開',
    icon: Calendar,
    items: [
      {
        q: 'シフトはどう作る？',
        a: '「シフト管理」→ 右上の「+シフト追加」 → 日付・スタッフ・開始/終了時刻・休憩を入力して追加。実働時間は自動計算されます。よく使うパターンは「テンプレート」に登録しておけば一括適用可能。',
      },
      {
        q: 'スタッフに希望シフトを提出してもらうには？',
        a: '「希望シフト収集」→ 提出期間を設定 → スタッフは「希望シフト提出」画面で日毎に「出勤可/希望/出勤不可」を選択。提出状況は管理者から一覧で確認できます。',
      },
      {
        q: '公開するとどうなる？',
        a: 'LINE通知設定ONの場合、該当スタッフに自動でLINE通知が飛びます。通知OFF時はスタッフがアプリを開くとカレンダーに反映されます。',
      },
    ],
  },
  {
    id: 'staff',
    title: 'スタッフ管理',
    icon: Users,
    items: [
      {
        q: 'スタッフを追加するには？',
        a: '「スタッフ管理」→「+スタッフ追加」。氏名・個人PIN（4桁・必須）・時給・役割（スタッフ/店長）などを入力。メール/パスワードはスマホログイン用に任意設定可。',
      },
      {
        q: 'スタッフの時給を変更したい',
        a: '「スタッフ管理」→ 対象スタッフの「編集（鉛筆アイコン）」→ 時給欄を更新。人件費計算は更新後の時給が即反映されます。',
      },
      {
        q: '退職したスタッフはどう処理する？',
        a: '削除（ゴミ箱アイコン）すると過去の勤怠データも消えるので、そのままにして編集で無効化するのが推奨。将来バージョンで「退職済」フラグを追加予定（フィードバックをお寄せください）。',
      },
    ],
  },
  {
    id: 'timecard',
    title: 'タイムカード・勤務集計',
    icon: Clock,
    items: [
      {
        q: 'スタッフはどこから打刻する？',
        a: 'スタッフログイン後の「タイムカード」画面、または店舗に設置した「出退勤タイムレコーダー」（共用端末モード）から。',
      },
      {
        q: '勤務時間がズレてた時の修正方法は？',
        a: '管理者の「タイムカード」画面で日別の打刻を直接編集可能。出勤・退勤・休憩時間を修正後、保存で反映されます。',
      },
      {
        q: 'CSV出力はどこから？',
        a: '「勤務集計」画面の右上に3つのボタン（勤務集計 / シフト / タイムカード）。給与ソフトへの取り込み用に使えます。',
      },
    ],
  },
  {
    id: 'labor',
    title: '人件費・売上',
    icon: DollarSign,
    items: [
      {
        q: '売上を入力すると何が分かる？',
        a: '「人件費・売上」→「売上・人件費率」タブで日別売上を入力。人件費率（人件費÷売上）が自動計算され、目標値（通常25-30%）との比較ができます。',
      },
      {
        q: '労務アラートとは？',
        a: '法定労働時間超過（週40h / 月160h目安）、深夜労働、休憩未取得などを自動検知して「人件費・売上」の「労務アラート」タブに表示します。',
      },
    ],
  },
  {
    id: 'absence',
    title: '欠勤連絡・ヘルプ募集',
    icon: AlertCircle,
    items: [
      {
        q: 'スタッフが急に休む時の流れは？',
        a: 'スタッフ側「欠勤・ヘルプ」→「欠勤連絡」タブで日付・理由を入力して送信。管理者通知 + 他スタッフへのヘルプ募集が自動起動します。',
      },
      {
        q: 'ヘルプに応じた人への処理は？',
        a: '管理者は「欠勤・ヘルプ」→「ヘルプ募集」タブで対応状況を確認。応じたスタッフを割り当てるとシフトが自動更新されます。',
      },
    ],
  },
  {
    id: 'store',
    title: '店舗・課金',
    icon: Store,
    items: [
      {
        q: '2店舗目を追加するには？',
        a: '「店舗管理」→「アップグレード」ボタン → Stripeで月額¥980/店舗のサブスクに登録。登録完了後、店舗数の上限が自動で1つ増えます。いつでもキャンセル可能。',
      },
      {
        q: '解約したい',
        a: 'Stripeの請求書メールに記載のリンクから、または「店舗管理」→「アップグレード」モーダルから解約可能（実装予定）。解約すると次回更新時に無料プランに戻ります。',
      },
      {
        q: '複数会社を切り替えるには？',
        a: '左サイドバー上部の会社名をクリック → 所属会社一覧から選択。「会社管理」から会社の追加・編集・削除も可能。',
      },
    ],
  },
  {
    id: 'line',
    title: 'LINE通知',
    icon: MessageCircle,
    items: [
      {
        q: 'LINEで通知を受け取るには？',
        a: '①管理者が「LINE通知」画面でLINE Messaging APIのチャネルアクセストークンを設定 ②各スタッフが自分のLINE User IDをプロフィール画面で登録。③シフト公開時等に自動通知。',
      },
      {
        q: 'LINE Developer登録が必要？',
        a: 'はい、[LINE Developers](https://developers.line.biz/) で公式アカウント＆Messaging APIチャネルを無料で作成できます。詳細な手順は別途ガイドを公開予定。',
      },
    ],
  },
]

function AccordionItem({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-3 text-left hover:bg-gray-50 px-2 rounded"
      >
        <span className="text-sm font-medium text-gray-800">{item.q}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {open && (
        <div className="pb-3 px-2 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
          {item.a}
        </div>
      )}
    </div>
  )
}

export default function HelpPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
            <HelpCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 mb-1">使い方ヘルプ</h1>
            <p className="text-sm text-gray-600">よくある質問とシフトログの主な使い方をまとめています。困ったら下のフィードバックからご質問ください。</p>
          </div>
        </div>
      </div>

      {SECTIONS.map(section => {
        const Icon = section.icon
        return (
          <div key={section.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gray-50">
              <Icon className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-semibold text-gray-900">{section.title}</h2>
            </div>
            <div className="px-3 py-2">
              {section.items.map((item, idx) => (
                <AccordionItem key={idx} item={item} />
              ))}
            </div>
          </div>
        )
      })}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-900 mb-2">解決しない場合は</p>
        <p className="text-sm text-gray-700 mb-3">
          FAQで解決しない質問やバグ報告・機能リクエストは、フィードバック画面からご連絡ください。通常1〜3営業日でご返信します。
        </p>
        <Link
          to="/feedback"
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg transition"
        >
          <MessageCircle className="w-4 h-4" />
          フィードバックを送る
        </Link>
      </div>
    </div>
  )
}
