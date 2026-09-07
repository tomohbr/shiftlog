#!/usr/bin/env node
// App Store Connect API でバージョン 1.0 を審査に提出する（Review Submissions API）。
//
//   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_PATH=... node store-assets/asc-submit.mjs check   # 提出前チェックのみ
//   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_PATH=... node store-assets/asc-submit.mjs submit  # 実際に提出
//
// submit は取り消しにくい操作なので、本人の「提出して」を受けてから実行すること。

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'backend', 'package.json'));
const jwt = require('jsonwebtoken');

const APP_ID = '6809298467';
const BASE = 'https://api.appstoreconnect.apple.com/v1';

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が必要です`);
  return v;
}
function token() {
  const key = fs.readFileSync(env('ASC_KEY_PATH').replace(/^~/, os.homedir()), 'utf8');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: env('ASC_ISSUER_ID'), iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }, key,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: env('ASC_KEY_ID'), typ: 'JWT' } });
}
async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(data).slice(0, 700)}`);
  return data;
}

async function check() {
  const problems = [];
  const version = (await api('GET', `/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=1`)).data[0];
  console.log(`バージョン ${version.attributes.versionString}: ${version.attributes.appStoreState}`);

  const build = (await api('GET', `/appStoreVersions/${version.id}/build`)).data;
  if (!build) problems.push('ビルドが紐付いていない');
  else console.log(`ビルド: ${build.attributes.version} (${build.attributes.processingState})`);

  const loc = (await api('GET', `/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data.find(l => l.attributes.locale === 'ja');
  const a = loc.attributes;
  if (!a.description) problems.push('概要が空');
  if (!a.keywords) problems.push('キーワードが空');
  if (!a.supportUrl) problems.push('サポートURLが空');
  if (a.description?.includes('30名')) problems.push('概要に旧料金（30名）が残っている');

  const sets = (await api('GET', `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data;
  const shots = [];
  for (const set of sets) {
    const s = (await api('GET', `/appScreenshotSets/${set.id}/appScreenshots?limit=20`)).data;
    shots.push(`${set.attributes.screenshotDisplayType}:${s.length}`);
    if (s.some(x => x.attributes.assetDeliveryState?.state !== 'COMPLETE')) problems.push(`スクショ未処理: ${set.attributes.screenshotDisplayType}`);
  }
  console.log(`スクリーンショット: ${shots.join(', ') || 'なし'}`);
  if (sets.length === 0) problems.push('スクリーンショットが無い');

  const rd = (await api('GET', `/appStoreVersions/${version.id}/appStoreReviewDetail`)).data;
  if (!rd?.attributes?.demoAccountName || !rd?.attributes?.demoAccountPassword) problems.push('審査用アカウントが未設定');
  if (!rd?.attributes?.contactPhone) problems.push('連絡先電話番号が未設定');
  console.log(`審査用アカウント: ${rd?.attributes?.demoAccountName || 'なし'} / 連絡先: ${rd?.attributes?.contactFirstName || ''} ${rd?.attributes?.contactLastName || ''}`);

  const groups = (await api('GET', `/apps/${APP_ID}/subscriptionGroups`)).data;
  const subs = [];
  for (const g of groups) {
    for (const s of (await api('GET', `/subscriptionGroups/${g.id}/subscriptions`)).data) {
      subs.push(s);
      console.log(`IAP ${s.attributes.productId}: ${s.attributes.state}`);
      if (!['READY_TO_SUBMIT', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'APPROVED'].includes(s.attributes.state)) problems.push(`IAP が提出できる状態でない: ${s.attributes.productId} (${s.attributes.state})`);
    }
  }

  const existing = (await api('GET', `/reviewSubmissions?filter[app]=${APP_ID}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES&limit=5`)).data;
  if (existing.length) console.log(`既存の提出: ${existing.map(r => r.attributes.state).join(', ')}`);

  if (problems.length) {
    console.log('\n⚠️ 提出前に直すもの:');
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log('\n✅ 提出できる状態です');
  }
  return { version, subs, existing, ok: problems.length === 0 };
}

async function submit() {
  const { version, subs, existing, ok } = await check();
  if (!ok) throw new Error('提出前チェックに失敗');

  let submission = existing.find(r => r.attributes.state === 'READY_FOR_REVIEW');
  if (!submission) {
    submission = (await api('POST', '/reviewSubmissions', {
      data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } },
    })).data;
    console.log(`提出を作成: ${submission.id}`);
  }

  // アプリバージョンだけを項目に入れる。
  // サブスクリプションは Review Submission API の項目にできない（'subscription' は reviewSubmissionItems の
  // 関係ではない）。App Store Connect の各サブスクリプション画面で「審査用に追加」→ 既存の下書きを選んでおく。
  // その下書き（READY_FOR_REVIEW）をここで拾い、バージョンを追加して提出する（docs/ios-release.md §10）。
  const items = [{ type: 'appStoreVersions', id: version.id }];
  for (const item of items) {
    try {
      await api('POST', '/reviewSubmissionItems', {
        data: { type: 'reviewSubmissionItems', relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
          appStoreVersion: { data: item },
        } },
      });
      console.log(`項目を追加: ${item.type} ${item.id}`);
    } catch (e) {
      // 既に追加済みなら先へ
      if (!/already|ALREADY|STATE_ERROR/.test(e.message)) throw e;
      console.log(`項目は追加済み: ${item.type}`);
    }
  }

  const result = await api('PATCH', `/reviewSubmissions/${submission.id}`, {
    data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
  });
  console.log(`\n🚀 提出しました: state=${result.data.attributes.state}`);
  // サブスクリプションがバージョンと一緒に審査待ちになったか確認
  for (const s of subs) {
    const now = (await api('GET', `/subscriptions/${s.id}`)).data;
    console.log(`IAP ${now.attributes.productId}: ${now.attributes.state}`);
  }
}

const cmd = process.argv[2] || 'check';
const run = { check, submit }[cmd];
if (!run) { console.error('使い方: node store-assets/asc-submit.mjs check|submit'); process.exit(1); }
run().catch(e => { console.error('失敗:', e.message); process.exit(1); });
