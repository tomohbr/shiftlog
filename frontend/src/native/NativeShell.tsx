import { ReactNode, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App as CapApp } from '@capacitor/app'
import { Preferences } from '@capacitor/preferences'
import { Bell, Fingerprint, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { isNative } from './platform'
import { getBiometricInfo, isAppLockEnabled, verifyIdentity } from './biometric'
import { getPushPermission, registerPush, registerPushIfAllowed, setPushNavigateHandler } from './push'
import { setFlushHandler, ACTION_LABELS } from './offlinePunch'
import toast from 'react-hot-toast'

// iOS アプリ側だけで必要な振る舞いをまとめた薄いシェル。
//   - アプリロック（バックグラウンドから戻ったら Face ID を要求）
//   - プッシュ通知の登録と、通知タップ時の画面遷移
//   - オフライン打刻が自動同期されたときの通知
// Web ではすべて no-op で、children をそのまま返す。

const PUSH_PROMPT_SHOWN_KEY = 'shiftlog.pushPromptShown'

// この秒数を超えてバックグラウンドにいたらロックする（一瞬の切り替えでは聞かない）
const LOCK_AFTER_SECONDS = 60

export default function NativeShell({ children }: { children: ReactNode }) {
  if (!isNative) return <>{children}</>
  return <NativeShellInner>{children}</NativeShellInner>
}

function NativeShellInner({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [locked, setLocked] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [biometryLabel, setBiometryLabel] = useState('Face ID')
  const [showPushPrompt, setShowPushPrompt] = useState(false)
  const backgroundedAt = useRef<number | null>(null)

  // 通知タップで該当画面へ
  useEffect(() => {
    setPushNavigateHandler(path => navigate(path))
    return () => setPushNavigateHandler(null)
  }, [navigate])

  // オフライン打刻が自動で同期されたときに知らせる
  useEffect(() => {
    setFlushHandler(result => {
      if (result.synced > 0) toast.success(`未同期だった打刻${result.synced}件を送信しました`)
      result.rejected.forEach(r => {
        toast.error(
          `${r.entry.user_name}さんの${ACTION_LABELS[r.entry.action]}（${r.entry.recorded_at.replace('T', ' ')}）を同期できませんでした: ${r.reason}`,
          { duration: 10000 }
        )
      })
    })
    return () => setFlushHandler(null)
  }, [])

  // 生体認証の種類（表示用）
  useEffect(() => {
    void getBiometricInfo().then(info => {
      if (info.label) setBiometryLabel(info.label)
    })
  }, [])

  // 起動時のロック
  useEffect(() => {
    if (!user) return
    void isAppLockEnabled().then(enabled => {
      if (enabled) setLocked(true)
    })
  }, [user?.id])

  // バックグラウンド復帰時のロック
  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null
    void CapApp.addListener('appStateChange', async state => {
      if (!state.isActive) {
        backgroundedAt.current = Date.now()
        return
      }
      const away = backgroundedAt.current ? (Date.now() - backgroundedAt.current) / 1000 : 0
      backgroundedAt.current = null
      if (away < LOCK_AFTER_SECONDS) return
      if (!localStorage.getItem('token')) return
      if (await isAppLockEnabled()) setLocked(true)
    }).then(h => { handle = h })

    return () => { void handle?.remove() }
  }, [])

  // ログイン後のプッシュ通知登録
  useEffect(() => {
    if (!user) return
    void (async () => {
      const permission = await getPushPermission()
      if (permission === 'granted') {
        await registerPushIfAllowed()
        return
      }
      if (permission !== 'prompt') return
      // いきなりOSのダイアログを出さず、何のための通知かを先に伝える
      const { value } = await Preferences.get({ key: PUSH_PROMPT_SHOWN_KEY })
      if (value === '1') return
      setShowPushPrompt(true)
    })()
  }, [user?.id])

  const unlock = async () => {
    setUnlocking(true)
    const ok = await verifyIdentity('シフトログのロックを解除します')
    setUnlocking(false)
    if (ok) setLocked(false)
  }

  const dismissPushPrompt = async (accepted: boolean) => {
    setShowPushPrompt(false)
    await Preferences.set({ key: PUSH_PROMPT_SHOWN_KEY, value: '1' })
    if (accepted) await registerPush()
  }

  return (
    <>
      {children}

      {showPushPrompt && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900">お知らせを受け取りますか？</h3>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                  シフトが公開されたとき、交代を頼まれたとき、ヘルプを募集しているときにお知らせします。
                  必要なときだけ通知し、宣伝は送りません。
                </p>
              </div>
              <button onClick={() => void dismissPushPrompt(false)} className="text-gray-300 hover:text-gray-500 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => void dismissPushPrompt(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium"
              >
                あとで
              </button>
              <button
                onClick={() => void dismissPushPrompt(true)}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium"
              >
                通知を受け取る
              </button>
            </div>
          </div>
        </div>
      )}

      {locked && (
        <div className="fixed inset-0 z-[60] bg-blue-600 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-20 h-20 rounded-3xl bg-white/15 flex items-center justify-center mb-6">
            <Fingerprint className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-white text-xl font-bold">シフトログはロックされています</h2>
          <p className="text-blue-100 text-sm mt-2">
            {biometryLabel}で本人確認を行ってください
          </p>
          <button
            onClick={() => void unlock()}
            disabled={unlocking}
            className="mt-8 px-8 py-3 bg-white text-blue-700 rounded-xl font-bold disabled:opacity-60"
          >
            {unlocking ? '確認中...' : `${biometryLabel}でロックを解除`}
          </button>
        </div>
      )}
    </>
  )
}
