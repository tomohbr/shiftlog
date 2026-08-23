/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** iOS アプリからの API 接続先。未設定なら本番URLを使う */
  readonly VITE_API_BASE_URL?: string
  /** アプリのバージョン（プッシュ通知の登録情報に付ける） */
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
