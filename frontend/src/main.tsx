import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { Toaster } from 'react-hot-toast'
import { bootstrapNative } from './native/bootstrap'
import { installErrorReporting } from './lib/errorReporting'
import ErrorBoundary from './components/ErrorBoundary'

import { captureAttribution } from './lib/attribution'
import { initializeAnalytics, trackCampaignLanding } from './lib/analytics'

// 描画前に初回流入を保存し、GA4の準備後に着地を計測する。
// 未処理の例外を運営者に届ける（最初に仕掛ける）
installErrorReporting()

captureAttribution()
initializeAnalytics()
trackCampaignLanding()

// ダークモード初期化（FOUCを避けるため最初に実行）
try {
  const t = localStorage.getItem('theme')
  if (t === 'dark') document.documentElement.classList.add('dark')
} catch {}

// iOS ネイティブシェルの初期化（ステータスバー・キーボード・オフライン打刻キュー）。
// Web では即座に何もせず返る。
void bootstrapNative()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#363636',
            color: '#fff',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
)
