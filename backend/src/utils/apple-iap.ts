import fs from 'fs';
import path from 'path';
import {
  APIException,
  AppStoreServerAPIClient,
  Environment,
  JWSTransactionDecodedPayload,
  SignedDataVerifier,
  Status,
} from '@apple/app-store-server-library';
import db from '../db';

// App内課金（StoreKit 2）のサーバー側検証。
//
// Guideline 3.1.1: iOS アプリ内で販売するデジタルコンテンツは App内課金が必須。
// そのため課金は 2 系統になる:
//
//   Web（ブラウザ）  →  Stripe Checkout  →  subscriptions.platform = 'stripe'
//   iOS アプリ       →  StoreKit 2       →  subscriptions.platform = 'apple'
//
// クライアントは購入後に transactionId だけを送ってくる。サーバーはその ID で
// App Store Server API に問い合わせ、Apple が署名した取引情報（JWS）を取得・検証する。
// クライアントが渡した内容をそのまま信用しないため、改ざんの余地がない。
//
// 必要な環境変数（未設定なら Apple 課金は無効。Web の Stripe 運用には影響しない）:
//   APPLE_IAP_KEY_ID       App Store Connect API キーの Key ID
//   APPLE_IAP_ISSUER_ID    同 Issuer ID（UUID）
//   APPLE_IAP_PRIVATE_KEY  同 .p8 の中身（改行は \n エスケープ可）
//   APPLE_APP_APPLE_ID     App Store のアプリID（数値）。本番の通知検証に必要
//   APPLE_BUNDLE_ID        既定 com.shiftlog.app
//   APPLE_PRO_PRODUCT_ID   既定 com.shiftlog.app.pro.monthly

export const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.shiftlog.app';
export const APPLE_PRO_PRODUCT_ID = process.env.APPLE_PRO_PRODUCT_ID || 'com.shiftlog.app.pro.monthly';

// App Store Server API が「その transactionId は無いよ」と返すエラーコード。
// 本番で見つからなければ Sandbox（TestFlight・審査時）を見に行く合図。
const TRANSACTION_ID_NOT_FOUND = 4040010;

const CERT_DIR = path.join(__dirname, '..', '..', 'certs');

let rootCertsCache: Buffer[] | null = null;

function loadAppleRootCertificates(): Buffer[] {
  if (rootCertsCache) return rootCertsCache;
  try {
    rootCertsCache = fs.readdirSync(CERT_DIR)
      .filter(f => f.endsWith('.cer'))
      .map(f => fs.readFileSync(path.join(CERT_DIR, f)));
  } catch (e) {
    console.error('[apple-iap] Appleルート証明書を読み込めません:', (e as Error).message);
    rootCertsCache = [];
  }
  return rootCertsCache;
}

interface AppleConfig {
  keyId: string;
  issuerId: string;
  privateKey: string;
  appAppleId?: number;
}

function getConfig(): AppleConfig | null {
  const keyId = process.env.APPLE_IAP_KEY_ID;
  const issuerId = process.env.APPLE_IAP_ISSUER_ID;
  const rawKey = process.env.APPLE_IAP_PRIVATE_KEY;
  if (!keyId || !issuerId || !rawKey) return null;
  const appAppleId = process.env.APPLE_APP_APPLE_ID ? Number(process.env.APPLE_APP_APPLE_ID) : undefined;
  return {
    keyId,
    issuerId,
    privateKey: rawKey.replace(/\\n/g, '\n'),
    appAppleId: Number.isFinite(appAppleId) ? appAppleId : undefined,
  };
}

export function isAppleIapConfigured(): boolean {
  return getConfig() !== null && loadAppleRootCertificates().length > 0;
}

function getClient(environment: Environment): AppStoreServerAPIClient | null {
  const config = getConfig();
  if (!config) return null;
  return new AppStoreServerAPIClient(
    config.privateKey, config.keyId, config.issuerId, APPLE_BUNDLE_ID, environment
  );
}

function getVerifier(environment: Environment): SignedDataVerifier | null {
  const config = getConfig();
  const roots = loadAppleRootCertificates();
  if (!config || roots.length === 0) return null;
  return new SignedDataVerifier(
    roots,
    true,
    environment,
    APPLE_BUNDLE_ID,
    // Sandbox では appAppleId を渡してはいけない（Apple のライブラリ仕様）
    environment === Environment.PRODUCTION ? config.appAppleId : undefined,
  );
}

export interface VerifiedAppleTransaction {
  environment: Environment;
  transaction: JWSTransactionDecodedPayload;
  /** Apple 側の現在のサブスクリプション状態（1=有効, 2=期限切れ, 3=請求リトライ中, 4=猶予期間, 5=取り消し） */
  status: Status | null;
  expiresDate: string | null;
}

/**
 * transactionId を App Store Server API に問い合わせて検証する。
 * 本番 → Sandbox の順に探す（TestFlight と審査は Sandbox で走るため）。
 */
