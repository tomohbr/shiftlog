import type { CapacitorConfig } from '@capacitor/cli'

// iOS ネイティブシェルの設定。
// WebView が読むのは常にバンドル済みのローカルアセット（webDir）で、
// リモートURLを直接読ませる server.url は使わない。
// - Guideline 4.2「Webサイトのラッパー」で弾かれやすい
// - オフライン打刻が成立しない
const config: CapacitorConfig = {
  appId: 'com.tomohbr.shiftlog',
  appName: 'シフトログ',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    backgroundColor: '#ffffff',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#2563EB',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
