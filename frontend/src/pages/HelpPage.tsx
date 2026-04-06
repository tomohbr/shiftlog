import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

interface FAQ {
  question: string
  answer: string
  category: string
  roles: ('admin' | 'staff')[]
}

const faqs: FAQ[] = [
  // 基本操作
  {
    question: 'シフトログとは何ですか？',
    answer: 'シフトログは飲食店向けのシフト管理アプリです。シフトの作成・公開、タイムカード（出退勤打刻）、希望シフト収集、欠勤連絡・ヘルプ募集など、シフト管理に必要な機能をまとめて提供しています。',
    category: '基本操作',
    roles: ['admin', 'staff'],
  },
  {
    question: 'ログイン方法を教えてください',
    answer: '管理者はメールアドレスとパスワードでログインします。スタッフは会社PINを入力し、自分の名前を選択してログインします。会社PINは管理者に確認してください。',
    category: '基本操作',
    roles: ['admin', 'staff'],
  },
  {
    question: 'パスワードを忘れました',
    answer: '管理者にパスワードリセットを依頼してください。管理者は「スタッフ管理」画面から該当スタッフのパスワードをリセットできます。',
    category: '基本操作',
    roles: ['admin', 'staff'],
  },
  // タイムカード
  {
    question: '出勤・退勤の打刻方法は？',
    answer: 'タイムカード画面で「出勤」ボタンをタップすると出勤打刻されます。退勤時は「退勤」ボタンをタップしてください。休憩の開始・終了も同様にボタンで操作できます。',
    category: 'タイムカード',
    roles: ['admin', 'staff'],
  },
  {
    question: '打刻を間違えました。修正できますか？',
    answer: '管理者がタイムカード画面から手動で修正できます。スタッフの方は管理者に修正を依頼してください。',
    category: 'タイムカード',
    roles: ['admin', 'staff'],
  },
  {
    question: 'キオスクモードとは何ですか？',
    answer: 'ログイン画面の「出退勤キオスク」タブから利用できます。店舗に設置した共有端末で、スタッフが名前をタップするだけで出退勤を記録できる機能です。',
    category: 'タイムカード',
    roles: ['admin'],
  },
  // シフト管理（管理者向け）
  {
    question: 'シフトの作成方法は？',
    answer: 'ダッシュボードのカレンダーで日付をクリックし、スタッフ・時間を選択して登録します。「シフト管理」画面やテンプレート機能を使って一括登録も可能です。',
    category: 'シフト管理',
    roles: ['admin'],
  },
  {
    question: 'シフトを公開するには？',
    answer: 'ダッシュボードの右上にある「シフト公開」ボタンをクリックすると、その月のシフトがスタッフに公開されます。公開後はスタッフのダッシュボードでシフト表を確認できるようになります。',
    category: 'シフト管理',
    roles: ['admin'],
  },
  {
    question: 'テンプレート機能の使い方は？',
    answer: 'よく使うシフトパターン（例: 10:00〜15:00）をテンプレートとして登録しておくと、複数のスタッフ・日付にまとめて適用できます。「テンプレート」画面から作成してください。',
    category: 'シフト管理',
    roles: ['admin'],
  },
  // シフト確認（スタッフ向け）
  {
    question: '自分のシフトを確認するには？',
    answer: '「シフト表」メニューからダッシュボードを開くと、公開済みのシフトカレンダーを確認できます。管理者がシフトを公開するまでは表示されません。',
    category: 'シフト確認',
    roles: ['staff'],
  },
  // 希望シフト
  {
    question: '希望シフトの提出方法は？',
    answer: '「シフト希望提出」画面でカレンダーの日付をタップし、出勤可能・不可・希望の区分と時間帯を選択して提出します。管理者が設定した提出期限内に提出してください。',
    category: '希望シフト',
    roles: ['admin', 'staff'],
  },
  {
    question: '希望シフトの収集期間を設定するには？',
    answer: '「希望シフト収集」画面で対象月を選び、「収集を開始」ボタンから提出期限を設定します。期限を過ぎると自動的に収集が締め切られます。',
    category: '希望シフト',
    roles: ['admin'],
  },
  // 欠勤・ヘルプ
  {
    question: '欠勤連絡の方法は？',
    answer: '「欠勤連絡」画面で日付と理由を入力して送信します。管理者に通知が届きます。',
    category: '欠勤・ヘルプ',
    roles: ['admin', 'staff'],
  },
  {
    question: 'ヘルプ募集とは？',
    answer: 'スタッフが欠勤した場合、そのシフトの代わりに入れるスタッフを募集する機能です。「欠勤連絡」画面の「ヘルプ募集」タブから確認・申し出ができます。',
    category: '欠勤・ヘルプ',
    roles: ['admin', 'staff'],
  },
  // スタッフ管理
  {
    question: 'スタッフを追加するには？',
    answer: '「スタッフ管理」画面で「追加」ボタンから、名前・時給・表示色などを設定して登録します。PINログインを有効にすれば、スタッフはアプリからすぐに打刻を始められます。',
    category: 'スタッフ管理',
    roles: ['admin'],
  },
  {
    question: '会社PINとは？',
    answer: 'スタッフがPINログインやキオスクモードを使う際に必要な、会社を特定するための6桁のコードです。「会社管理」画面で確認できます。',
    category: 'スタッフ管理',
    roles: ['admin'],
  },
  // アカウント
  {
    question: 'パスワードを変更するには？',
    answer: '「設定」画面からパスワードを変更できます。現在のパスワードと新しいパスワードを入力してください。',
    category: 'アカウント',
    roles: ['admin'],
  },
]

export default function HelpPage() {
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const role = user?.role === 'admin' ? 'admin' : 'staff'
  const filteredFaqs = faqs.filter(f => {
    if (!f.roles.includes(role as 'admin' | 'staff')) return false
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)
  })

  const categories = [...new Set(filteredFaqs.map(f => f.category))]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="質問を検索..."
          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {categories.map(category => (
        <div key={category} className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{category}</h2>
          <div className="divide-y divide-gray-100">
            {filteredFaqs
              .filter(f => f.category === category)
              .map((faq, i) => {
                const globalIndex = faqs.indexOf(faq)
                const isOpen = openId === globalIndex
                return (
                  <div key={i}>
                    <button
                      onClick={() => setOpenId(isOpen ? null : globalIndex)}
                      className="w-full flex items-center justify-between py-3 text-left hover:text-blue-600 transition-colors"
                    >
                      <span className="text-sm font-medium text-gray-800 pr-4">{faq.question}</span>
                      <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <p className="pb-3 text-sm text-gray-600 leading-relaxed">{faq.answer}</p>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      ))}

      {filteredFaqs.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p>該当するヘルプが見つかりませんでした</p>
        </div>
      )}
    </div>
  )
}
