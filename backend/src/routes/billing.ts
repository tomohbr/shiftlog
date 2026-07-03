import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticateToken, requireCompany, AuthRequest } from '../middleware/auth';
import { FREE_STAFF_LIMIT, PRICE_PER_MONTH, TRIAL_DAYS, getStaffCount, getTrialInfo } from '../utils/billing';

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
    max_free_staff: FREE_STAFF_LIMIT,
    current_staff: getStaffCount(companyId),
    stripe_configured: !!process.env.STRIPE_SECRET_KEY,
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

  try {
    // Get or create Stripe customer
    let subscription = db.prepare(
      'SELECT * FROM subscriptions WHERE company_id = ?'
    ).get(companyId) as any;

    let customerId = subscription?.stripe_customer_id;
    if (!customerId) {
      const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId) as any;
      const customer = await stripe.customers.create({
        name: company.name,
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
          unit_amount: PRICE_PER_STORE,
          recurring: { interval: 'month' },
          product_data: {
            name: addStores > 0 ? `シフトログ 追加店舗プラン（${addStores}店舗）` : 'シフトログ Proプラン',
            description: addStores > 0
              ? `追加店舗 ${addStores}店舗 / 月額¥${PRICE_PER_STORE}`
              : `CSV出力・月次集計・スタッフ31名以上 / 月額¥${PRICE_PER_STORE}`,
          },
        },
        quantity: Math.max(1, addStores),
      }],
      metadata: {
        company_id: String(companyId),
        additional_stores: String(addStores),
        checkout_type: checkoutType,
      },
      success_url: `${baseUrl}/stores?checkout=success`,
      cancel_url: `${baseUrl}/stores?checkout=cancel`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: '決済セッションの作成に失敗しました' });
  }
});

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
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  res.json({ received: true });
});

export default router;
