import { track } from '../lib/analytics'
import { useEffect, useState } from 'react'
import { billingApi, BillingPlan } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { Sparkles, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { isNative } from '../native/platform'
import { IapError, purchasePro } from '../native/iap'

// 課金タイミング設計:
// - トライアル残り7日以下: 黄色バナーで残日数と「Proを続ける」を常時表示
// - トライアル終了後(Free): その日1回だけ閉じられる案内バナー（データは消えない旨を明言して不安による解約・放置を防ぐ）
// - トライアル中(8日以上): 控えめな状態表示。Proは表示しない
export default function PlanBanner() {
  const { user, selectedCompany } = useAuth()
  const [plan, setPlan] = useState<BillingPlan | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState(false)

  const isAdminRole = user?.role === 'admin' || user?.role === 'super_admin'

  useEffect(() => {
    if (!isAdminRole || !selectedCompany) return
    billingApi.getPlan()
      .then(res => setPlan(res.data))
      .catch(() => {})
  }, [isAdminRole, selectedCompany?.id])

  if (!isAdminRole || !plan || plan.plan === 'pro') return null

  const handleUpgrade = async () => {
    setCheckoutLoading(true)

    // iOS アプリ内から Stripe へ誘導することはできない（Guideline 3.1.1）。
    // App内課金で購入し、サーバー側で検証する。
    if (isNative) {
      try {
        // 購入開始とサーバー検証成功を区別して計測する。
        track('checkout_click', { platform: 'apple' })
        const result = await purchasePro()
        if (result.plan === 'pro') track('pro_upgrade_success', { platform: 'apple' })
        toast.success('Proプランが有効になりました')
        setPlan(prev => (prev ? { ...prev, plan: result.plan, platform: 'apple' } : prev))
      } catch (e: any) {
        if (!(e instanceof IapError && e.message === 'CANCELLED')) {
          toast.error(e?.message || '購入を完了できませんでした')
        }
      } finally {
        setCheckoutLoading(false)
      }
      return
    }

    try {
      // Stripe決済の開始を計測する。
      track('checkout_click', { platform: 'stripe' })
      const res = await billingApi.createCheckout()
      window.location.href = res.data.url
    } catch (e: any) {
      toast.error(e.response?.data?.error || '決済ページの作成に失敗しました')
      setCheckoutLoading(false)
    }
  }

  // トライアル中・残り7日以下
  if (plan.in_trial && plan.trial_days_left != null && plan.trial_days_left <= 7) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-amber-800">
          <span className="font-semibold">Proトライアル残り{plan.trial_days_left}日</span>
          {' — '}終了後もデータは消えません。CSV出力・給与ソフト連携・過去月の集計を使い続けるにはProプラン（月額¥{plan.price_per_store.toLocaleString()}）。
        </p>
        <button
          onClick={handleUpgrade}
          disabled={checkoutLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          Proを続ける
        </button>
      </div>
    )
  }

  // トライアル中・残り8日以上（控えめに状態だけ見せて、終了時のサプライズを防ぐ）
  if (plan.in_trial && plan.trial_days_left != null && plan.trial_days_left > 7) {
    return (
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-1.5">
        <p className="text-xs text-gray-500">
          <span className="md:hidden whitespace-nowrap">Proトライアル中・残り{plan.trial_days_left}日</span>
          <span className="hidden md:inline">Proトライアル中（残り{plan.trial_days_left}日）— 全機能を無料でお試しいただけます。終了後は自動でFreeプランになり、データはそのまま残ります。</span>
        </p>
      </div>
    )
  }

  // トライアル終了後のFree（1日1回まで表示）
  const trialExpired = !plan.in_trial && !!plan.trial_ends_at
  if (trialExpired && !dismissed) {
    const todayKey = `plan-banner-dismissed-${new Date().toISOString().slice(0, 10)}`
    if (localStorage.getItem(todayKey)) return null
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-blue-800">
          Freeプランで利用中です。打刻・シフト・当月の集計はずっと無料。過去月の集計とCSV出力はPro（月額¥{plan.price_per_store.toLocaleString()}）で利用できます。
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUpgrade}
            disabled={checkoutLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            Proにアップグレード
          </button>
          <button
            onClick={() => {
              localStorage.setItem(todayKey, '1')
              setDismissed(true)
            }}
            className="text-blue-400 hover:text-blue-600 p-1"
            aria-label="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  return null
}
