import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, X, Copy, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { lineApi, storesApi, Store } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { storeColorMap } from '../lib/storeColors'

// スタッフ向けの「使い方」。A4 1枚に印刷して配る／同じ内容を LINE で送る（管理者用、/staff-guide）。
// お店の名前・LINE アカウント・休みの電話・会場は設定から自動で入る。
// スタッフがやることは「招待QRで連携」と「LINE のメニューを押す」だけ、が伝わることを優先する。

export default function StaffGuidePage() {
  const { selectedCompany } = useAuth()
  const [line, setLine] = useState<any>(null)
  const [stores, setStores] = useState<Store[]>([])

  useEffect(() => {
    lineApi.getSettings().then(r => setLine(r.data.settings)).catch(() => {})
    storesApi.getAll().then(r => setStores(r.data.stores || [])).catch(() => {})
  }, [])

  const company = selectedCompany?.name || ''
  const bot = line?.bot_name || 'お店のLINE'
  const addFriend = line?.bot_basic_id ? `https://line.me/R/ti/p/${encodeURIComponent(line.bot_basic_id)}` : ''
  const phone = line?.absence_phone || ''
  const days = line?.absence_phone_days
  const phoneWhen = days === 0 ? '当日' : days === 1 ? '前日・当日' : days ? `${days}日前から当日まで` : ''
  const hasLiff = !!line?.liff_id
  const sorted = [...stores].sort((a, b) => a.id - b.id)
  const colorOf = storeColorMap(stores)

  const message = [
    `【${company}】シフトの連絡はLINEで行います`,
    '',
    '■ はじめに（1回だけ）',
    `お店からもらう「LINE招待」のQRを読んで、①友だち追加 ②コードを送る を押してください。（${bot}）`,
    '',
    '■ いつもの使い方（LINEのトーク画面の下のメニュー）',
    '・シフトを見る … 自分とみんなの予定',
    '・希望を出す … 出られる日を ◎○× で提出',
    `・休みの連絡 … 休むシフトを選んで店長に連絡${phoneWhen && phone ? `（${phoneWhen}は必ず電話 ${phone}）` : ''}`,
    hasLiff ? '・打刻する … ブースのQRを読んで 出勤／休憩／退勤' : '・打刻 … ブースのQRを読んで 出勤／休憩／退勤',
    '',
    'ログインやアプリのインストールは要りません。',
  ].join('\n')

  return (
    <div className="min-h-screen bg-gray-100">
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print { .noprint { display: none !important; } body { background: white !important; } .sheet { box-shadow: none !important; margin: 0 !important; } }
      `}</style>

      <div className="noprint sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-700 mr-auto">スタッフ向けの使い方（印刷して配る・LINEで送る）</p>
        <button onClick={() => window.print()} className="btn-primary flex items-center gap-1.5"><Printer className="w-4 h-4" />印刷する</button>
        <a href={`https://line.me/R/share?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg bg-[#06C755] text-white text-sm font-bold flex items-center gap-1.5"><Send className="w-4 h-4" />LINEで送る</a>
        <button onClick={() => { navigator.clipboard.writeText(message); toast.success('案内文をコピーしました') }} className="btn-secondary flex items-center gap-1.5"><Copy className="w-4 h-4" />文面をコピー</button>
        <button onClick={() => window.close()} className="btn-secondary flex items-center gap-1.5"><X className="w-4 h-4" />閉じる</button>
      </div>

      <div className="overflow-x-auto">
        <div className="sheet mx-auto my-6 bg-white shadow w-[210mm] min-h-[277mm] px-[14mm] py-[12mm] text-gray-900">
          <p className="text-sm text-gray-500">{company}</p>
          <h1 className="text-[28px] font-bold leading-tight">シフトの連絡は、ぜんぶLINEで</h1>
          <p className="text-base text-gray-600 mt-1">ログインもアプリのインストールも要りません。</p>

          {/* 1. はじめに */}
          <section className="mt-6 rounded-2xl border-2 border-[#06C755] p-5 flex gap-5 items-center">
            <div className="flex-1">
              <p className="text-sm font-bold text-[#06C755]">はじめに（1回だけ）</p>
              <p className="text-xl font-bold mt-1">お店からもらう「LINE招待」のQRを読む</p>
              <ol className="mt-2 space-y-1 text-base">
                <li><b>①</b> スマホのカメラで、自分の名前が書いた招待QRを読む</li>
                <li><b>②</b>「友だち追加」を押す（{bot}）</li>
                <li><b>③</b>「コードを送る」を押して、そのまま送信</li>
              </ol>
              <p className="text-sm text-gray-500 mt-2">「連携できました」とLINEに届けば完了です。</p>
            </div>
            {addFriend && (
              <div className="text-center shrink-0">
                <QRCodeSVG value={addFriend} size={104} />
                <p className="text-[11px] text-gray-500 mt-1">先に友だち追加だけ<br />したい人はこちら</p>
              </div>
            )}
          </section>

          {/* 2. メニュー */}
          <section className="mt-6">
            <p className="text-sm font-bold text-gray-500">いつもの使い方</p>
            <p className="text-xl font-bold">LINEのトーク画面の下の「メニュー」を押すだけ</p>
            <img src="/guide-menu.png" alt="LINEのメニュー（シフトを見る・希望を出す・休みの連絡・打刻する）" className="w-full mt-3 rounded-xl border border-gray-200" />
            <div className="grid grid-cols-2 gap-3 mt-4">
              {[
                ['#1C7ED6', 'シフトを見る', '自分の予定と、みんなの予定（どの会場に誰がいるか）がカレンダーで見られます。'],
                ['#2F9E44', '希望を出す', '受付中の月に、出られる日を ◎入りたい ○入れる ×入れない で出します。締切まで直せます。'],
                ['#E03131', '休みの連絡', `休むシフトを選んで理由を押すと、店長に届きます。${phoneWhen ? `\n${phoneWhen}のお休みは、必ず電話してください。` : ''}`],
                ['#E8590C', hasLiff ? '打刻する' : '打刻', '出勤・休憩・退勤のときに押して、ブースに貼ってあるQRを読みます。自分の分しか打刻できません。'],
              ].map(([color, title, body]) => (
                <div key={title} className="rounded-xl border border-gray-200 p-4">
                  <p className="text-lg font-bold" style={{ color }}>{title}</p>
                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-line">{body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 3. 電話 */}
          {phoneWhen && phone && (
            <section className="mt-6 rounded-2xl bg-red-50 border-2 border-red-300 p-5">
              <p className="text-lg font-bold text-red-700">{phoneWhen}のお休みは、必ず電話で</p>
              <p className="text-[32px] font-bold tabular-nums mt-1">📞 {phone}</p>
            </section>
          )}

          {/* 4. 会場 */}
          {sorted.length > 0 && (
            <section className="mt-6">
              <p className="text-sm font-bold text-gray-500">会場（シフトやLINEでは、この色で表示されます）</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {sorted.map(st => (
                  <span key={st.id} className="px-4 py-1.5 rounded-full text-white text-base font-bold" style={{ backgroundColor: colorOf(st.id).solid }}>{st.name}</span>
                ))}
              </div>
            </section>
          )}

          <p className="mt-8 text-sm text-gray-500">わからないことがあれば、LINEのトークに「シフト」「希望」「休み」「打刻」と送っても案内が届きます。</p>
        </div>
      </div>
    </div>
  )
}
