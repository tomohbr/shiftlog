import { useState } from 'react'
import { MessageCircle, Send, Bug, Lightbulb, HelpCircle, MoreHorizontal, CheckCircle2 } from 'lucide-react'
import { feedbackApi, FeedbackCategory } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

const CATEGORIES: { id: FeedbackCategory; label: string; desc: string; icon: any; color: string }[] = [
  { id: 'bug', label: 'バグ報告', desc: '動作がおかしい・エラーが出る', icon: Bug, color: 'red' },
  { id: 'feature', label: '機能リクエスト', desc: 'こんな機能が欲しい', icon: Lightbulb, color: 'yellow' },
  { id: 'question', label: '使い方の質問', desc: '操作方法が分からない', icon: HelpCircle, color: 'blue' },
  { id: 'other', label: 'その他', desc: 'ご感想・ご意見など', icon: MoreHorizontal, color: 'gray' },
]

export default function FeedbackPage() {
  const { user } = useAuth()
  const [category, setCategory] = useState<FeedbackCategory>('feature')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(user?.email || '')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) {
      toast.error('メッセージを入力してください')
      return
    }
    setSubmitting(true)
    try {
      await feedbackApi.submit({ category, message: message.trim(), email: email.trim() || undefined })
      toast.success('フィードバックを送信しました。ありがとうございました！')
      setSubmitted(true)
      setMessage('')
    } catch (err: any) {
      toast.error(err.response?.data?.error || '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">ご協力ありがとうございました</h2>
          <p className="text-sm text-gray-600 mb-6">
            フィードバックを受け付けました。内容を確認のうえ、必要に応じてご連絡します。
          </p>
          <button
            type="button"
            onClick={() => { setSubmitted(false); setCategory('feature') }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg transition"
          >
            もう1件送る
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-6 border border-amber-100">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-amber-500 rounded-xl flex items-center justify-center shrink-0">
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 mb-1">フィードバック</h1>
            <p className="text-sm text-gray-600">
              バグ報告・機能リクエスト・ご質問などお気軽にお送りください。頂いた内容は開発の参考にさせていただきます。
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-3">カテゴリ</label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map(c => {
              const Icon = c.icon
              const selected = category === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`text-left border-2 rounded-lg p-3 transition ${
                    selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-4 h-4 ${selected ? 'text-blue-600' : 'text-gray-500'}`} />
                    <span className={`text-sm font-semibold ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
                      {c.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{c.desc}</p>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label htmlFor="message" className="block text-sm font-semibold text-gray-800 mb-2">
            メッセージ <span className="text-red-500">*</span>
          </label>
          <textarea
            id="message"
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={8}
            required
            maxLength={5000}
            placeholder="どんな状況でどんなことが起きたか、できるだけ具体的にお書きください。&#10;例：「シフト追加ボタンを押したら画面が真っ白になった。スマホ（iPhone）Safariで発生」"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="text-right text-xs text-gray-400 mt-1">{message.length} / 5000</div>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-semibold text-gray-800 mb-2">
            返信用メールアドレス <span className="text-gray-400 font-normal">（任意）</span>
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">返信が必要な場合のみ入力してください。空欄でも送信可能です。</p>
        </div>

        <button
          type="submit"
          disabled={submitting || !message.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition flex items-center justify-center gap-2"
        >
          <Send className="w-4 h-4" />
          {submitting ? '送信中...' : 'フィードバックを送信'}
        </button>

        <p className="text-xs text-gray-500 text-center">
          送信内容はアプリ改善のみに利用し、第三者には提供しません。
        </p>
      </form>
    </div>
  )
}
