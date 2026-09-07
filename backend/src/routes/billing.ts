import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { FREE_STAFF_LIMIT, PRICE_PER_MONTH, PRICE_PER_YEAR, TRIAL_DAYS, getStaffCount, getTrialInfo } from '../utils/billing';
import {
  APPLE_PRO_PRODUCT_ID,
  APPLE_PRO_PRODUCT_IDS,
  APPLE_PRO_YEARLY_PRODUCT_ID,
  AppleSubscriptionConflict,
  applyAppleSubscription,
  decodeTransactionFromNotification,
  isAppleIapConfigured,
  verifyNotification,
  verifyTransaction,
} from '../utils/apple-iap';
import { NotificationTypeV2, Subtype } from '@apple/app-store-server-library';

const router = Router();

// Lazy-load Stripe (only when STRIPE_SECRET_KEY is set)
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const Stripe = require('stripe');
  return new Stripe(key, { apiVersion: '2024-12-18.acacia' });
}

const PRICE_PER_STORE = PRICE_PER_MONTH; // ¥980/月

// GET /api/billing/plan - Get current plan info
router.get('/plan', authenticateToken, requireCompany, (req: AuthRequest, res: Response): void => {
  const companyId = req.companyId!;
  const subscription = db.prepare(
    'SELECT * FROM subscriptions WHERE company_id = ?'
  ).get(companyId) as any;
  const storeCount = (db.prepare(
    'SELECT COUNT(*) as count FROM stores WHERE company_id = ?'
  ).get(companyId) as any).count;

  const trial = getTrialInfo(companyId);
  res.json({
    plan: subscription?.plan || 'free',
    max_stores: subscription?.max_stores || 1,
    current_stores: storeCount,
    price_per_store: PRICE_PER_STORE,
    price_per_year: PRICE_PER_YEAR,
    max_free_staff: FREE_STAFF_LIMIT,
    current_staff: getStaffCount(companyId),
    stripe_configured: !!process.env.STRIPE_SECRET_KEY,
    // どちらの決済で契約しているか。iOS アプリは Stripe の導線を出せない（Guideline 3.1.1）
    platform: subscription?.platform || 'stripe',
    apple_configured: isAppleIapConfigured(),
    apple_product_id: APPLE_PRO_PRODUCT_ID,
    apple_product_ids: { monthly: APPLE_PRO_PRODUCT_ID, yearly: APPLE_PRO_YEARLY_PRODUCT_ID },
    trial_days_total: TRIAL_DAYS,
    in_trial: trial.in_trial,
    trial_ends_at: trial.trial_ends_at,
    trial_days_left: trial.trial_days_left,
  });
});

// POST /api/billing/checkout - Create Stripe Checkout session
router.post('/checkout', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  const companyId = req.companyId!;
  const stripe = getStripe();

  if (!stripe) {
    res.status(503).json({ error: '決済システムが設定されていません。管理者にお問い合わせください。' });
    return;
  }

  const addStores = Math.max(0, Number(req.body.additional_stores ?? 0));
  const checkoutType = addStores > 0 ? 'additional_store' : 'pro';
  // 年払いは Pro 本体のみ（追加店舗は月額のまま）
  const yearly = checkoutType === 'pro' && req.body.interval === 'year';
  const unitAmount = yearly ? PRICE_PER_YEAR : PRICE_PER_STORE;

  try {
    // Get or create Stripe customer
    let subscription = db.prepare(
      'SELECT * FROM subscriptions WHERE company_id = ?'
    ).get(companyId) as any;

    // 二重課金防止: 既にPro契約中の会社がProプラン(店舗追加ではない)を再購入するのを防ぐ
    if (checkoutType === 'pro' && subscription?.plan === 'pro' && subscription?.status !== 'canceled' && subscription?.stripe_subscription_id) {
      res.status(400).json({ error: '既にProプランをご契約中です。お支払いの変更は設定ページの「お支払い・解約の管理」から行えます。' });
      return;
    }

    let customerId = subscription?.stripe_customer_id;
    if (!customerId) {
      const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId) as any;
      const adminUser = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user!.id) as any;
      const customer = await stripe.customers.create({
        name: company.name,
        email: adminUser?.email || undefined,
        metadata: { company_id: String(companyId) },
      });
      customerId = customer.id;
      db.prepare(
        'UPDATE subscriptions SET stripe_customer_id = ? WHERE company_id = ?'
      ).run(customerId, companyId);
    }

    const baseUrl = process.env.APP_URL || req.headers.origin || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'jpy',
          unit_amount: unitAmount,
          recurring: { interval: yearly ? 'year' : 'month' },
          product_data: {
            name: addStores > 0
              ? `シフトログ 追加店舗プラン（${addStores}店舗）`
              : yearly ? 'シフトログ Proプラン（年払い）' : 'シフトログ Proプラン',
            description: addStores > 0
              ? `追加店舗 ${addStores}店舗 / 月額¥${PRICE_PER_STORE}`
              : yearly
                ? `CSV出力・過去月の集計・スタッフ${FREE_STAFF_LIMIT + 1}名以上 / 年額¥${PRICE_PER_YEAR}（2ヶ月分お得）`
                : `CSV出力・過去月の集計・スタッフ${FREE_STAFF_LIMIT + 1}名以上 / 月額¥${PRICE_PER_STORE}`,
          },
        },
        quantity: Math.max(1, addStores),
      }],
      metadata: {
        company_id: String(companyId),
        additional_stores: String(addStores),
        checkout_type: checkoutType,
        interval: yearly ? 'year' : 'month',
      },
      success_url: `${baseUrl}/settings?checkout=success`,
      cancel_url: `${baseUrl}/settings?checkout=cancel`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: '決済セッションの作成に失敗しました' });
  }
});

