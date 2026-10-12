import { useEffect, useState } from 'react'
import { CheckCircle2, UserPlus, Send, Loader2 } from 'lucide-react'
import { lineInviteApi } from '../api/client'

// LINE 招待の受け口（/i/:token）。管理者が渡した本人専用のQR/リンクから開く。ログイン不要。
// スタッフがやることは「自分か確認 → ①友だち追加 → ②コードを送る」だけ。
// 連携できたかは数秒おきに確かめて、できたらその場で完了を出す。

type Info = { name: string; company_name: string; configured: boolean; bot_name: string | null; add_friend_url: string | null; linked: boolean }

const LINE_GREEN = '#06C755'

export default function LineInvitePage({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState('')
  const [code, setCode] = useState<{ code: string; send_code_url: string } | null>(null)
  const [addedFriend, setAddedFriend] = useState(false)

  useEffect(() => {
    lineInviteApi.info(token)
      .then(r => setInfo(r.data))
      .catch(e => setError(e.response?.data?.error || '招待を開けませんでした'))
  }, [token])

  // コードは先に発行しておく（ボタンをただのリンクにして、スマホで確実に LINE が開くように）
  useEffect(() => {
    if (!info || info.linked || !info.configured || code) return
    lineInviteApi.code(token).then(r => setCode(r.data)).catch(() => {})
  }, [info, token, code])

  // 連携が済んだかを確かめる（LINE から戻ってきたときにすぐ分かるように）
  useEffect(() => {
    if (!info || info.linked) return
    const t = setInterval(() => {
      lineInviteApi.info(token).then(r => { if (r.data.linked) setInfo(r.data) }).catch(() => {})
    }, 4000)
    return () => clearInterval(t)
  }, [info, token])

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-4 text-center">
        {info && <p className="text-sm text-gray-500">{info.company_name}</p>}
        <h1 className="text-xl font-bold text-gray-900">シフトの連絡をLINEで受け取る</h1>
      </header>
      <main className="flex-1 w-full max-w-md mx-auto px-4 py-6 space-y-4">{children}</main>
    </div>
  )

  if (error) return shell(<p className="text-center text-gray-700 font-semibold py-10">{error}</p>)
  if (!info) return shell(<div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>)

  if (info.linked) {
    return shell(
      <div className="bg-white rounded-2xl border-2 p-6 text-center space-y-3" style={{ borderColor: LINE_GREEN }}>
        <CheckCircle2 className="w-16 h-16 mx-auto" style={{ color: LINE_GREEN }} />
        <p className="text-2xl font-bold text-gray-900">連携できました</p>
        <p className="text-base text-gray-700">{info.name}さんのLINEに、シフトの公開や希望の受付が届きます。</p>
        <p className="text-sm text-gray-600 bg-gray-50 rounded-xl p-3">
          LINEのトーク画面の下のメニューから、いつでも<br /><b>「シフトを見る」「希望を出す」</b>ができます。
        </p>
        {info.add_friend_url && (
          <a href={info.add_friend_url} className="block w-full py-4 rounded-xl text-white text-lg font-bold" style={{ backgroundColor: LINE_GREEN }}>
            LINEを開く
          </a>
        )}
      </div>
    )
  }

  if (!info.configured) {
    return shell(<p className="text-center text-gray-700 py-10">このお店はまだLINEの準備ができていません。お店の人に伝えてください。</p>)
  }

  return shell(
    <>
      <div className="bg-white rounded-2xl border border-gray-200 p-5 text-center">
        <p className="text-sm text-gray-500">この招待は</p>
        <p className="text-3xl font-bold text-gray-900 mt-1">{info.name} さん</p>
        <p className="text-sm text-gray-500 mt-1">専用です。ちがう場合はお店の人に伝えてください。</p>
      </div>

      {/* ① 友だち追加 */}
      <div className={`bg-white rounded-2xl border-2 p-5 space-y-3 ${addedFriend ? 'border-gray-200' : ''}`} style={addedFriend ? undefined : { borderColor: LINE_GREEN }}>
        <p className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <span className="w-8 h-8 rounded-full text-white flex items-center justify-center text-base" style={{ backgroundColor: addedFriend ? '#ADB5BD' : LINE_GREEN }}>1</span>
          友だち追加する
          {addedFriend && <CheckCircle2 className="w-5 h-5 text-gray-400 ml-auto" />}
        </p>
        <p className="text-sm text-gray-600">「{info.bot_name || 'お店のLINE'}」を友だちに追加します。追加したら、この画面に戻ってきてください。</p>
        {info.add_friend_url && (
          <a
            href={info.add_friend_url}
            onClick={() => setAddedFriend(true)}
            className="flex items-center justify-center gap-2 w-full py-4 rounded-xl text-white text-lg font-bold"
            style={{ backgroundColor: addedFriend ? '#ADB5BD' : LINE_GREEN }}
          >
            <UserPlus className="w-5 h-5" /> 友だち追加
          </a>
        )}
      </div>

      {/* ② コードを送る */}
      <div className="bg-white rounded-2xl border-2 p-5 space-y-3" style={{ borderColor: addedFriend ? LINE_GREEN : '#E9ECEF' }}>
        <p className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <span className="w-8 h-8 rounded-full text-white flex items-center justify-center text-base" style={{ backgroundColor: addedFriend ? LINE_GREEN : '#ADB5BD' }}>2</span>
          コードを送る
        </p>
        <p className="text-sm text-gray-600">ボタンを押すとLINEのトークが開きます。そのまま<b>送信</b>を押してください。</p>
        {code ? (
          <>
            <a
              href={code.send_code_url}
              className="flex items-center justify-center gap-2 w-full py-4 rounded-xl text-white text-lg font-bold"
              style={{ backgroundColor: LINE_GREEN }}
            >
              <Send className="w-5 h-5" /> LINEでコードを送る
            </a>
            <p className="text-xs text-gray-500 text-center">
              うまく開かないときは、トークにこの数字を送ってください<br />
              <span className="text-2xl font-bold tracking-[0.3em] text-gray-900 tabular-nums">{code.code}</span>
            </p>
          </>
        ) : (
          <div className="flex justify-center py-3"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        )}
      </div>

      <p className="text-center text-sm text-gray-500">送信すると、LINEに「連携できました」と返事が届きます。<br />この画面も自動で切り替わります。</p>
    </>
  )
}
