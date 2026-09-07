import { attributionEventParams, getAttribution } from './attribution'
import { apiBaseUrl, isNative } from '../native/platform'

// 計測は2系統に送る。
//   1) GA4（VITE_GA_MEASUREMENT_ID があるときだけ）— 閲覧側の参考値
//   2) 自前サーバー（/api/telemetry/events）— 「誰がどの画面まで来て、どこで止まったか」を
//      会社・ユーザー単位で追うための確定値。GA4 が無くても動く
// どちらも失敗しても画面の動作には影響させない。

type EventParams = Record<string, string | number | boolean | undefined>

const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0'
const FLUSH_INTERVAL_MS = 5000
const MAX_QUEUE = 50

// ---------------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------------

// ID未設定時は読み込まず、読み込み中のイベントは公式方式でキューに積む。
export function initializeAnalytics() {
  try {
    const id = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim()
    if (!id || window.gtag) return
    window.dataLayer = window.dataLayer || []
    window.gtag = function () { window.dataLayer!.push(arguments) }
    window.gtag('js', new Date())
    window.gtag('config', id)
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
    document.head.appendChild(script)
  } catch { /* GA4が使えなくても起動を続ける */ }
}

// ---------------------------------------------------------------------------
// 自前サーバーへのイベント送信（まとめ送り）
// ---------------------------------------------------------------------------

interface QueuedEvent { event: string; path: string; meta?: EventParams; session_id: string }

let queue: QueuedEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let sessionId = ''

function getSessionId(): string {
  if (sessionId) return sessionId
  try {
    sessionId = sessionStorage.getItem('shiftlog_session') || ''
    if (!sessionId) {
      sessionId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      sessionStorage.setItem('shiftlog_session', sessionId)
    }
  } catch {
    sessionId = sessionId || Math.random().toString(36).slice(2, 10)
  }
  return sessionId
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const token = localStorage.getItem('token')
    const companyId = localStorage.getItem('selectedCompanyId')
    if (token) h['Authorization'] = `Bearer ${token}`
    if (companyId) h['X-Company-Id'] = companyId
  } catch { /* ストレージ不可 */ }
  return h
}

export function flushEvents(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (queue.length === 0) return
  const events = queue
  queue = []
  try {
    // keepalive: ページ離脱・アプリ切り替えの直前でも送り切る
    fetch(`${apiBaseUrl}/telemetry/events`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ platform: isNative ? 'ios' : 'web', app_version: APP_VERSION, events }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* 無視 */ }
}

function enqueue(event: string, meta?: EventParams): void {
  queue.push({ event, path: window.location.pathname, meta, session_id: getSessionId() })
  if (queue.length >= MAX_QUEUE) { flushEvents(); return }
  if (!timer) timer = setTimeout(flushEvents, FLUSH_INTERVAL_MS)
}

let hooksInstalled = false
function installFlushHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  window.addEventListener('pagehide', flushEvents)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushEvents() })
}

// ---------------------------------------------------------------------------
// 公開API
// ---------------------------------------------------------------------------

export function track(event: string, params: EventParams = {}) {
  try {
    const payload = { ...attributionEventParams(getAttribution()), ...params }
    if (typeof window.gtag === 'function') window.gtag('event', event, payload)
    else if (import.meta.env.DEV) console.debug('[analytics]', event, payload)
  } catch { /* 計測失敗は登録・購入・遷移に影響させない */ }
  try {
    installFlushHooks()
    enqueue(event, params)
  } catch { /* 無視 */ }
}

let lastPath = ''
/** 画面遷移。同じパスの連続は1回にまとめる */
export function trackPageView(path: string): void {
  if (path === lastPath) return
  lastPath = path
  try {
    if (typeof window.gtag === 'function') window.gtag('event', 'page_view', { page_path: path })
    installFlushHooks()
    enqueue('page_view')
  } catch { /* 無視 */ }
}

const sent = new Set<string>()
// 同一セッション・同一URLの着地は再読み込みでも重複送信しない。
export function trackCampaignLanding() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (!['source', 'medium', 'campaign', 'content'].some(key => params.get(`utm_${key}`))) return
    const key = `shiftlog_campaign_landing:${window.location.href}`
    if (sent.has(key)) return
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch { /* 保存拒否時はメモリで重複を防ぐ */ }
    sent.add(key)
    track('campaign_landing')
  } catch { /* URLやストレージの取得失敗は無視する */ }
}
