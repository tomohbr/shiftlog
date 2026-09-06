/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** GA4測定ID。未設定ならアクセス解析を読み込まない */
  readonly VITE_GA_MEASUREMENT_ID?: string
  /** iOS アプリからの API 接続先。未設定なら本番URLを使う */
  readonly VITE_API_BASE_URL?: string
  /** アプリのバージョン（プッシュ通知の登録情報に付ける） */
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// 素のgtag.jsのキューと送信関数。
interface Window {
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
}
