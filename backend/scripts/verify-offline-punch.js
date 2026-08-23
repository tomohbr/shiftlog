// オフライン打刻の検証スクリプト（App Store ガイドライン 4.2 対応機能の確認用）
//
// 実サーバーを一時DBで起動して、HTTP 経由で打刻APIを叩く。
//
//   cd backend
//   npm run build
//   node scripts/verify-offline-punch.js
//
// 確認すること:
//   - recorded_at を渡すと、サーバー時刻ではなく端末が打った時刻で記録される
//   - 同じ client_uuid を再送しても二重打刻にならない（冪等）
//   - 未来 / 古すぎる時刻は拒否される
//   - オフライン由来の打刻に has_offline_punch の印が付く
//   - recorded_at 無しの通常打刻はこれまでどおりサーバー時刻で動く

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = '/tmp/shiftlog-offline-punch-test.db';

// このスクリプト自身も同じDBを直接読むので、require より前に指定しておく。
// 指定を忘れると backend/data/shiftlog.db（開発用DB）を掴んでしまう。
process.env.DB_PATH = DB_PATH;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}  (実際: ${JSON.stringify(actual)} / 期待: ${JSON.stringify(expected)})`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// JST の "YYYY-MM-DDTHH:mm"
function jstStamp(offsetMinutes = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetMinutes * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

let token = null;
let companyId = null;

async function apiCall(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (companyId) headers['X-Company-Id'] = String(companyId);
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 本文なし */ }
  return { status: res.status, data };
}

async function waitForServer(proc) {
  for (let i = 0; i < 60; i++) {
    if (proc.exitCode !== null) throw new Error('サーバーが起動前に終了しました');
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* まだ起動していない */ }
    await sleep(250);
  }
  throw new Error('サーバーが起動しませんでした');
}

async function main() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* 無ければよい */ }
  }

  const server = spawn('node', [path.join(__dirname, '..', 'dist', 'index.js')], {
    env: { ...process.env, DB_PATH, PORT: String(PORT), JWT_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = [];
  server.stdout.on('data', d => serverLog.push(d.toString()));
  server.stderr.on('data', d => serverLog.push(d.toString()));

  try {
    await waitForServer(server);

    // ---- 準備: 管理者を登録 ----
    const reg = await apiCall('POST', '/api/auth/register', {
      email: 'offline-test@example.com',
      password: 'password123',
      name: 'テスト店長',
      companyName: 'オフライン打刻テスト店',
    });
    if (reg.status !== 200 && reg.status !== 201) {
      throw new Error(`登録に失敗: ${reg.status} ${JSON.stringify(reg.data)}`);
    }
    token = reg.data.token;
    companyId = reg.data.companies[0].id;
    const userId = reg.data.user.id;
    console.log(`\n準備完了: user=${userId} company=${companyId}\n`);

    const db = require('../dist/db.js').default;
    const recordsFor = date =>
      db.prepare('SELECT * FROM time_records WHERE company_id = ? AND date = ?').all(companyId, date);

    // -----------------------------------------------------------------
    console.log('--- 1. オフライン打刻: 端末が申告した時刻で記録される ---');
    // 3時間前に出勤し、圏外だったので今になって送られてきた想定
    const clockInAt = jstStamp(-180);
    const inRes = await apiCall('POST', '/api/timecards/clock-in', {
      user_id: userId,
      client_uuid: 'uuid-clock-in-1',
      recorded_at: clockInAt,
    });
    check('出勤打刻が作成される', inRes.status, 201);
    check('日付が端末の申告どおり', inRes.data.record.date, clockInAt.slice(0, 10));
    check('時刻が端末の申告どおり（サーバー時刻ではない）', inRes.data.record.clock_in, clockInAt.slice(11, 16));
    check('オフライン由来の印が付く', inRes.data.record.has_offline_punch, 1);

    const receipt = db.prepare('SELECT * FROM punch_receipts WHERE client_uuid = ?').get('uuid-clock-in-1');
    check('受領記録が残る', !!receipt, true);
    check('受領記録の action', receipt.action, 'clock_in');
    check('端末申告時刻が保存される', receipt.device_recorded_at, clockInAt.replace('T', ' '));
    check('source が offline', receipt.source, 'offline');

    // -----------------------------------------------------------------
    console.log('\n--- 2. 冪等性: 同じ client_uuid を再送しても二重打刻にならない ---');
    const retry = await apiCall('POST', '/api/timecards/clock-in', {
      user_id: userId,
      client_uuid: 'uuid-clock-in-1',
      recorded_at: clockInAt,
    });
    check('再送は 200 で返る', retry.status, 200);
    check('duplicate フラグが立つ', retry.data.duplicate, true);
    check('同じレコードが返る', retry.data.record.id, inRes.data.record.id);
    check('打刻レコードは1件のまま', recordsFor(clockInAt.slice(0, 10)).length, 1);

    // -----------------------------------------------------------------
    console.log('\n--- 3. 休憩・退勤もオフラインで記録できる ---');
    const breakStartAt = jstStamp(-120);
    const bs = await apiCall('POST', '/api/timecards/break-start', {
      user_id: userId, client_uuid: 'uuid-break-start-1', recorded_at: breakStartAt,
    });
    check('休憩開始', bs.data.record.break_start, breakStartAt.slice(11, 16));

    const breakEndAt = jstStamp(-90);
    const be = await apiCall('POST', '/api/timecards/break-end', {
      user_id: userId, client_uuid: 'uuid-break-end-1', recorded_at: breakEndAt,
    });
    check('休憩終了', be.data.record.break_end, breakEndAt.slice(11, 16));
    check('休憩時間が30分と計算される', be.data.record.break_minutes, 30);

    const clockOutAt = jstStamp(-30);
    const out = await apiCall('POST', '/api/timecards/clock-out', {
      user_id: userId, client_uuid: 'uuid-clock-out-1', recorded_at: clockOutAt,
    });
    check('退勤打刻', out.data.record.clock_out, clockOutAt.slice(11, 16));
    check('ステータスが closed', out.data.record.status, 'closed');
    check('休憩30分が引き継がれる', out.data.record.break_minutes, 30);

    // -----------------------------------------------------------------
    console.log('\n--- 4. 不正な時刻は拒否される ---');
    const future = await apiCall('POST', '/api/timecards/clock-in', {
      user_id: userId, client_uuid: 'uuid-future', recorded_at: jstStamp(60),
    });
    check('1時間先の打刻は拒否', future.status, 400);
    check('拒否の理由が返る', future.data.error, '未来の時刻では打刻できません。端末の時計を確認してください。');

    const tooOld = await apiCall('POST', '/api/timecards/clock-in', {
      user_id: userId, client_uuid: 'uuid-too-old', recorded_at: jstStamp(-20 * 24 * 60),
    });
    check('20日前の打刻は拒否', tooOld.status, 400);

    const malformed = await apiCall('POST', '/api/timecards/clock-in', {
      user_id: userId, client_uuid: 'uuid-malformed', recorded_at: 'きのうの朝',
    });
    check('形式不正は拒否', malformed.status, 400);

    check('拒否された打刻の受領記録は作られない',
      db.prepare("SELECT COUNT(*) as n FROM punch_receipts WHERE client_uuid IN ('uuid-future','uuid-too-old','uuid-malformed')").get().n, 0);

    // -----------------------------------------------------------------
    console.log('\n--- 5. わずかな時計のズレ（+3分）は許容する ---');
    const skewDate = jstStamp(3);
    // 別日にならないよう、当日分を一度片付けてから試す
    db.prepare('DELETE FROM time_records WHERE company_id = ?').run(companyId);
    db.prepare('DELETE FROM punch_receipts WHERE company_id = ?').run(companyId);
    const skew = await apiCall('POST', '/api/timecards/clock-in', {
      user_id: userId, client_uuid: 'uuid-skew', recorded_at: skewDate,
    });
    check('3分先の打刻は受け付ける', skew.status, 201);

    // -----------------------------------------------------------------
    console.log('\n--- 6. recorded_at 無し（Webからの通常打刻）は従来どおり ---');
    db.prepare('DELETE FROM time_records WHERE company_id = ?').run(companyId);
    db.prepare('DELETE FROM punch_receipts WHERE company_id = ?').run(companyId);
    const normal = await apiCall('POST', '/api/timecards/clock-in', { user_id: userId });
    check('通常打刻が作成される', normal.status, 201);
    check('オフラインの印は付かない', normal.data.record.has_offline_punch, 0);
    const serverNow = jstStamp();
    check('サーバーのJST日付で記録される', normal.data.record.date, serverNow.slice(0, 10));
    check('client_uuid 無しでは受領記録を作らない',
      db.prepare('SELECT COUNT(*) as n FROM punch_receipts').get().n, 0);

    // -----------------------------------------------------------------
    console.log('\n--- 7. 二重出勤は 409 で弾かれる（キューが詰まらないよう再送不可を示す） ---');
    const dup = await apiCall('POST', '/api/timecards/clock-in', {
      user_id: userId, client_uuid: 'uuid-dup', recorded_at: jstStamp(-10),
    });
    check('既に出勤済みなら 409', dup.status, 409);

    // -----------------------------------------------------------------
    console.log('\n--- 8. アカウント削除で打刻の受領記録も消える（5.1.1(v)） ---');
    await apiCall('POST', '/api/timecards/clock-out', {
      user_id: userId, client_uuid: 'uuid-final-out', recorded_at: jstStamp(-1),
    });
    check('削除前に受領記録がある', db.prepare('SELECT COUNT(*) as n FROM punch_receipts').get().n, 1);

    const del = await apiCall('DELETE', '/api/auth/account', { password: 'password123' });
    check('アカウント削除が成功', del.status, 200);
    check('受領記録が残らない', db.prepare('SELECT COUNT(*) as n FROM punch_receipts').get().n, 0);
    check('打刻レコードが残らない', db.prepare('SELECT COUNT(*) as n FROM time_records').get().n, 0);

    console.log('\n========================================');
    console.log(failures === 0 ? '✅ すべてのチェックをパスしました' : `❌ ${failures}件の失敗があります`);
    console.log('========================================');
  } catch (e) {
    failures++;
    console.error('\n検証中にエラー:', e.message);
    console.error('--- サーバーログ ---\n' + serverLog.join(''));
  } finally {
    server.kill('SIGTERM');
  }

  process.exit(failures === 0 ? 0 : 1);
}

main();
