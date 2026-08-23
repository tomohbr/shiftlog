import { NativeBiometric, BiometryType } from '@capgo/capacitor-native-biometric'
import { Preferences } from '@capacitor/preferences'
import { isNative } from './platform'

// Face ID / Touch ID。
//
// 2つの用途がある:
//   1) アプリロック — バックグラウンドから戻ったときに生体認証を要求する。
//      JWT の有効期限は90日で、端末を落とすと給与や連絡先まで見られてしまうため。
//   2) かんたんログイン — 保存した資格情報を Keychain から取り出してログインする。
//
// 資格情報は端末の Keychain にのみ保存し、サーバーには送らない。

const SERVER = 'shiftlog.app'
const APP_LOCK_KEY = 'shiftlog.appLock.enabled'
const QUICK_LOGIN_KEY = 'shiftlog.quickLogin.email'

export interface BiometricInfo {
  available: boolean
  /** 'Face ID' / 'Touch ID' / null */
  label: string | null
}

function labelFor(type: BiometryType): string | null {
  switch (type) {
    case BiometryType.FACE_ID: return 'Face ID'
    case BiometryType.TOUCH_ID: return 'Touch ID'
    case BiometryType.FINGERPRINT: return '指紋認証'
    case BiometryType.MULTIPLE: return '生体認証'
    default: return null
  }
}

export async function getBiometricInfo(): Promise<BiometricInfo> {
  if (!isNative) return { available: false, label: null }
  try {
    const result = await NativeBiometric.isAvailable({ useFallback: true })
    return {
      available: result.isAvailable,
      label: labelFor(result.biometryType) || (result.isAvailable ? '生体認証' : null),
    }
  } catch {
    return { available: false, label: null }
  }
}

/** 生体認証で本人確認する。成功なら true。 */
export async function verifyIdentity(reason: string): Promise<boolean> {
  if (!isNative) return true
  try {
    await NativeBiometric.verifyIdentity({
      reason,
      title: 'シフトログ',
      subtitle: reason,
      // 生体認証に失敗した端末でもパスコードで開けるようにする
      useFallback: true,
      fallbackTitle: 'パスコードを使う',
    })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// アプリロック
// ---------------------------------------------------------------------------

export async function isAppLockEnabled(): Promise<boolean> {
  if (!isNative) return false
  const { value } = await Preferences.get({ key: APP_LOCK_KEY })
  return value === '1'
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  await Preferences.set({ key: APP_LOCK_KEY, value: enabled ? '1' : '0' })
}

// ---------------------------------------------------------------------------
// かんたんログイン（Keychain に資格情報を保存）
// ---------------------------------------------------------------------------

export async function saveQuickLogin(email: string, password: string): Promise<void> {
  if (!isNative) return
  await NativeBiometric.setCredentials({ username: email, password, server: SERVER })
  await Preferences.set({ key: QUICK_LOGIN_KEY, value: email })
}

export async function getQuickLoginEmail(): Promise<string | null> {
  if (!isNative) return null
  const { value } = await Preferences.get({ key: QUICK_LOGIN_KEY })
  return value || null
}

/** 生体認証を通してから Keychain の資格情報を返す。拒否・未保存なら null。 */
export async function loadQuickLogin(): Promise<{ email: string; password: string } | null> {
  if (!isNative) return null
  const ok = await verifyIdentity('ログインのため本人確認を行います')
  if (!ok) return null
  try {
    const creds = await NativeBiometric.getCredentials({ server: SERVER })
    if (!creds?.username || !creds?.password) return null
    return { email: creds.username, password: creds.password }
  } catch {
    return null
  }
}

export async function clearQuickLogin(): Promise<void> {
  if (!isNative) return
  try { await NativeBiometric.deleteCredentials({ server: SERVER }) } catch { /* 未保存 */ }
  await Preferences.remove({ key: QUICK_LOGIN_KEY })
}
