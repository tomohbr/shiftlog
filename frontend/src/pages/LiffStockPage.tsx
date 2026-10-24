import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { invApi, liffApi } from '../api/client'
import InventoryApp from '../components/inventory/InventoryApp'

// LINE の中で開く在庫の画面（LIFF）。/liff/punch/:companyId/stock
// 打刻と同じ LIFF アプリを使う（https://liff.line.me/{LIFF ID}/stock で開く）。本人確認は LINE が行う。

declare global { interface Window { liff?: any } }

const LIFF_SDK = 'https://static.line-scdn.net/liff/edge/2/sdk.js'

function loadSdk(): Promise<any> {
  if (window.liff) return Promise.resolve(window.liff)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = LIFF_SDK
    s.onload = () => resolve(window.liff)
    s.onerror = () => reject(new Error('LINEの部品を読み込めませんでした'))
    document.head.appendChild(s)
  })
}

/** ?tab=load など。LIFF の転送途中（?liff.state=/stock?tab=load）でも読めるようにする */
function initialTab(): string | null {
  const q = new URLSearchParams(window.location.search)
  if (q.get('tab')) return q.get('tab')
  const state = q.get('liff.state')
  if (state) return new URLSearchParams(state.split('?')[1] || '').get('tab')
  return null
}

export default function LiffStockPage({ companyId }: { companyId: number }) {
  const [phase, setPhase] = useState<'loading' | 'error' | 'unlinked' | 'ready'>('loading')
  const [error, setError] = useState('')
  const [company, setCompany] = useState('')
  const [key, setKey] = useState('')
  const [tab] = useState(initialTab)

  useEffect(() => {
    (async () => {
      try {
        const cfg = await liffApi.config(companyId)
        setCompany(cfg.data.company_name)
        const liff = await loadSdk()
        await liff.init({ liffId: cfg.data.liff_id })
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return }
        const idToken = liff.getIDToken()
        if (!idToken) throw new Error('LINEの本人確認ができませんでした')
        const r = await liffApi.session(companyId, idToken)
        if (!r.data.linked) { setPhase('unlinked'); return }
        setKey(r.data.key)
        setPhase('ready')
      } catch (e: any) {
        setError(e.response?.data?.error || e.message || '開けませんでした')
        setPhase('error')
      }
    })()
  }, [companyId])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 text-center">
        <p className="text-xs text-gray-500">{company}</p>
        <p className="text-lg font-bold text-gray-900">在庫・閉店の締め</p>
      </header>
      <main className="w-full max-w-md mx-auto px-4 py-4">
        {phase === 'loading' && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}
        {phase === 'error' && <p className="text-center text-gray-800 font-semibold py-10">{error}</p>}
        {phase === 'unlinked' && <p className="text-center text-gray-800 py-10">まだシフトログと連携されていません。トークに名前とふりがなを送って連携してください。</p>}
        {phase === 'ready' && <InventoryApp api={invApi(key)} inLine initialTab={tab} />}
      </main>
    </div>
  )
}
