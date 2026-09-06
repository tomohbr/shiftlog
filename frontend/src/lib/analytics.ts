import { attributionEventParams, getAttribution } from './attribution'

type EventParams = Record<string, string | number | boolean | undefined>

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

export function track(event: string, params: EventParams = {}) {
  try {
    const payload = { ...attributionEventParams(getAttribution()), ...params }
    if (typeof window.gtag === 'function') window.gtag('event', event, payload)
    else if (import.meta.env.DEV) console.debug('[analytics]', event, payload)
  } catch { /* 計測失敗は登録・購入・遷移に影響させない */ }
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