export async function verifyTransaction(transactionId: string): Promise<VerifiedAppleTransaction> {
  if (!isAppleIapConfigured()) {
    throw new Error('APPLE_IAP_NOT_CONFIGURED');
  }

  const environments = [Environment.PRODUCTION, Environment.SANDBOX];
  let lastError: unknown = null;

  for (const environment of environments) {
    const client = getClient(environment);
    const verifier = getVerifier(environment);
    if (!client || !verifier) break;

    try {
      const info = await client.getTransactionInfo(transactionId);
      if (!info.signedTransactionInfo) throw new Error('APPLE_EMPTY_TRANSACTION');

      const transaction = await verifier.verifyAndDecodeTransaction(info.signedTransactionInfo);

      if (transaction.bundleId !== APPLE_BUNDLE_ID) {
        throw new Error('APPLE_BUNDLE_MISMATCH');
      }

      // 現在の契約状態は取引情報だけでは分からないので、別途ステータスを引く
      let status: Status | null = null;
      let expiresDate: string | null = transaction.expiresDate
        ? new Date(transaction.expiresDate).toISOString()
        : null;
      try {
        const originalId = transaction.originalTransactionId || transactionId;
        const statuses = await client.getAllSubscriptionStatuses(originalId);
        for (const group of statuses.data || []) {
          for (const item of group.lastTransactions || []) {
            if (item.originalTransactionId !== originalId) continue;
            status = item.status ?? null;
            if (item.signedTransactionInfo) {
              const latest = await verifier.verifyAndDecodeTransaction(item.signedTransactionInfo);
              if (latest.expiresDate) expiresDate = new Date(latest.expiresDate).toISOString();
            }
          }
        }
      } catch (e) {
        console.error('[apple-iap] 契約状態の取得に失敗（取引情報のみで続行）:', (e as Error).message);
      }

      return { environment, transaction, status, expiresDate };
    } catch (e) {
      lastError = e;
      // 本番に無ければ Sandbox を探す。それ以外のエラーは即座に投げる。
      if (e instanceof APIException && e.apiError === TRANSACTION_ID_NOT_FOUND) continue;
      throw e;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('APPLE_TRANSACTION_NOT_FOUND');
}

/** Apple の契約ステータスを、このアプリの subscriptions.status / plan に落とす */
export function mapAppleStatus(status: Status | null): { plan: 'pro' | 'free'; status: string } {
  switch (status) {
    case Status.ACTIVE:
      return { plan: 'pro', status: 'active' };
    case Status.BILLING_GRACE_PERIOD:
      // 猶予期間中は課金失敗だが利用は継続させる（Apple の意図する挙動）
      return { plan: 'pro', status: 'active' };
    case Status.BILLING_RETRY:
      return { plan: 'pro', status: 'past_due' };
    case Status.EXPIRED:
    case Status.REVOKED:
      return { plan: 'free', status: 'canceled' };
    default:
      // ステータスを引けなかった場合は取引が成立している前提で有効扱いにする。
      // 誤って機能を止めるより、次回の通知（ASSN V2）で正すほうが被害が小さい。
      return { plan: 'pro', status: 'active' };
  }
}

export class AppleSubscriptionConflict extends Error {}

/**
 * 検証済みの取引を会社のサブスクリプションに反映する。
 *
 * 同じ Apple 契約（originalTransactionId）が別会社に紐づいている場合は、
 * 1契約で複数会社をProにできてしまうため拒否する。
 */
export function applyAppleSubscription(companyId: number, verified: VerifiedAppleTransaction): void {
  const originalId = verified.transaction.originalTransactionId;
  if (!originalId) throw new Error('APPLE_MISSING_ORIGINAL_TRANSACTION_ID');

  const bound = db.prepare(
    'SELECT company_id FROM subscriptions WHERE apple_original_transaction_id = ?'
  ).get(originalId) as any;
  if (bound && bound.company_id !== companyId) {
    throw new AppleSubscriptionConflict('この Apple ID の契約は既に別の会社で利用されています');
  }

  const { plan, status } = mapAppleStatus(verified.status);

  db.prepare(`
    UPDATE subscriptions
    SET plan = ?,
        status = ?,
        platform = 'apple',
        max_stores = MAX(max_stores, 1),
        apple_original_transaction_id = ?,
        apple_transaction_id = ?,
        apple_product_id = ?,
        apple_environment = ?,
        current_period_end = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE company_id = ?
  `).run(
    plan,
    status,
    originalId,
    verified.transaction.transactionId || null,
    verified.transaction.productId || null,
    verified.environment,
    verified.expiresDate,
    companyId,
  );
}

/**
 * 通知に同梱された signedTransactionInfo を検証してデコードする。
 * 通知本体と同じ環境の検証器を使う（環境が分からなければ本番 → Sandbox の順）。
 */
export async function decodeTransactionFromNotification(
  signedTransactionInfo: string,
  environment?: string
): Promise<JWSTransactionDecodedPayload> {
  const order = environment === Environment.SANDBOX
    ? [Environment.SANDBOX, Environment.PRODUCTION]
    : [Environment.PRODUCTION, Environment.SANDBOX];

  let lastError: unknown = null;
  for (const env of order) {
    const verifier = getVerifier(env);
    if (!verifier) break;
    try {
      return await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('APPLE_TRANSACTION_DECODE_FAILED');
}

/** App Store Server Notifications V2 を検証してデコードする（本番 → Sandbox の順に試す） */
export async function verifyNotification(signedPayload: string) {
  const errors: string[] = [];
  for (const environment of [Environment.PRODUCTION, Environment.SANDBOX]) {
    const verifier = getVerifier(environment);
    if (!verifier) break;
    try {
      return { environment, payload: await verifier.verifyAndDecodeNotification(signedPayload) };
    } catch (e) {
      errors.push(`${environment}: ${(e as Error).message}`);
    }
  }
  throw new Error(`APPLE_NOTIFICATION_VERIFICATION_FAILED (${errors.join(' / ')})`);
}
