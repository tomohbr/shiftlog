import { PushNotifications } from '@capacitor/push-notifications'
import { api } from '../api/client'
import { isNative } from './platform'

// APNs プッシュ通知。
//
// 通知するのは実際に起きた出来事だけ:
//   - シフトが確定・公開された
//   - 交代依頼が届いた / 成立した / 断られた
//   - 欠勤が出てヘルプを募集している
//   - シフト希望の受付が始まった
//
// 通知許可のダイアログはアプリ起動直後には出さず、ログイン後に出す。
// 何のための通知か分からない状態で聞かれると、ほぼ拒否されるため。

let currentToken: string | null = null
let listenersBound = false

type NavigateHandler = (path: string) => void
let navigateHandler: NavigateHandler | null = null

export function setPushNavigateHandler(handler: NavigateHandler | null): void {
  navigateHandler = handler
}

async function bindListeners(): Promise<void> {
  if (listenersBound) return
  listenersBound = true

  await PushNotifications.addListener('registration', token => {
    currentToken = token.value
    api.post('/push/device', {
      token: token.value,
      platform: 'ios',
      // TestFlight・App Store 版は production、Xcode から直接入れたビルドは sandbox。
      // aps-environment に合わせてサーバー側の送信先が決まる。
      environment: import.meta.env.DEV ? 'sandbox' : 'production',
      app_version: import.meta.env.VITE_APP_VERSION || '1.0.0',
    }).catch(e => console.warn('[push] デバイストークンの登録に失敗', e))
  })

  await PushNotifications.addListener('registrationError', err => {
    console.warn('[push] 登録エラー', err)
  })

  // 通知をタップしてアプリが開かれたとき、該当画面へ移動する
  await PushNotifications.addListener('pushNotificationActionPerformed', action => {
    const path = (action.notification?.data as any)?.path
    if (path && navigateHandler) navigateHandler(path)
  })
}

/** 通知の許可を求めて APNs に登録する。既に拒否済みなら何もしない。 */
export async function registerPush(): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!isNative) return 'unavailable'
  try {
    await bindListeners()

    let permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions()
    }
    if (permission.receive !== 'granted') return 'denied'

    await PushNotifications.register()
    return 'granted'
  } catch (e) {
    console.warn('[push] 初期化に失敗', e)
    return 'unavailable'
  }
}

/** 既に許可済みのときだけ静かに再登録する（許可ダイアログを出さない） */
export async function registerPushIfAllowed(): Promise<void> {
  if (!isNative) return
  try {
    const permission = await PushNotifications.checkPermissions()
    if (permission.receive !== 'granted') return
    await bindListeners()
    await PushNotifications.register()
  } catch (e) {
    console.warn('[push] 再登録に失敗', e)
  }
}

/** ログアウト時にこの端末宛の通知を止める */
export async function unregisterPush(token: string): Promise<void> {
  if (!isNative || !currentToken) return
  try {
    await api.delete('/push/device', { data: { token: currentToken }, headers: { Authorization: `Bearer ${token}` } })
  } catch {
    /* 失敗しても次のログインで付け替わる */
  }
}

export async function getPushPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'> {
  if (!isNative) return 'unavailable'
  try {
    const permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'granted') return 'granted'
    if (permission.receive === 'denied') return 'denied'
    return 'prompt'
  } catch {
    return 'unavailable'
  }
}
