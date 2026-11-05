import { useEffect, useState } from 'react'
import { Printer, X } from 'lucide-react'
import { storesApi } from '../api/client'
import { PosterSheet, POSTER_PRINT_CSS, storeClockUrl } from './StoreQrPosterPage'

// 全会場の打刻用QRポスターを、1回の印刷でまとめて出す（A4縦・1会場1枚）。
// 店舗管理の「全会場のQRをまとめて印刷」から新しいタブで開く。
export default function AllStoresQrPosterPage() {
  const [sheets, setSheets] = useState<{ id: number; storeName: string; companyName: string; url: string }[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const stores = (await storesApi.getAll()).data.stores || []
        const out = []
        for (const st of [...stores].sort((a, b) => a.id - b.id)) {
          const res = await storesApi.getQr(st.id)
          out.push({ id: st.id, storeName: res.data.store.name, companyName: res.data.company_name, url: storeClockUrl(res.data.token) })
        }
        setSheets(out)
      } catch (e: any) {
        setError(e.response?.data?.error || 'QRを読み込めませんでした。もう一度開き直してください。')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading || error || sheets.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm px-6 text-center">
        {loading ? '読み込み中…' : error || '会場がまだありません。店舗管理で会場を追加してください。'}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <style>{POSTER_PRINT_CSS}</style>
      <div className="qr-poster-noprint sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          {sheets.map(s => s.storeName).join('・')} の{sheets.length}枚。A4で印刷して、それぞれのブースに貼ってください
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Printer className="w-4 h-4" />
            {sheets.length}枚まとめて印刷
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
      {sheets.map(s => <PosterSheet key={s.id} companyName={s.companyName} storeName={s.storeName} url={s.url} />)}
    </div>
  )
}
