import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Calendar } from 'lucide-react'

// 法的文書ページの共通レイアウト（未ログインでも表示できる独立ページ）。
// App Store はプライバシーポリシーの単独URLの提出を必須としているため、
// アプリ内・LP どちらからも同じURLで到達できるようにしてある。

export function LegalLayout({ title, updatedAt, children }: { title: string; updatedAt: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">シフトログ</span>
          </Link>
          <Link to="/login" className="text-sm text-blue-600 hover:text-blue-700 font-medium">ログイン</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{title}</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8 space-y-6 text-sm text-gray-700 leading-relaxed">
          {children}
        </div>
        <p className="text-xs text-gray-400 mt-6">最終更新日: {updatedAt}</p>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-400">
          <Link to="/legal/privacy" className="hover:text-gray-600 underline">プライバシーポリシー</Link>
          <Link to="/legal/terms" className="hover:text-gray-600 underline">利用規約</Link>
          <Link to="/legal/tokusho" className="hover:text-gray-600 underline">特定商取引法に基づく表記</Link>
        </div>
      </main>
    </div>
  )
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold text-gray-900">{heading}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc list-outside pl-5 space-y-1">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}