// POST /api/billing/portal - Stripe Billing Portal（支払い方法変更・解約・請求履歴）
router.post('/portal', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  const companyId = req.companyId!;
  const stripe = getStripe();

  if (!stripe) {
    res.status(503).json({ error: '決済システムが設定されていません。管理者にお問い合わせください。' });
    return;
  }

  const subscription = db.prepare(
    'SELECT * FROM subscriptions WHERE company_id = ?'
  ).get(companyId) as any;

  if (!subscription?.stripe_customer_id) {
    res.status(400).json({ error: 'お支払い情報がまだ登録されていません' });
    return;
  }

  const baseUrl = process.env.APP_URL || req.headers.origin || 'http://localhost:5173';

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${baseUrl}/settings`,
    });
    res.json({ url: session.url });
  } catch (err: any) {
    // ポータル設定未作成の場合はデフォルト設定を自動作成してリトライ
    if (err?.message?.includes('configuration')) {
      try {
        await stripe.billingPortal.configurations.create({
          business_profile: { headline: 'シフトログ — お支払いの管理' },
          features: {
            invoice_history: { enabled: true },
            payment_method_update: { enabled: true },
            subscription_cancel: { enabled: true, mode: 'at_period_end' },
          },
        });
        const session = await stripe.billingPortal.sessions.create({
          customer: subscription.stripe_customer_id,
          return_url: `${baseUrl}/settings`,
        });
        res.json({ url: session.url });
        return;
      } catch (err2: any) {
        console.error('Stripe portal config error:', err2);
      }
    }
    console.error('Stripe portal error:', err);
    res.status(500).json({ error: 'お支払い管理ページの作成に失敗しました' });
  }
});

// ---------------------------------------------------------------------------
// App内課金（Apple / StoreKit 2）
// ---------------------------------------------------------------------------

// POST /api/billing/apple/verify - iOS アプリでの購入をサーバーで検証して反映する
//
// クライアントは purchaseProduct() の成功後に transactionId だけを送る。
// レシートの中身は信用せず、その ID で App Store Server API に問い合わせて
// Apple が署名した取引情報を取得・検証する。
router.post('/apple/verify', authenticateToken, requireCompany, async (req: AuthRequest, res: Response): Promise<void> => {
  const companyId = req.companyId!;

  if (!['admin', 'super_admin'].includes(req.user!.role)) {
    res.status(403).json({ error: '管理者のみ契約できます' });
    return;
  }

  if (!isAppleIapConfigured()) {
    res.status(503).json({ error: 'App内課金がまだ設定されていません。管理者にお問い合わせください。' });
    return;
  }

  const transactionId = req.body?.transaction_id;
  if (!transactionId || typeof transactionId !== 'string') {
    res.status(400).json({ error: 'transaction_id が必要です' });
    return;
  }

  try {
    const verified = await verifyTransaction(transactionId);

    if (!APPLE_PRO_PRODUCT_IDS.includes(verified.transaction.productId || '')) {
      res.status(400).json({ error: '対象外の商品です' });
      return;
    }

    applyAppleSubscription(companyId, verified);

    const subscription = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(companyId) as any;
    console.log(`[apple-iap] company ${companyId} を Apple 課金で更新: plan=${subscription?.plan} status=${subscription?.status} env=${verified.environment}`);

    res.json({
      plan: subscription?.plan || 'free',
      status: subscription?.status || 'active',
      platform: 'apple',
      expires_at: subscription?.current_period_end || null,
    });
  } catch (err: any) {
    if (err instanceof AppleSubscriptionConflict) {
      res.status(409).json({ error: err.message });
      return;
    }
    console.error('[apple-iap] 購入の検証に失敗:', err?.message || err);
    res.status(400).json({ error: '購入の確認ができませんでした。時間をおいて「購入を復元」をお試しください。' });
  }
});

// POST /api/billing/apple/notifications - App Store Server Notifications V2 の受信口
//
// 更新・解約・返金・課金失敗を Apple から受け取って subscriptions を同期する。
// Stripe webhook と同じ役割。署名検証を通るかどうかだけが認証。
router.post('/apple/notifications', async (req: Request, res: Response): Promise<void> => {
  const signedPayload = (req.body || {}).signedPayload;
  if (!signedPayload || typeof signedPayload !== 'string') {
    res.status(400).json({ error: 'signedPayload が必要です' });
    return;
  }

  let notificationType: string | undefined;
  try {
    const { payload } = await verifyNotification(signedPayload);
    notificationType = payload.notificationType;

    // 疎通確認用の通知。何も反映しない。
    if (payload.notificationType === NotificationTypeV2.TEST) {
      console.log('[apple-iap] TEST 通知を受信');
      res.json({ received: true });
      return;
    }

    await applyNotification(payload);
    res.json({ received: true });
  } catch (err: any) {
    console.error(`[apple-iap] 通知の処理に失敗 (type=${notificationType ?? '-'}):`, err?.message || err);
    // 検証に失敗した通知は Apple に再送させない（署名不正のリトライは無意味）
    res.status(200).json({ received: false });
  }
});

// 通知の中身を subscriptions に反映する
async function applyNotification(payload: any): Promise<void> {
  const signedTransactionInfo = payload?.data?.signedTransactionInfo;
  if (!signedTransactionInfo) {
    console.log(`[apple-iap] 取引情報のない通知のため無視: ${payload?.notificationType}`);
    return;
  }

  // 通知に同梱された取引情報も、通知本体と同じ署名検証を通してからデコードする
  const transaction = await decodeTransactionFromNotification(signedTransactionInfo, payload?.data?.environment);

  const originalId = transaction.originalTransactionId;
  if (!originalId) return;

  const subscription = db.prepare(
    'SELECT * FROM subscriptions WHERE apple_original_transaction_id = ?'
  ).get(originalId) as any;
  if (!subscription) {
    console.log(`[apple-iap] 未知の契約からの通知: originalTransactionId=${originalId}`);
    return;
  }

  const expiresAt = transaction.expiresDate ? new Date(transaction.expiresDate).toISOString() : null;
  const type = payload.notificationType as NotificationTypeV2;
  const subtype = payload.subtype as Subtype | undefined;

  let plan: 'pro' | 'free' | null = null;
  let status: string | null = null;

  switch (type) {
    case NotificationTypeV2.SUBSCRIBED:
    case NotificationTypeV2.DID_RENEW:
    case NotificationTypeV2.OFFER_REDEEMED:
    case NotificationTypeV2.RENEWAL_EXTENDED:
      plan = 'pro'; status = 'active';
      break;

    case NotificationTypeV2.DID_FAIL_TO_RENEW:
      // 猶予期間中は使わせ続け、そうでなければ請求リトライ中として記録する
      plan = 'pro';
      status = subtype === Subtype.GRACE_PERIOD ? 'active' : 'past_due';
      break;

    case NotificationTypeV2.EXPIRED:
    case NotificationTypeV2.GRACE_PERIOD_EXPIRED:
    case NotificationTypeV2.REFUND:
    case NotificationTypeV2.REVOKE:
      plan = 'free'; status = 'canceled';
      break;

    case NotificationTypeV2.DID_CHANGE_RENEWAL_STATUS:
      // 自動更新をオフにしただけ。期限までは Pro のまま（Stripe の cancel_at_period_end と同じ扱い）
      break;

    default:
      break;
  }

  if (plan === null) {
    db.prepare(
      'UPDATE subscriptions SET current_period_end = COALESCE(?, current_period_end), updated_at = CURRENT_TIMESTAMP WHERE company_id = ?'
    ).run(expiresAt, subscription.company_id);
    console.log(`[apple-iap] company ${subscription.company_id}: ${type}${subtype ? '/' + subtype : ''}（状態は変更なし）`);
    return;
  }

  db.prepare(`
    UPDATE subscriptions
    SET plan = ?, status = ?, platform = 'apple',
        max_stores = CASE WHEN ? = 'free' THEN 1 ELSE max_stores END,
        apple_transaction_id = COALESCE(?, apple_transaction_id),
        current_period_end = COALESCE(?, current_period_end),
        updated_at = CURRENT_TIMESTAMP
    WHERE company_id = ?
  `).run(plan, status, plan, transaction.transactionId || null, expiresAt, subscription.company_id);

  console.log(`[apple-iap] company ${subscription.company_id}: ${type}${subtype ? '/' + subtype : ''} → plan=${plan} status=${status}`);
}

// POST /api/billing/webhook - Stripe webhook handler
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: 'Stripe not configured' });
    return;
  }

  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      if (!sig) {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // 本番ではSTRIPE_WEBHOOK_SECRET必須。未設定時は偽イベントで無償Pro化できてしまう。
      console.warn('STRIPE_WEBHOOK_SECRET not set — rejecting unverified webhook');
      res.status(503).json({ error: 'Webhook secret not configured' });
      return;
    }
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).json({ error: 'Webhook signature verification failed' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const companyId = parseInt(session.metadata.company_id);
        const additionalStores = parseInt(session.metadata.additional_stores || '0');

        const sub = db.prepare('SELECT * FROM subscriptions WHERE company_id = ?').get(companyId) as any;
        const newMax = (sub?.max_stores || 1) + additionalStores;

        db.prepare(`
          UPDATE subscriptions
          SET plan = 'pro', max_stores = ?, stripe_subscription_id = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
          WHERE company_id = ?
        `).run(newMax, session.subscription, companyId);

        console.log(`Company ${companyId} upgraded to pro: max_stores=${newMax}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customer = await stripe.customers.retrieve(subscription.customer);
        const companyId = parseInt(customer.metadata.company_id);

        db.prepare(`
          UPDATE subscriptions
          SET plan = 'free', max_stores = 1, stripe_subscription_id = NULL, status = 'canceled', updated_at = CURRENT_TIMESTAMP
          WHERE company_id = ?
        `).run(companyId);

        console.log(`Company ${companyId} subscription canceled, reverted to free`);
        break;
      }

      case 'customer.subscription.updated': {
        // 支払い失敗(past_due/unpaid)や復活(active)の状態を同期する。
        // 解約予約(cancel_at_period_end)は期末まで active のままなので何もしない。
        const subscription = event.data.object;
        const customer = await stripe.customers.retrieve(subscription.customer);
        const companyId = parseInt(customer.metadata.company_id);
        const status = ['active', 'trialing'].includes(subscription.status) ? 'active' : subscription.status;

        db.prepare(`
          UPDATE subscriptions
          SET status = ?, current_period_end = ?, updated_at = CURRENT_TIMESTAMP
          WHERE company_id = ? AND stripe_subscription_id = ?
        `).run(
          status,
          subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
          companyId,
          subscription.id,
        );

        console.log(`Company ${companyId} subscription status synced: ${subscription.status}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.customer) {
          const customer = await stripe.customers.retrieve(invoice.customer);
          const companyId = parseInt(customer.metadata.company_id);
          // 即ダウングレードせず past_due で記録（Stripe側のリトライ/督促に任せ、最終的に deleted で降格）
          db.prepare(`
            UPDATE subscriptions SET status = 'past_due', updated_at = CURRENT_TIMESTAMP
            WHERE company_id = ? AND plan = 'pro'
          `).run(companyId);
          console.log(`Company ${companyId} invoice payment failed (past_due)`);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  res.json({ received: true });
});

export default router;
