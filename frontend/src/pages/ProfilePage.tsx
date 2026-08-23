import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { authApi, usersApi, icalApi, billingApi, BillingPlan, AccountDeletionInfo } from '../api/client'
import { User, Mail, Lock, Save, Calendar, Copy, Trash2, Sun, Moon, Crown, CreditCard, Sparkles, AlertTriangle, Bell, Fingerprint, RotateCcw, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { isNative } from '../native/platform'
import { AppleProduct, IapError, getProProduct, openManageSubscriptions, purchasePro, restorePro } from '../native/iap'
import { getBiometricInfo, isAppLockEnabled, setAppLockEnabled, verifyIdentity } from '../native/biometric'
import { getPushPermission, registerPush } from '../native/push'

export default function ProfilePage() {
  const { user, selectedCompany, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [plan, setPlan] = useState<BillingPlan | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const isAdminRole = user?.role === 'admin' || user?.role === 'super_admin'

  // 決済からの戻り: success=お礼+プラン再取得(Webhook反映に数秒かかるためリトライ)
  useEffect(() => {
    const checkout = searchParams.get('checkout')
    if (!checkout) return
    if (checkout === 'success') {
      toast.success('お支払いありがとうございます！Proプランが有効になりました', { duration: 6000 })
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        try {
          const res = await billingApi.getPlan()
          setPlan(res.data)
          if (res.data.plan === 'pro' || attempts >= 5) clearInterval(poll)
        } catch { if (attempts >= 5) clearInterval(poll) }
      }, 2000)
    } else if (checkout === 'cancel') {
      toast('お支払いはキャンセルされました。いつでも再開できます', { icon: 'ℹ️' })
    }
    searchParams.delete('checkout')
    setSearchParams(searchParams, { replace: true })
  }, [])

  useEffect(() => {
    if (!isAdminRole || !selectedCompany) return
    billingApi.getPlan().then(res => setPlan(res.data)).catch(() => {})
  }, [isAdminRole, selectedCompany?.id])

  // ---- iOS: App内課金 / 生体認証 / プッシュ通知 ----
  const [appleProduct, setAppleProduct] = useState<AppleProduct | null>(null)
  const [biometry, setBiometry] = useState<{ available: boolean; label: string | null }>({ available: false, label: null })
  const [appLock, setAppLock] = useState(false)
  const [pushPermission, setPushPermission] = useState<'granted' | 'denied' | 'prompt' | 'unavailable'>('unavailable')

  useEffect(() => {
    if (!isNative) return
    void getProProduct().then(setAppleProduct)
    void getBiometricInfo().then(setBiometry)
    void isAppLockEnabled().then(setAppLock)
    void getPushPermission().then(setPushPermission)
  }, [])

  const toggleAppLock = async () => {
    const next = !appLock
    if (next) {
      const ok = await verifyIdentity('アプリロックを有効にします')
      if (!ok) {
        toast.error('本人確認ができませんでした')
        return
      }
    }
    await setAppLockEnabled(next)
    setAppLock(next)
    toast.success(next ? 'アプリロックを有効にしました' : 'アプリロックを解除しました')
  }

  const handleEnablePush = async () => {
    const result = await registerPush()
    setPushPermission(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'unavailable')
    if (result === 'granted') toast.success('通知を有効にしました')
    else if (result === 'denied') toast.error('iOSの「設定」→「シフトログ」→「通知」から許可してください')
  }

  const handleUpgrade = async () => {
    setBillingLoading(true)

    // iOS アプリ内では Stripe の決済ページを開けない（Guideline 3.1.1）
    if (isNative) {
      try {
        const result = await purchasePro()
        toast.success('Proプランが有効になりました')
        setPlan(prev => (prev ? { ...prev, plan: result.plan, platform: 'apple' } : prev))
      } catch (e: any) {
        if (!(e instanceof IapError && e.message === 'CANCELLED')) {
          toast.error(e?.message || '購入を完了できませんでした')
        }
      } finally {
        setBillingLoading(false)
      }
      return
    }

    try {
      const res = await billingApi.createCheckout()
      window.location.href = res.data.url
    } catch (e: any) {
      toast.error(e.response?.data?.error || '決済ページの作成に失敗しました')
      setBillingLoading(false)
    }
  }

  // Apple の要求: 購入の復元導線をアプリ内に必ず用意すること
  const handleRestore = async () => {
    setBillingLoading(true)
    try {
      const result = await restorePro()
      setPlan(prev => (prev ? { ...prev, plan: result.plan, platform: 'apple' } : prev))
      toast.success(result.plan === 'pro' ? '購入を復元しました' : '有効な購入は見つかりませんでした')
    } catch (e: any) {
      toast.error(e?.message || '購入の復元に失敗しました')
    } finally {
      setBillingLoading(false)
    }
  }

  const handlePortal = async () => {
    setBillingLoading(true)
    try {
      const res = await billingApi.createPortal()
      window.location.href = res.data.url
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'お支払い管理ページの作成に失敗しました')
      setBillingLoading(false)
    }
  }
  const [email, setEmail] = useState(user?.email || '')
  const [name, setName] = useState(user?.name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [icalUrl, setIcalUrl] = useState<string | null>(null)
  const [icalLoading, setIcalLoading] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) ? 'dark' : 'light'
  )

  const issueIcal = async () => {
    setIcalLoading(true)
    try {
      const res = await icalApi.getToken()
      setIcalUrl(res.data.url)
      toast.success('購読URLを生成しました')
    } catch (e: any) {
      toast.error(e.response?.data?.error || '生成に失敗しました')
    } finally { setIcalLoading(false) }
  }
  const revokeIcal = async () => {
    if (!confirm('購読URLを失効させますか？既に設定済みのカレンダーアプリからは読み込めなくなります。')) return
    try {
      await icalApi.revoke()
      setIcalUrl(null)
      toast.success('失効しました')
    } catch (e: any) {
      toast.error(e.response?.data?.error || '失敗しました')
    }
  }
  // アカウント削除
  const [deleteInfo, setDeleteInfo] = useState<AccountDeletionInfo | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  const openDeleteModal = async () => {
    try {
      const res = await authApi.getAccountDeletionInfo()
      setDeleteInfo(res.data)
      setDeletePassword('')
      setDeleteConfirm('')
      setShowDeleteModal(true)
    } catch (e: any) {
      toast.error(e.response?.data?.error || '削除内容の取得に失敗しました')
    }
  }

  const handleDeleteAccount = async () => {
    if (!deleteInfo) return
    if (deleteInfo.requires_password && !deletePassword) {
      toast.error('パスワードを入力してください')
      return
    }
    if (!deleteInfo.requires_password && deleteConfirm !== '削除') {
      toast.error('確認のため「削除」と入力してください')
      return
    }
    setDeleting(true)
    try {
      await authApi.deleteAccount(
        deleteInfo.requires_password ? { password: deletePassword } : { confirm: deleteConfirm }
      )
      toast.success('アカウントを削除しました')
      logout()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'アカウント削除に失敗しました')
      setDeleting(false)
    }
  }

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    if (next === 'dark') document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
    try { localStorage.setItem('theme', next) } catch {}
  }

  const handleProfileSave = async () => {
    if (!user) return
    setSavingProfile(true)
    try {
      await usersApi.update(user.id, { name, email })
      toast.success('プロフィールを更新しました')
    } catch (e: any) {
      toast.error(e.response?.data?.error || '更新に失敗しました')
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword) {
      toast.error('現在のパスワードと新しいパスワードを入力してください')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('新しいパスワードが一致しません')
      return
    }
    if (newPassword.length < 4) {
      toast.error('パスワードは4文字以上にしてください')
      return
    }
    setSavingPassword(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      toast.success('パスワードを変更しました')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'パスワード変更に失敗しました')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Plan / Billing */}
      {isAdminRole && plan && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Crown className="w-6 h-6 text-amber-500" />
            <h2 className="text-lg font-bold text-gray-900">プラン</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            {plan.plan === 'pro' ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-sm font-semibold">
                <Sparkles className="w-3.5 h-3.5" /> Proプラン
              </span>
            ) : plan.in_trial ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm font-semibold">
                Proトライアル中（残り{plan.trial_days_left}日）
              </span>
            ) : (
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm font-semibold">
                Freeプラン
              </span>
            )}
            <span className="text-sm text-gray-500">
              店舗 {plan.current_stores}/{plan.max_stores} ・ スタッフ {plan.current_staff}名
            </span>
          </div>

          {plan.plan !== 'pro' && (
            <div className="text-sm text-gray-600 mb-4 space-y-1">
              <p>Free: 打刻・シフト管理・当月の勤務集計（1店舗・スタッフ{plan.max_free_staff}名まで）</p>
              <p>Pro（月額¥{plan.price_per_store.toLocaleString()}）: 過去月の集計・CSV出力・給与ソフト連携・スタッフ無制限</p>
            </div>
          )}

          {/* iOS アプリ内では App内課金のみ。Stripe の導線は出さない（Guideline 3.1.1） */}
          {isNative ? (
            <div className="space-y-3">
              {plan.plan !== 'pro' && (
                <>
                  <button
                    onClick={handleUpgrade}
                    disabled={billingLoading}
                    className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    {plan.in_trial ? 'Proを続ける' : 'Proにアップグレード'}
                    （{appleProduct?.price || `¥${plan.price_per_store.toLocaleString()}`}／月）
                  </button>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    シフトログ Pro — 月額{appleProduct?.price || `¥${plan.price_per_store.toLocaleString()}`}（1ヶ月ごとの自動更新）。
                    お支払いは Apple ID に請求されます。期間終了の24時間前までに解約されない場合、自動的に更新されます。
                    購入後は「設定」→ Apple ID →「サブスクリプション」からいつでも解約できます。
                  </p>
                </>
              )}

              {plan.plan === 'pro' && plan.platform === 'apple' && (
                <>
                  <button
                    onClick={() => { void openManageSubscriptions() }}
                    className="flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                  >
                    <CreditCard className="w-4 h-4" />
                    サブスクリプションの管理
                  </button>
                  <p className="text-xs text-gray-400">
                    解約は App Store の「サブスクリプション」から行います。解約してもデータは削除されず、Freeプランとして引き続きご利用いただけます。
                  </p>
                </>
              )}

              {plan.plan === 'pro' && plan.platform === 'stripe' && (
                <p className="text-sm text-gray-600">
                  この会社はWebサイトからProプランを契約しています。お支払い方法の変更・解約は、
                  パソコンやスマホのブラウザから shiftlog-production.up.railway.app にログインして設定画面で行えます。
                </p>
              )}

              <button
                onClick={handleRestore}
                disabled={billingLoading}
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                購入を復元
              </button>

              <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                <Link to="/legal/privacy" className="hover:text-gray-600 underline">プライバシーポリシー</Link>
                <Link to="/legal/terms" className="hover:text-gray-600 underline">利用規約</Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {plan.plan !== 'pro' && (
                  <button
                    onClick={handleUpgrade}
                    disabled={billingLoading}
                    className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    {plan.in_trial ? 'Proを続ける' : 'Proにアップグレード'}（月額¥{plan.price_per_store.toLocaleString()}）
                  </button>
                )}
                {plan.plan === 'pro' && plan.platform === 'apple' && (
                  <p className="text-sm text-gray-600">
                    このプランは iPhone アプリの App内課金で契約されています。お支払いの変更・解約は
                    iPhone の「設定」→ Apple ID →「サブスクリプション」から行ってください。
                  </p>
                )}
                {plan.plan === 'pro' && plan.platform !== 'apple' && (
                  <button
                    onClick={handlePortal}
                    disabled={billingLoading}
                    className="flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
                  >
                    <CreditCard className="w-4 h-4" />
                    お支払い・解約の管理
                  </button>
                )}
              </div>
              {plan.plan === 'pro' && (
                <p className="text-xs text-gray-400 mt-3">解約してもデータは削除されません。Freeプランとして引き続き打刻・シフト管理をご利用いただけます。</p>
              )}
            </>
          )}
        </div>
      )}

      {/* 通知（iOSアプリのみ） */}
      {isNative && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" /> 通知
          </h3>
          <p className="text-sm text-gray-500">
            シフトの公開、交代依頼、ヘルプ募集、シフト希望の受付開始をお知らせします。
          </p>
          {pushPermission === 'granted' ? (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <span className="w-2 h-2 rounded-full bg-green-500" /> 通知は有効です
            </div>
          ) : pushPermission === 'denied' ? (
            <p className="text-sm text-amber-700">
              通知が拒否されています。iOSの「設定」→「シフトログ」→「通知」から許可してください。
            </p>
          ) : (
            <button
              onClick={handleEnablePush}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg text-sm"
            >
              通知を有効にする
            </button>
          )}
        </div>
      )}

      {/* セキュリティ（iOSアプリのみ） */}
      {isNative && biometry.available && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-indigo-600" /> セキュリティ
          </h3>
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <p className="text-sm font-medium">{biometry.label}でアプリをロック</p>
              <p className="text-xs text-gray-500 mt-0.5">
                アプリを開くたびに本人確認します。端末を置き忘れても、給与や連絡先が見られません。
              </p>
            </div>
            <button
              onClick={toggleAppLock}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${appLock ? 'bg-indigo-600' : 'bg-gray-300'}`}
              aria-label="アプリロック"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${appLock ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
      )}

      {/* Profile Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <User className="w-6 h-6 text-blue-600" />
          <h2 className="text-lg font-bold text-gray-900">プロフィール設定</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <span className="flex items-center gap-1.5">
                <User className="w-4 h-4" />
                名前
              </span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <span className="flex items-center gap-1.5">
                <Mail className="w-4 h-4" />
                メールアドレス
              </span>
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <button
            onClick={handleProfileSave}
            disabled={savingProfile}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {savingProfile ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Password Change */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Lock className="w-6 h-6 text-blue-600" />
          <h2 className="text-lg font-bold text-gray-900">パスワード変更</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              現在のパスワード
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="現在のパスワード"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              新しいパスワード
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="新しいパスワード"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              新しいパスワード（確認）
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="もう一度入力"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <button
            onClick={handlePasswordChange}
            disabled={savingPassword}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
          >
            <Lock className="w-4 h-4" />
            {savingPassword ? '変更中...' : 'パスワードを変更'}
          </button>
        </div>
      </div>

      {/* カレンダー購読 (iCal) */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-600" /> カレンダー購読
        </h3>
        <p className="text-sm text-gray-500">
          自分のシフトを Google/Apple カレンダーに自動同期できる購読URLを発行します。URLは秘密情報として扱ってください。
        </p>
        {icalUrl ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input readOnly value={icalUrl} className="flex-1 border border-gray-300 rounded px-3 py-2 text-xs font-mono bg-gray-50" />
              <button
                onClick={() => { navigator.clipboard.writeText(icalUrl); toast.success('URLをコピーしました') }}
                className="px-3 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5" /> コピー
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Google カレンダー: 「他のカレンダー」→「URLで追加」にこのURLを貼り付け<br />
              iPhone: 「設定」→「カレンダー」→「アカウント」→「アカウントを追加」→「その他」→「照会するカレンダーを追加」
            </p>
            <button
              onClick={revokeIcal}
              className="text-xs text-red-600 hover:underline flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> 購読URLを失効
            </button>
          </div>
        ) : (
          <button
            onClick={issueIcal}
            disabled={icalLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg text-sm"
          >
            {icalLoading ? '生成中...' : '購読URLを生成'}
          </button>
        )}
      </div>

      {/* 表示設定 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-3">表示設定</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {theme === 'dark' ? <Moon className="w-5 h-5 text-indigo-600" /> : <Sun className="w-5 h-5 text-amber-500" />}
            <span className="text-sm">ダークモード</span>
          </div>
          <button
            onClick={toggleTheme}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${theme === 'dark' ? 'bg-indigo-600' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${theme === 'dark' ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* アカウント削除 */}
      <div className="bg-white rounded-xl border border-red-200 p-6 space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-5 h-5" /> アカウントの削除
        </h3>
        <p className="text-sm text-gray-500">
          アカウントと、あなたが唯一の管理者である会社のデータをすべて削除します。この操作は取り消せません。
        </p>
        <button
          onClick={openDeleteModal}
          className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 text-sm font-medium"
        >
          <Trash2 className="w-4 h-4" /> アカウントを削除
        </button>
      </div>

      {/* アカウント削除の確認 */}
      {showDeleteModal && deleteInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" /> 本当に削除しますか？
            </h3>

            {deleteInfo.deleting_companies.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm font-medium text-red-800 mb-1">
                  以下の会社は、すべてのデータごと削除されます
                </p>
                <ul className="text-sm text-red-700 list-disc list-inside">
                  {deleteInfo.deleting_companies.map(c => <li key={c.id}>{c.name}</li>)}
                </ul>
                <p className="text-xs text-red-600 mt-2">
                  シフト・打刻・スタッフ・集計データがすべて消えます。有料プランは解約されます。
                </p>
              </div>
            )}

            {deleteInfo.has_apple_subscription && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-amber-900">
                  App内課金のサブスクリプションは、アカウントを削除しても自動では解約されません。
                  「設定」→ Apple ID →「サブスクリプション」から、シフトログ Pro を解約してください。
                </p>
                <button
                  onClick={() => { void openManageSubscriptions() }}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm text-amber-800 underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> サブスクリプションの管理を開く
                </button>
              </div>
            )}

            {deleteInfo.leaving_companies.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-700 mb-1">
                  以下の会社からは、あなたのみが退出します（会社は残ります）
                </p>
                <ul className="text-sm text-gray-600 list-disc list-inside">
                  {deleteInfo.leaving_companies.map(c => <li key={c.id}>{c.name}</li>)}
                </ul>
              </div>
            )}

            {deleteInfo.requires_password ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  確認のためパスワードを入力
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  確認のため「削除」と入力
                </label>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium disabled:opacity-50"
              >
                {deleting ? '削除中...' : '完全に削除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
