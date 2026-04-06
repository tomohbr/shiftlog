import { useState } from 'react'
import { Calendar, Clock, ClipboardList, AlertCircle, LayoutDashboard, Users, CheckCircle } from 'lucide-react'
import { authApi } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

interface Step {
  icon: React.ElementType
  title: string
  description: string
}

const adminSteps: Step[] = [
  {
    icon: Calendar,
    title: 'シフトログへようこそ',
    description: 'シフトログは飲食店のシフト管理を簡単にするアプリです。シフト作成、タイムカード、希望シフト収集がこれ一つで完結します。',
  },
  {
    icon: Users,
    title: 'スタッフを登録しよう',
    description: '「スタッフ管理」からスタッフの名前・時給・表示色を登録します。会社PINを共有すれば、スタッフはスマホからすぐにログインできます。',
  },
  {
    icon: LayoutDashboard,
    title: 'シフトを作成・公開',
    description: 'ダッシュボードのカレンダーをクリックしてシフトを作成します。「シフト公開」ボタンを押すと、スタッフがシフト表を確認できるようになります。',
  },
  {
    icon: Clock,
    title: 'タイムカードで打刻管理',
    description: 'スタッフはスマホから出勤・退勤を打刻できます。キオスクモードを使えば、店舗の共有端末でも打刻が可能です。',
  },
  {
    icon: CheckCircle,
    title: '準備完了！',
    description: 'これで基本的な使い方は以上です。不明な点は「ヘルプ」メニューをご確認ください。「フィードバック」からご意見もお待ちしています。',
  },
]

const staffSteps: Step[] = [
  {
    icon: Calendar,
    title: 'シフトログへようこそ',
    description: 'シフトログはシフト管理アプリです。出退勤の打刻やシフトの確認、希望シフトの提出ができます。',
  },
  {
    icon: Clock,
    title: '出勤・退勤の打刻',
    description: 'タイムカード画面で「出勤」ボタンをタップして出勤を記録します。退勤時は「退勤」ボタンをタップしてください。',
  },
  {
    icon: LayoutDashboard,
    title: 'シフト表の確認',
    description: '「シフト表」メニューから、管理者が公開したシフトカレンダーを確認できます。全スタッフのシフトが一覧で見られます。',
  },
  {
    icon: ClipboardList,
    title: '希望シフトの提出',
    description: '「シフト希望提出」から、出勤可能な日時や希望を管理者に伝えられます。提出期限内に忘れずに提出しましょう。',
  },
  {
    icon: AlertCircle,
    title: '欠勤連絡・ヘルプ',
    description: '急な欠勤時は「欠勤連絡」から管理者に連絡できます。他のスタッフの欠勤シフトに代わりに入る「ヘルプ」機能もあります。',
  },
]

export default function OnboardingModal() {
  const { user, setUser } = useAuth()
  const [step, setStep] = useState(0)

  const steps = user?.role === 'admin' ? adminSteps : staffSteps
  const current = steps[step]
  const Icon = current.icon
  const isLast = step === steps.length - 1

  const handleComplete = async () => {
    try {
      await authApi.completeOnboarding()
      if (user) {
        setUser({ ...user, has_seen_onboarding: 1 })
      }
    } catch {
      // 失敗しても閉じる
      if (user) {
        setUser({ ...user, has_seen_onboarding: 1 })
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Progress */}
        <div className="flex gap-1 px-6 pt-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-1 rounded-full transition-colors ${i <= step ? 'bg-blue-600' : 'bg-gray-200'}`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-8 text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Icon className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-3">{current.title}</h2>
          <p className="text-sm text-gray-600 leading-relaxed">{current.description}</p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex items-center justify-between">
          <button
            onClick={handleComplete}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            スキップ
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                戻る
              </button>
            )}
            <button
              onClick={isLast ? handleComplete : () => setStep(s => s + 1)}
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              {isLast ? 'はじめる' : '次へ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
