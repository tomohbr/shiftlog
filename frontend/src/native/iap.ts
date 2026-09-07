import { Subscriptions } from '@squareetlabs/capacitor-subscriptions'
import { api } from '../api/client'
import { isNative } from './platform'

// App内課金（StoreKit 2）。
//
// Guideline 3.1.1 により、iOS アプリ内から Stripe の決済ページへ誘導することはできない。
// アプリ内では必ずこの導線を使い、Stripe のボタンは表示しない。
//
// 購入後に端末が受け取るのは transactionId だけ。サーバーがその ID で
// App Store Server API に問い合わせて Apple 署名の取引情報を検証し、Pro を付与する。
// 端末が「買えました」と言うのを信用しない作りにしてある。

export const PRO_PRODUCT_ID = 'com.tomohbr.shiftlog.pro.monthly'
export const PRO_YEARLY_PRODUCT_ID = 'com.tomohbr.shiftlog.pro.yearly'
/** Pro を付与する商品（月額・年額）。復元のときはどちらでも可 */
export const PRO_PRODUCT_IDS = [PRO_PRODUCT_ID, PRO_YEARLY_PRODUCT_ID]

export interface AppleProduct {
  productId: string
  /** 通貨記号込みの表示価格（例: "¥980"） */
  price: string
  displayName: string
  description: string
}

export class IapError extends Error {}

/** ストアから価格などの商品情報を取得する。取れなければ null（画面側は既定の文言を出す）。 */
export async function getProProduct(productId: string = PRO_PRODUCT_ID): Promise<AppleProduct | null> {
  if (!isNative) return null
  try {
    const res = await Subscriptions.getProductDetails({ productIdentifier: productId })
    if (res.responseCode !== 0 || !res.data) return null
    return {
      productId: res.data.productIdentifier,
      price: res.data.price,
      displayName: res.data.displayName,
      description: res.data.description,
    }
  } catch {
    return null
  }
}

/**
 * Pro を購入する。
 * StoreKit の購入ダイアログ → 取引IDの取得 → サーバー検証、までを通しで行う。
 */
export async function purchasePro(productId: string = PRO_PRODUCT_ID): Promise<{ plan: string; status: string; expires_at: string | null }> {
  if (!isNative) throw new IapError('App内課金はアプリからのみ利用できます')

  const purchase = await Subscriptions.purchaseProduct({ productIdentifier: productId })

  switch (purchase.responseCode) {
    case 0:
      break // 購入成功
    case 3:
      throw new IapError('CANCELLED')
    case 4:
      throw new IapError('購入が保留されました。承認され次第、自動的に有効になります。')
    case 1:
      throw new IapError('商品が見つかりませんでした。時間をおいてお試しください。')
    case 2:
      throw new IapError('購入の検証に失敗しました。時間をおいてお試しください。')
    default:
      throw new IapError('購入を完了できませんでした。')
  }

  return verifyLatestTransaction(productId)
}

/**
 * 購入の復元。機種変更や再インストール後、あるいは購入直後の検証に失敗したときに使う。
 * Apple は「購入を復元」導線を必須としている。
 */
export async function restorePro(): Promise<{ plan: string; status: string; expires_at: string | null }> {
  if (!isNative) throw new IapError('App内課金はアプリからのみ利用できます')

  const entitlements = await Subscriptions.getCurrentEntitlements()
  const active = entitlements.data?.find(t => PRO_PRODUCT_IDS.includes(t.productIdentifier))
  if (!active?.transactionId) {
    throw new IapError('この Apple ID で有効な購入は見つかりませんでした。')
  }
  return verifyOnServer(active.transactionId)
}

async function verifyLatestTransaction(productId: string) {
  const latest = await Subscriptions.getLatestTransaction({ productIdentifier: productId })
  if (latest.responseCode !== 0 || !latest.data?.transactionId) {
    throw new IapError('購入は完了しましたが確認に失敗しました。設定画面の「購入を復元」をお試しください。')
  }
  return verifyOnServer(latest.data.transactionId)
}

async function verifyOnServer(transactionId: string) {
  try {
    const res = await api.post<{ plan: string; status: string; expires_at: string | null }>(
      '/billing/apple/verify',
      { transaction_id: transactionId }
    )
    return res.data
  } catch (e: any) {
    throw new IapError(e?.response?.data?.error || '購入の確認に失敗しました。時間をおいてお試しください。')
  }
}

/** App Store の「サブスクリプションの管理」画面を開く（解約はここから） */
export async function openManageSubscriptions(): Promise<void> {
  if (!isNative) return
  await Subscriptions.manageSubscriptions()
}
