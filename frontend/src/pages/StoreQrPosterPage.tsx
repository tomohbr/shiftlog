import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, X, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { storesApi } from '../api/client'
import { isNative } from '../native/platform'

// 会場QRの打刻URL。Web は今開いているサーバー、iOS アプリは本番サーバーを指す
// （アプリ内は capacitor://localhost なので、そのままではスタッフのスマホから開けない）
export function storeClockUrl(token: string): string {
  const origin = isNative ? 'https://shiftlog-production.up.railway.app' : window.location.origin
  return `${origin}/q/${token}`
}

// 会場ごとの打刻用QRポスター（A4縦）。店舗管理の各店舗から新しいタブで開く独立ページ。
// レイアウト(サイドバー等)の外でレンダリングされるため、window.print()でポスターだけが印刷される。
export default function StoreQrPosterPage({ storeId }: { storeId: number }) {
  const [token, setToken] = useState('')
  const [storeName, setStoreName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')
  const [reissuing, setReissuing] = useState(false)

  useEffect(() => {
    storesApi.getQr(storeId)
      .then(res => {
        setToken(res.data.token)
        setStoreName(res.data.store.name)
        setCompanyName(res.data.company_name)
      })
      .catch((e: any) => setError(e.response?.data?.error || 'QRを読み込めませんでした。もう一度開き直してください。'))
  }, [storeId])

  const reissue = async () => {
    if (!confirm(`「${storeName}」の打刻用QRを作り直します。\n今貼ってあるポスターのQRは使えなくなるので、新しいポスターを印刷して貼り替えてください。`)) return
    setReissuing(true)
    try {
      const res = await storesApi.reissueQr(storeId)
      setToken(res.data.token)
      toast.success('QRを再発行しました。印刷して貼り替えてください')
    } catch (e: any) {
      toast.error(e.response?.data?.error || '再発行に失敗しました')
    } finally {
      setReissuing(false)
    }
  }

  if (error || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm px-6 text-center">
        {error || '読み込み中…'}
      </div>
    )
  }

  const url = storeClockUrl(token)

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
      <div className="qr-poster-noprint sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          A4で印刷して、会場のブースに貼ってください
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
            onClick={reissue}
            disabled={reissuing}
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${reissuing ? 'animate-spin' : ''}`} />
            QRを再発行
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
        <p className="text-lg font-semibold text-gray-500 tracking-widest break-words">{companyName}</p>
        <h1 className="text-5xl font-bold text-gray-900 mt-3 break-words leading-tight">
          {storeName}
        </h1>
        <p className="text-2xl font-bold text-gray-700 mt-6">
          出勤・休憩・退勤はここで打刻
        </p>
        <p className="text-base text-gray-500 mt-1">スタッフ専用｜スマホで読み取ってください</p>

        <div className="mt-10 border-4 border-gray-900 rounded-2xl p-6 bg-white">
          <QRCodeSVG value={url} size={340} />
        </div>

        <div className="mt-12 w-full max-w-md text-left space-y-5">
          {[
            { n: 1, title: 'スマホのカメラでQRを読み取る', sub: 'アプリのインストールやログインは不要です' },
            { n: 2, title: '初回だけ、自分の名前をタップ', sub: '次回からは名前選びなしで打刻画面が開きます' },
            { n: 3, title: '「出勤」「休憩」「退勤」を押す', sub: '時刻と会場名が大きく出たら完了です' },
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
          シフトログ ｜ 打刻時に不正防止のため位置情報を記録します（許可しなくても打刻できます）
        </p>
      </div>
    </div>
  )
}
