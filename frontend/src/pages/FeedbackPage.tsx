import { useState } from 'react'
import { Send } from 'lucide-react'
import { feedbackApi } from '../api/client'
import toast from 'react-hot-toast'

export default function FeedbackPage() {
  const [category, setCategory] = useState('general')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
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
      await feedbackApi.submit({ category, subject: subject || undefined, message })
      toast.success('フィードバックを送信しました')
      setSubmitted(true)
    } catch {
      toast.error('送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card text-center py-12">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Send className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">送信完了</h2>
          <p className="text-gray-600 mb-6">フィードバックをお送りいただきありがとうございます。</p>
          <button
            onClick={() => { setSubmitted(false); setCategory('general'); setSubject(''); setMessage('') }}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            別のフィードバックを送る
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">フィードバック</h2>
        <p className="text-sm text-gray-500 mb-6">ご意見・ご要望・バグ報告などをお聞かせください。</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="general">一般</option>
              <option value="feature">機能リクエスト</option>
              <option value="bug">バグ報告</option>
              <option value="question">質問</option>
              <option value="other">その他</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">件名（任意）</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="件名を入力"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メッセージ <span className="text-red-500">*</span></label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="詳細を入力してください"
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !message.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
            {submitting ? '送信中...' : '送信する'}
          </button>
        </form>
      </div>
    </div>
  )
}
