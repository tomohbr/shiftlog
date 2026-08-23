import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { Toaster } from 'react-hot-toast'
import { bootstrapNative } from './native/bootstrap'

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
      <App />
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
