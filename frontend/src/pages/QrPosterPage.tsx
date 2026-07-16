import { QRCodeSVG } from 'qrcode.react'
import { Printer, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { staffLoginUrl } from '../components/StaffLoginQR'

// 印刷用QRポスター（A4縦）。
// StaffPageのQRモーダル・希望収集開始モーダルから新しいタブで開く独立ページ。
// レイアウト(サイドバー等)の外でレンダリングされるため、window.print()でポスターだけが印刷される。
export default function QrPosterPage() {
  const { selectedCompany } = useAuth()
  const companyName = selectedCompany?.name || ''
  const companyPin = (selectedCompany as any)?.company_pin || ''

  if (!companyPin) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">
        会社情報を読み込めませんでした。もう一度開き直してください。
      </div>
    )
  }

  const url = staffLoginUrl(companyPin)

  return (
    <div className="min-h-screen bg-gray-100">
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        @media print {
          .qr-poster-noprint { display: none !important; }
          body { background: white !important; }
          .qr-poster-sheet {
            box-shadow: none !important;
            margin: 0 !important;
            width: auto !important;
            min-height: auto !important;
          }
        }
      `}</style>

      {/* 画面表示時だけのツールバー */}
      <div className="qr-poster-noprint sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          A4サイズで印刷して、レジ横やバックヤードに貼ってください
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Printer className="w-4 h-4" />
            印刷する
          </button>
          <button
            onClick={() => window.close()}
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <X className="w-4 h-4" />
            閉じる
          </button>
        </div>
      </div>

      {/* ポスター本体（A4縦を想定した1枚） */}
      <div className="qr-poster-sheet bg-white shadow-lg mx-auto my-6 max-w-[210mm] min-h-[280mm] px-12 py-14 flex flex-col items-center text-center">
        <p className="text-lg font-semibold text-gray-500 tracking-widest">シフトログ</p>
        <h1 className="text-4xl font-bold text-gray-900 mt-2 break-words leading-tight">
          {companyName}
        </h1>
        <p className="text-xl font-semibold text-gray-700 mt-6">
          スタッフのみなさんへ：シフトはここから
        </p>

        <div className="mt-10 border-4 border-gray-900 rounded-2xl p-6 bg-white">
          <QRCodeSVG value={url} size={340} />
        </div>

        <div className="mt-12 w-full max-w-md text-left space-y-5">
          {[
            { n: 1, title: 'スマホのカメラでQRを読み取る', sub: 'カメラを向けるだけでOKです' },
            { n: 2, title: '自分の名前をタップ', sub: 'PINやパスワードの入力は不要です' },
            { n: 3, title: '完了！', sub: 'シフト確認・希望シフトの提出ができます' },
          ].map(step => (
            <div key={step.n} className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center text-xl font-bold shrink-0">
                {step.n}
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900 leading-snug">{step.title}</p>
                <p className="text-sm text-gray-500 mt-0.5">{step.sub}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-auto pt-10 text-xs text-gray-400">
          ホーム画面に追加しておくと次回からアプリのように開けます（iPhone: 共有→ホーム画面に追加 / Android: メニュー→ホーム画面に追加）
        </p>
      </div>
    </div>
  )
}
