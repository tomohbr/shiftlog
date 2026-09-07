import { apiBaseUrl, isNative } from '../native/platform'

// クライアント側の例外を運営者に届ける。
//
// ユーザーが「動かない」と言ってくる前に気づくための仕組み。
// window.onerror / unhandledrejection / React の ErrorBoundary から呼ばれ、
// サーバー（/api/telemetry/error）に送る。サーバー側で同じエラーは6時間に1通に間引いてメールされる。
// 送信に失敗しても何もしない（計測のためにアプリを止めない）。

const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0'
const recent = new Map<string, number>()
const DEDUPE_MS = 60 * 1000

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const token = localStorage.getItem('token')
    const companyId = localStorage.getItem('selectedCompanyId')
    if (token) h['Authorization'] = `Bearer ${token}`
    if (companyId) h['X-Company-Id'] = companyId
  } catch { /* ストレージ不可 */ }
  return h
}

export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error))
    const message = (err.message || 'Unknown error').slice(0, 1000)
    // 開発中のノイズと、同じ例外の連打を抑える
    if (/ResizeObserver loop|Script error\.?$/.test(message)) return
    const key = message + '|' + (err.stack || '').split('\n')[1]
    const now = Date.now()
    if (recent.has(key) && now - (recent.get(key) as number) < DEDUPE_MS) return
    recent.set(key, now)

    const body = JSON.stringify({
      message,
      stack: (err.stack || '').slice(0, 4000),
      platform: isNative ? 'ios' : 'web',
      app_version: APP_VERSION,
      path: window.location.pathname,
      context,
    })
    fetch(`${apiBaseUrl}/telemetry/error`, { method: 'POST', headers: authHeaders(), body, keepalive: true }).catch(() => {})
  } catch { /* 報告自体の失敗は無視 */ }
}

let installed = false

/** 起動時に一度だけ呼ぶ。未処理例外と Promise の拒否を拾う。 */
export function installErrorReporting(): void {
  if (installed) return
  installed = true
  window.addEventListener('error', event => {
    reportError(event.error || event.message, { source: 'window.onerror', file: event.filename, line: event.lineno })
  })
  window.addEventListener('unhandledrejection', event => {
    const reason = (event as PromiseRejectionEvent).reason
    // API の 4xx（入力エラーなど）は画面側でトーストされるので、通知対象にしない
    const status = reason?.response?.status
    if (typeof status === 'number' && status < 500) return
    reportError(reason, { source: 'unhandledrejection', status })
  })
}
