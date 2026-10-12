import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { X, CheckCircle2, Copy, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { lineApi } from '../api/client'

// スタッフ1人分の LINE 招待（管理者用）。その場でQRを読んでもらうか、リンクを送る。
// スタッフ側はログインもPINも要らず、①友だち追加 ②コードを送る だけで連携が終わる（pages/LineInvitePage）。

export default function LineInviteModal({ userId, name, onClose, onLoginGuide }: {
  userId: number
  name: string
  onClose: () => void
  onLoginGuide?: () => void
}) {
  const [url, setUrl] = useState('')
  const [linked, setLinked] = useState(false)
  const [companyName, setCompanyName] = useState('')

  const load = () => lineApi.inviteLinks([userId]).then(r => {
    const l = r.data.links[0]
    if (l) { setUrl(l.url); setLinked(l.linked) }
    setCompanyName(r.data.company_name)
  })
  useEffect(() => { load().catch(() => toast.error('招待を作れませんでした')) }, [userId])

  // 目の前で読んでもらったときに、連携できたらすぐ分かるように
  useEffect(() => {
    if (linked || !url) return
    const t = setInterval(() => { load().catch(() => {}) }, 4000)
    return () => clearInterval(t)
  }, [linked, url])

  const message = `【${companyName}】シフトの連絡をLINEで受け取れるようにします。\n下のリンクを開いて、①友だち追加 ②コードを送る の2つを押してください（${name}さん専用・ログイン不要）\n${url}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-4">
          <h3 className="text-lg font-bold text-gray-900">{name}さんのLINE招待</h3>
          <button onClick={onClose} aria-label="閉じる"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-5 space-y-4 text-center">
          {linked ? (
            <div className="py-6 space-y-2">
              <CheckCircle2 className="w-14 h-14 mx-auto text-[#06C755]" />
              <p className="text-xl font-bold text-gray-900">連携済みです</p>
              <p className="text-sm text-gray-600">シフトの公開・希望の受付がLINEで届きます。</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600">スマホのカメラでこのQRを読んでもらうか、リンクを送ってください。<br /><b>ログインもPINも要りません。</b></p>
              <div className="inline-block p-3 bg-white border-2 border-gray-900 rounded-2xl max-w-full">
                {url ? <QRCodeSVG value={url} size={200} style={{ width: "100%", height: "auto", maxWidth: 200 }} /> : <div className="w-[200px] max-w-full aspect-square" />}
              </div>
              <p className="text-xs text-gray-500">読み取ったら ①友だち追加 ②コードを送る を押すだけ。<br />連携できると、ここが「連携済み」に変わります。</p>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`https://line.me/R/share?text=${encodeURIComponent(message)}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-white font-bold bg-[#06C755]"
                >
                  <Send className="w-4 h-4" /> LINEで送る
                </a>
                <button
                  onClick={() => { navigator.clipboard.writeText(message); toast.success('案内文をコピーしました') }}
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold border border-gray-300 text-gray-700"
                >
                  <Copy className="w-4 h-4" /> コピー
                </button>
              </div>
            </>
          )}
          {onLoginGuide && (
            <button onClick={onLoginGuide} className="text-xs text-gray-500 underline">LINEを使わない人向けのログイン案内</button>
          )}
        </div>
      </div>
    </div>
  )
}
