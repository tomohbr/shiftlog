export type Attribution = {
  source: string
  medium: string
  campaign: string
  content: string
  landing_path: string
  referrer: string
}

const STORAGE_KEY = 'shiftlog_attribution'
const MAX_AGE = 30 * 24 * 60 * 60 * 1000
const emptyAttribution: Attribution = {
  source: 'direct', medium: 'none', campaign: 'none', content: 'none',
  landing_path: 'unknown', referrer: '',
}
type StoredAttribution = Attribution & { expires_at: number }
let memory: StoredAttribution | null = null

// 保存拒否・破損・期限切れでも画面表示を妨げない。
function readStored(): StoredAttribution | null {
  const candidates: StoredAttribution[] = []
  if (memory && memory.expires_at > Date.now()) candidates.push(memory)
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[name]
      const raw = storage.getItem(STORAGE_KEY)
      if (!raw) continue
      const value = JSON.parse(raw)
      if (!value || typeof value.expires_at !== 'number' || value.expires_at <= Date.now()
        || !Object.keys(emptyAttribution).every(key => typeof value[key] === 'string')) {
        storage.removeItem(STORAGE_KEY)
        continue
      }
      candidates.push(value)
    } catch { /* ストレージが使えない場合はメモリに保持する */ }
  }
  // 複数タブの保存値が異なる場合も最初の流入を優先する。
  return candidates.sort((a, b) => a.expires_at - b.expires_at)[0] || null
}

export function captureAttribution(): Attribution {
  try {
    const params = new URLSearchParams(window.location.search)
    memory = readStored() || {
      source: params.get('utm_source') || 'direct',
      medium: params.get('utm_medium') || 'none',
      campaign: params.get('utm_campaign') || 'none',
      content: params.get('utm_content') || 'none',
      landing_path: window.location.pathname,
      referrer: document.referrer,
      expires_at: Date.now() + MAX_AGE,
    }
    for (const name of ['sessionStorage', 'localStorage'] as const) {
      try { window[name].setItem(STORAGE_KEY, JSON.stringify(memory)) } catch { /* 保存失敗は無視する */ }
    }
  } catch { /* 計測失敗はアプリに伝播させない */ }
  return getAttribution()
}

export function getAttribution(): Attribution {
  const stored = readStored()
  if (!stored) return { ...emptyAttribution }
  const { source, medium, campaign, content, landing_path, referrer } = stored
  return { source, medium, campaign, content, landing_path, referrer }
}

// 参考実装と同じ GA4 のキャンペーンパラメータ名に揃える。
export function attributionEventParams(attribution: Attribution) {
  return {
    campaign_source: attribution.source,
    campaign_medium: attribution.medium,
    campaign_name: attribution.campaign,
    campaign_content: attribution.content,
    landing_path: attribution.landing_path,
    referrer: attribution.referrer,
  }
}
