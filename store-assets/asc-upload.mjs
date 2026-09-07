#!/usr/bin/env node
// App Store Connect API でスクリーンショットを添付するスクリプト。
//
// ブラウザのアップロード欄はファイル選択ダイアログ経由しか受け付けないため、
// 提出用のスクショはこの API 経由で入れる。
//
// 使い方:
//   ASC_KEY_ID=9X344AQPQ2 ASC_ISSUER_ID=<issuer> ASC_KEY_PATH=~/Downloads/AuthKey_9X344AQPQ2.p8 \
//   node store-assets/asc-upload.mjs app          # アプリ本体のスクショ（screenshots-ios/*.png）
//   node store-assets/asc-upload.mjs iap          # サブスクリプション2商品の審査用スクショ
//   node store-assets/asc-upload.mjs status       # 現状の確認だけ
//
// 依存: backend/node_modules の jsonwebtoken（追加インストール不要）

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const require = createRequire(path.join(process.cwd(), 'backend', 'package.json'));
const jwt = require('jsonwebtoken');

const APP_ID = '6809298467';
const BASE = 'https://api.appstoreconnect.apple.com/v1';
const SHOT_DIR = path.join(process.cwd(), 'store-assets', 'screenshots-ios');
// 1320×2868 は iPhone 6.9インチ。ASC API では 6.7/6.9 とも APP_IPHONE_67 の枠に入る
const DISPLAY_TYPE = 'APP_IPHONE_67';
const SUBSCRIPTIONS = [
  { productId: 'com.tomohbr.shiftlog.pro.monthly', file: '06_report.png' },
  { productId: 'com.tomohbr.shiftlog.pro.yearly', file: '06_report.png' },
];

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が必要です`);
  return v;
}

function token() {
  const keyPath = env('ASC_KEY_PATH').replace(/^~/, os.homedir());
  const privateKey = fs.readFileSync(keyPath, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: env('ASC_ISSUER_ID'), iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' },
    privateKey,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: env('ASC_KEY_ID'), typ: 'JWT' } }
  );
}

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(data).slice(0, 600)}`);
  }
  return data;
}

// 予約 → チャンクPUT → コミット の共通処理（appScreenshots / subscriptionAppStoreReviewScreenshots 共通）
async function uploadAsset(createPath, createBody, filePath) {
  const bytes = fs.readFileSync(filePath);
  const created = await api('POST', createPath, {
    data: { type: createBody.type, attributes: { fileName: path.basename(filePath), fileSize: bytes.length }, relationships: createBody.relationships },
  });
  const asset = created.data;
  const ops = asset.attributes.uploadOperations || [];
  for (const op of ops) {
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const headers = {};
    for (const h of op.requestHeaders || []) headers[h.name] = h.value;
    const r = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!r.ok) throw new Error(`chunk upload failed: ${r.status} ${await r.text()}`);
  }
  const md5 = crypto.createHash('md5').update(bytes).digest('hex');
  await api('PATCH', `${createPath.split('?')[0]}/${asset.id}`, {
    data: { type: createBody.type, id: asset.id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
  });
  return asset.id;
}

