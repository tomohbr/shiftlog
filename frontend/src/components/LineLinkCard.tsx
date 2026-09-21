import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { MessageCircle, Check, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { lineApi } from '../api/client'
import { isNative } from '../native/platform'

// 「LINEで通知を受け取る」カード（スタッフ・管理者共通）。
// お店が LINE 公式アカウントを設定していない場合は何も出さない。
// 手順: ①友だち追加 → ②コード入りのトークを開いて送信 → 連携完了（Webhook 側で結びつける）

type LinkInfo = { code: string; minutes: number; bot_name: string | null; add_friend_url: string; send_code_url: string }

export default function LineLinkCard({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<{ configured: boolean; linked: boolean; bot_name: string | null } | null>(null)
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => lineApi.me().then(r => setState(r.data)).catch(() => setState(null))
  useEffect(() => { refresh() }, [])

  // コードを表示している間は、連携が済んだかを数秒おきに確認する
  useEffect(() => {
    if (!info || state?.linked) return
    const t = setInterval(() => {
      lineApi.me().then(r => {
        setState(r.data)
        if (r.data.linked) { setInfo(null); toast.success('LINE連携が完了しました') }
      }).catch(() => {})
    }, 4000)
    return () => clearInterval(t)
  }, [info, state?.linked])

  if (!state?.configured) return null

  const start = async () => {
    setBusy(true)
    try { setInfo((await lineApi.linkCode()).data) }
    catch (e: any) { toast.error(e.response?.data?.error || 'コードを発行できませんでした') }
    finally { setBusy(false) }
  }
  const unlink = async () => {
    if (!confirm('LINE通知を止めますか？')) return
    await lineApi.unlink().catch(() => {})
    refresh()
  }

  if (state.linked) {
    return (
      <div className="card p-4 flex items-center justify-between gap-3 border-green-200 bg-green-50">
        <p className="text-sm text-green-800 flex items-center gap-2">
          <Check className="w-4 h-4" /> LINE通知を受け取っています{state.bot_name ? `（${state.bot_name}）` : ''}
        </p>
        {!compact && <button onClick={unlink} className="text-xs text-gray-500 hover:text-gray-700 underline">解除</button>}
      </div>
    )
  }

  return (
    <div className="card p-4 border-green-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900 flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-green-500" /> シフトをLINEで受け取る
          </p>
          <p className="text-xs text-gray-500 mt-0.5">シフトが公開されたら、お店のLINEからお知らせが届きます。</p>
        </div>
        {!info && (
          <button onClick={start} disabled={busy} className="shrink-0 px-3 py-2 rounded-lg bg-green-500 text-white text-sm font-semibold hover:bg-green-600 disabled:opacity-50">
            {busy ? '準備中...' : '設定する'}
          </button>
        )}
      </div>

      {info && (
        <ol className="mt-4 space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">1</span>
            <div className="min-w-0">
              <p>「{info.bot_name || 'お店のLINE'}」を友だち追加</p>
              <a href={info.add_friend_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-semibold">
                友だち追加 <ExternalLink className="w-3 h-3" />
              </a>
              {!isNative && (
                <div className="hidden sm:block mt-2">
                  <QRCodeSVG value={info.add_friend_url} size={96} />
                  <p className="text-[11px] text-gray-400 mt-1">パソコンで見ている場合はスマホで読み取り</p>
                </div>
              )}
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">2</span>
            <div className="min-w-0">
              <p>連携コードをトークに送る</p>
              <p className="text-2xl font-mono font-bold tracking-widest text-gray-900 my-1">{info.code}</p>
              <a href={info.send_code_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-green-500 text-green-700 text-xs font-semibold">
                コードを入れてLINEを開く <ExternalLink className="w-3 h-3" />
              </a>
              <p className="text-[11px] text-gray-400 mt-1">開いたら「送信」を押すだけです（{info.minutes}分有効）</p>
            </div>
          </li>
          <li className="text-xs text-gray-500 pl-9">連携できると、LINEに「連携できました」と届き、この画面も自動で切り替わります。</li>
        </ol>
      )}
    </div>
  )
}
