import toast from 'react-hot-toast'
import { billingApi, BillingPlan } from '../api/client'
import { isNative } from '../native/platform'
import { IapError, purchasePro } from '../native/iap'
import { track } from './analytics'

// 購入導線を共通化し、アプリでは必ずApp内課金を使う。
export async function startProUpgrade(opts: {
  productId?: string
  onUpgraded?: (plan: BillingPlan) => void
  setLoading?: (loading: boolean) => void
  additionalStores?: number
} = {}): Promise<void> {
  if (isNative && opts.additionalStores) return
  opts.setLoading?.(true)
  try {
    if (isNative) {
      const productId = opts.productId || (await billingApi.getPlan()).data.apple_product_id
      track('checkout_click', { platform: 'apple' })
      const result = await purchasePro(productId)
      if (result.plan === 'pro') track('pro_upgrade_success', { platform: 'apple' })
      toast.success('Proプランが有効になりました')
      opts.onUpgraded?.((await billingApi.getPlan()).data)
    } else {
      track('checkout_click', { platform: 'stripe' })
      const res = await billingApi.createCheckout(opts.additionalStores)
      window.location.href = res.data.url
    }
  } catch (e: any) {
    if (!(e instanceof IapError && e.message === 'CANCELLED')) {
      toast.error(e?.response?.data?.error || e?.message || '購入を完了できませんでした')
    }
  } finally {
    opts.setLoading?.(false)
  }
}
