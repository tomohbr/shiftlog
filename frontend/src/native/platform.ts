import { Capacitor } from '@capacitor/core'

// ネイティブシェル（iOS アプリ）で動いているかどうかの判定と、その周辺の共通設定。
//
// ブラウザ（Web）とネイティブでは以下が変わる:
//   - API の宛先: Web は同一オリジンの /api、ネイティブは本番サーバーの絶対URL
//   - 課金導線:   Web は Stripe、iOS は App内課金（Guideline 3.1.1）
//   - 打刻:       ネイティブはオフラインキューを経由する

export const isNative = Capacitor.isNativePlatform()
export const isIOS = Capacitor.getPlatform() === 'ios'

// ネイティブはローカルアセットを読む（capacitor://localhost）ため、
// 相対パスの /api では自分自身を指してしまう。必ず絶対URLを使う。
const PRODUCTION_API = 'https://shiftlog-production.up.railway.app'

export const apiOrigin: string = isNative
  ? (import.meta.env.VITE_API_BASE_URL || PRODUCTION_API).replace(/\/$/, '')
  : ''

export const apiBaseUrl = `${apiOrigin}/api`

/** ネイティブのときだけ実行する。Web では何もしない（プラグイン未実装で落ちるのを防ぐ） */
export async function whenNative(fn: () => Promise<void> | void): Promise<void> {
  if (!isNative) return
  try {
    await fn()
  } catch (e) {
    console.warn('[native]', e)
  }
}
