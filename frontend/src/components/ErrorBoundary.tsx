import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, MessageSquare } from 'lucide-react'
import { reportError } from '../lib/errorReporting'

// 描画中の例外で画面が真っ白になるのを防ぎ、運営者に通知する。
// ユーザーには「再読み込み」と「不具合を報告」の2つの出口だけを見せる。

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, { source: 'ErrorBoundary', componentStack: (info.componentStack || '').slice(0, 1500) })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">問題が発生しました</h1>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            エラーは自動で開発者に送信されました。再読み込みで直ることが多いです。
            続く場合は、何をしようとしたかを添えて報告してください。
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mt-5">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium"
            >
              <RefreshCw className="w-4 h-4" /> 再読み込み
            </button>
            <a
              href="/feedback"
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium"
            >
              <MessageSquare className="w-4 h-4" /> 不具合を報告
            </a>
          </div>
          <p className="text-[11px] text-gray-400 mt-4 break-all">{this.state.error.message.slice(0, 160)}</p>
        </div>
      </div>
    )
  }
}
