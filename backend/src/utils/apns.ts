import http2 from 'http2';
import jwt from 'jsonwebtoken';
import db from '../db';

// APNs（Apple Push Notification service）への送信。
//
// iOS ネイティブアプリ向け。HTTP/2 + JWT(ES256) 認証で Apple に直接投げる。
// node-apn などの外部ライブラリは使わない（メンテが止まっており、依存を増やす必要もない）。
//
// 必要な環境変数（未設定なら送信は黙ってスキップする。Web だけの運用に影響を出さないため）:
//   APNS_TEAM_ID      Apple Developer の Team ID（10文字）
//   APNS_KEY_ID       APNs 認証キーの Key ID（10文字）
//   APNS_PRIVATE_KEY  .p8 の中身。改行は \n でエスケープしてもよい
//   APNS_BUNDLE_ID    既定 com.shiftlog.app
//   APNS_ENVIRONMENT  'production'（既定） or 'sandbox'。TestFlight は production 側。
//                     Xcode から直接実機に入れたビルドだけ sandbox。

const PROD_HOST = 'https://api.push.apple.com';
const SANDBOX_HOST = 'https://api.sandbox.push.apple.com';

// Apple の要求: 認証トークンは20分より短い間隔で作り直してはいけない（TooManyProviderTokenUpdates）。
// 有効期限は1時間なので、間をとって50分でローテーションする。
const TOKEN_TTL_MS = 50 * 60 * 1000;

export interface PushPayload {
  title: string;
  body: string;
  /** タップ時にアプリ内で開くパス（例: '/swaps'） */
  path?: string;
  /** 追加データ */
  data?: Record<string, string | number>;
}

interface ApnsConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  host: string;
}

let cachedToken: { value: string; issuedAt: number } | null = null;

function getConfig(): ApnsConfig | null {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const rawKey = process.env.APNS_PRIVATE_KEY;
  if (!teamId || !keyId || !rawKey) return null;

  return {
    teamId,
    keyId,
    // Railway の環境変数に貼るとき改行が \n になりがちなので戻す
    privateKey: rawKey.replace(/\\n/g, '\n'),
    bundleId: process.env.APNS_BUNDLE_ID || 'com.shiftlog.app',
    host: process.env.APNS_ENVIRONMENT === 'sandbox' ? SANDBOX_HOST : PROD_HOST,
  };
}

export function isApnsConfigured(): boolean {
  return getConfig() !== null;
}

function getAuthToken(config: ApnsConfig): string {
  const now = Date.now();
  if (cachedToken && now - cachedToken.issuedAt < TOKEN_TTL_MS) {
    return cachedToken.value;
  }
  const value = jwt.sign(
    { iss: config.teamId, iat: Math.floor(now / 1000) },
    config.privateKey,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: config.keyId } }
  );
  cachedToken = { value, issuedAt: now };
  return value;
}

interface ApnsResult {
  status: number;
  reason?: string;
}

function postToApns(config: ApnsConfig, deviceToken: string, body: string): Promise<ApnsResult> {
  return new Promise(resolve => {
    let settled = false;
    const done = (r: ApnsResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let client: http2.ClientHttp2Session;
    try {
      client = http2.connect(config.host);
    } catch (e) {
      done({ status: 0, reason: (e as Error).message });
      return;
    }

    client.on('error', e => {
      done({ status: 0, reason: (e as Error).message });
      try { client.close(); } catch { /* noop */ }
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${getAuthToken(config)}`,
      'apns-topic': config.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 60 * 60 * 6),
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });

    let status = 0;
    let responseBody = '';
    req.setEncoding('utf8');
    req.on('response', headers => { status = Number(headers[':status']) || 0; });
    req.on('data', chunk => { responseBody += chunk; });
    req.on('error', e => {
      done({ status: 0, reason: (e as Error).message });
      try { client.close(); } catch { /* noop */ }
    });
    req.on('end', () => {
      let reason: string | undefined;
      try { reason = responseBody ? JSON.parse(responseBody).reason : undefined; } catch { /* noop */ }
      done({ status, reason });
      client.close();
    });

    req.setTimeout(10_000, () => {
      req.close();
      done({ status: 0, reason: 'timeout' });
      try { client.close(); } catch { /* noop */ }
    });

    req.end(body);
  });
}

/** 指定ユーザーの全 iOS 端末にプッシュ通知を送る。失敗しても呼び出し元の処理は止めない。 */
export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<number> {
  const config = getConfig();
  if (!config) return 0;

  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return 0;

  const tokens = db.prepare(`
    SELECT token FROM device_tokens
    WHERE platform = 'ios' AND user_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as { token: string }[];
  if (tokens.length === 0) return 0;

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      'content-available': 0,
    },
    path: payload.path,
    ...(payload.data || {}),
  });

  let sent = 0;
  for (const { token } of tokens) {
    const result = await postToApns(config, token, body);
    if (result.status === 200) {
      sent++;
      db.prepare("UPDATE device_tokens SET last_seen_at = CURRENT_TIMESTAMP WHERE token = ?").run(token);
      continue;
    }
    // 端末がアプリを消した／トークンが無効になった場合は登録を消す（送り続けても届かない）
    if (result.status === 410 || result.reason === 'BadDeviceToken' || result.reason === 'Unregistered') {
      db.prepare('DELETE FROM device_tokens WHERE token = ?').run(token);
      continue;
    }
    console.error(`[apns] 送信失敗 status=${result.status} reason=${result.reason ?? '-'}`);
  }
  return sent;
}

/** 会社に所属する全員（送信者を除く）に通知する */
export async function pushToCompany(
  companyId: number,
  payload: PushPayload,
  excludeUserId?: number
): Promise<number> {
  const rows = db.prepare(
    'SELECT user_id FROM user_companies WHERE company_id = ?'
  ).all(companyId) as { user_id: number }[];
  const ids = rows.map(r => r.user_id).filter(id => id !== excludeUserId);
  return sendPushToUsers(ids, payload);
}

/** 呼び出し側を止めない fire-and-forget 版 */
export function pushToCompanyAsync(companyId: number, payload: PushPayload, excludeUserId?: number): void {
  pushToCompany(companyId, payload, excludeUserId).catch(e =>
    console.error('[apns] 通知に失敗:', (e as Error).message)
  );
}

export function pushToUsersAsync(userIds: number[], payload: PushPayload): void {
  sendPushToUsers(userIds, payload).catch(e =>
    console.error('[apns] 通知に失敗:', (e as Error).message)
  );
}