async function getVersionLocalization() {
  const versions = await api('GET', `/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=5`);
  const v = versions.data.find(x => ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(x.attributes.appStoreState)) || versions.data[0];
  if (!v) throw new Error('バージョンが見つかりません');
  const locs = await api('GET', `/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
  const ja = locs.data.find(l => l.attributes.locale === 'ja') || locs.data[0];
  return { version: v, localization: ja };
}

async function uploadAppScreenshots() {
  const { version, localization } = await getVersionLocalization();
  console.log(`バージョン ${version.attributes.versionString} (${version.attributes.appStoreState}) / locale ${localization.attributes.locale}`);

  const sets = await api('GET', `/appStoreVersionLocalizations/${localization.id}/appScreenshotSets`);
  let set = sets.data.find(s => s.attributes.screenshotDisplayType === DISPLAY_TYPE);
  if (!set) {
    set = (await api('POST', '/appScreenshotSets', {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: DISPLAY_TYPE },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localization.id } } },
      },
    })).data;
    console.log(`スクリーンショットセット作成: ${DISPLAY_TYPE}`);
  }

  const existing = await api('GET', `/appScreenshotSets/${set.id}/appScreenshots?limit=20`);
  const have = new Set(existing.data.map(s => s.attributes.fileName));
  // 訴求順（打刻 → ダッシュボード → シフト → 集計 → 希望 → スタッフ → ログイン）
  const order = ['04_timecards.png', '02_dashboard.png', '03_shifts.png', '06_report.png', '05_shift_requests.png', '07_staff.png', '01_login.png'];
  const ids = [];
  for (const f of order) {
    if (have.has(f)) { console.log(`スキップ（既存）: ${f}`); continue; }
    const id = await uploadAsset('/appScreenshots', {
      type: 'appScreenshots',
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
    }, path.join(SHOT_DIR, f));
    ids.push(id);
    console.log(`アップロード: ${f} → ${id}`);
  }
  const after = await api('GET', `/appScreenshotSets/${set.id}/appScreenshots?limit=20`);
  for (const s of after.data) {
    console.log(`  ${s.attributes.fileName}  ${s.attributes.assetDeliveryState?.state}`);
  }
}

async function uploadIapScreenshots() {
  const groups = await api('GET', `/apps/${APP_ID}/subscriptionGroups`);
  for (const g of groups.data) {
    const subs = await api('GET', `/subscriptionGroups/${g.id}/subscriptions`);
    for (const s of subs.data) {
      const spec = SUBSCRIPTIONS.find(x => x.productId === s.attributes.productId);
      if (!spec) continue;
      let current = null;
      try { current = (await api('GET', `/subscriptions/${s.id}/appStoreReviewScreenshot`)).data; } catch { current = null; }
      if (current) { console.log(`スキップ（既存）: ${s.attributes.productId} → ${current.attributes.fileName}`); continue; }
      const id = await uploadAsset('/subscriptionAppStoreReviewScreenshots', {
        type: 'subscriptionAppStoreReviewScreenshots',
        relationships: { subscription: { data: { type: 'subscriptions', id: s.id } } },
      }, path.join(SHOT_DIR, spec.file));
      console.log(`アップロード: ${s.attributes.productId} ← ${spec.file} → ${id}`);
    }
  }
}

async function status() {
  const { version, localization } = await getVersionLocalization();
  console.log(`バージョン ${version.attributes.versionString}: ${version.attributes.appStoreState}`);
  const sets = await api('GET', `/appStoreVersionLocalizations/${localization.id}/appScreenshotSets`);
  for (const set of sets.data) {
    const shots = await api('GET', `/appScreenshotSets/${set.id}/appScreenshots?limit=20`);
    console.log(`  ${set.attributes.screenshotDisplayType}: ${shots.data.length}枚 ${shots.data.map(s => s.attributes.assetDeliveryState?.state).join(',')}`);
  }
  const groups = await api('GET', `/apps/${APP_ID}/subscriptionGroups`);
  for (const g of groups.data) {
    const subs = await api('GET', `/subscriptionGroups/${g.id}/subscriptions`);
    for (const s of subs.data) {
      let shot = 'なし';
      try { shot = (await api('GET', `/subscriptions/${s.id}/appStoreReviewScreenshot`)).data?.attributes?.fileName || 'なし'; } catch { /* 未添付 */ }
      console.log(`  IAP ${s.attributes.productId} (${s.attributes.state}) 審査用スクショ: ${shot}`);
    }
  }
}

const cmd = process.argv[2] || 'status';
const run = { app: uploadAppScreenshots, iap: uploadIapScreenshots, status }[cmd];
if (!run) { console.error('使い方: node store-assets/asc-upload.mjs app|iap|status'); process.exit(1); }
run().catch(e => { console.error('失敗:', e.message); process.exit(1); });
