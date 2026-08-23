import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { Keyboard, KeyboardResize } from '@capacitor/keyboard'
import { isNative, whenNative } from './platform'
import { initOfflinePunch } from './offlinePunch'

// ネイティブシェルの初期化。アプリ起動時に一度だけ呼ぶ。

export async function bootstrapNative(): Promise<void> {
  if (!isNative) return

  // セーフエリア（ノッチ・ホームインジケータ）の実測値を CSS 変数として使えるようにする
  document.documentElement.classList.add('is-native', 'is-ios')

  await whenNative(async () => {
    await StatusBar.setStyle({ style: Style.Light })
  })

  await whenNative(async () => {
    // 入力欄にフォーカスしたとき、WebView 自体を縮めてキーボードに隠れないようにする
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
    await Keyboard.setAccessoryBarVisible({ isVisible: true })
  })

  await whenNative(async () => {
    await initOfflinePunch()
  })

  await whenNative(async () => {
    await SplashScreen.hide()
  })
}
