// アカウント削除処理の検証スクリプト（App Store ガイドライン 5.1.1(v) 対応の確認用）
//
// 使い方（本番DBを壊さないよう、必ず一時DBを指定すること）:
//
//   cd backend
//   npm run build
//   rm -f /tmp/shiftlog-test.db*
//   DB_PATH=/tmp/shiftlog-test.db node scripts/verify-account-deletion.js
//
// 会社データの削除・個人データの削除・他ユーザーへの影響・外部キー整合性を確認する。
const db = require('../dist/db.js').default;
const { findSoleAdminCompanies, deleteAccount, deleteCompanyData } = require('../dist/utils/account-deletion.js');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}  (実際: ${JSON.stringify(actual)} / 期待: ${JSON.stringify(expected)})`);
}
const count = (sql, ...args) => db.prepare(sql).get(...args).n;

// ---- テストデータ作成 -------------------------------------------------
// 会社A: X が唯一の管理者、スタッフ Y が所属  → 会社ごと消える想定
// 会社B: X と Z の2人が管理者                → X だけ抜ける想定
const mkUser = (email, name) =>
  db.prepare("INSERT INTO users (email, password, name, role) VALUES (?, 'hash', ?, 'admin')").run(email, name).lastInsertRowid;

const X = mkUser('x@example.com', '退会するユーザー');
const Y = mkUser(null, 'スタッフY');
const Z = mkUser('z@example.com', 'もう一人の管理者');

const A = db.prepare("INSERT INTO companies (name) VALUES ('会社A')").run().lastInsertRowid;
const B = db.prepare("INSERT INTO companies (name) VALUES ('会社B')").run().lastInsertRowid;

const link = (u, c, role) =>
  db.prepare('INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)').run(u, c, role);
link(X, A, 'admin');
link(Y, A, 'staff');
link(X, B, 'admin');
link(Z, B, 'admin');

// 会社Aのデータ（多くのテーブルにまたがらせる）
const storeA = db.prepare("INSERT INTO stores (company_id, name) VALUES (?, '店舗A')").run(A).lastInsertRowid;
db.prepare("INSERT INTO subscriptions (company_id, plan) VALUES (?, 'free')").run(A);
const shiftA = db.prepare("INSERT INTO shifts (company_id, user_id, date, start_time, end_time) VALUES (?, ?, '2026-08-01', '09:00', '18:00')").run(A, Y).lastInsertRowid;
const trA = db.prepare("INSERT INTO time_records (company_id, user_id, date) VALUES (?, ?, '2026-08-01')").run(A, Y).lastInsertRowid;
db.prepare("INSERT INTO time_record_edits (company_id, time_record_id, action, target_user_id) VALUES (?, ?, 'update', ?)").run(A, trA, Y);
db.prepare("INSERT INTO shift_swaps (company_id, requester_id, shift_id, target_user_id) VALUES (?, ?, ?, ?)").run(A, Y, shiftA, X);
db.prepare("INSERT INTO absence_reports (company_id, user_id, date, shift_id, cover_user_id) VALUES (?, ?, '2026-08-01', ?, ?)").run(A, Y, shiftA, X);
db.prepare("INSERT INTO shift_requests (company_id, user_id, date) VALUES (?, ?, '2026-08-02')").run(A, Y);
const skillA = db.prepare("INSERT INTO skills (company_id, name) VALUES (?, 'レジ')").run(A).lastInsertRowid;
db.prepare('INSERT INTO user_skills (user_id, skill_id) VALUES (?, ?)').run(Y, skillA);
db.prepare("INSERT INTO audit_logs (user_id, company_id, action, entity) VALUES (?, ?, 'update', 'shift')").run(X, A);

// 会社Bのデータ（X 本人の分と、残る Z の分）
const shiftB_X = db.prepare("INSERT INTO shifts (company_id, user_id, date, start_time, end_time) VALUES (?, ?, '2026-08-03', '10:00', '19:00')").run(B, X).lastInsertRowid;
const shiftB_Z = db.prepare("INSERT INTO shifts (company_id, user_id, date, start_time, end_time) VALUES (?, ?, '2026-08-03', '10:00', '19:00')").run(B, Z).lastInsertRowid;
db.prepare("INSERT INTO time_records (company_id, user_id, date) VALUES (?, ?, '2026-08-03')").run(B, X);
db.prepare("INSERT INTO time_records (company_id, user_id, date) VALUES (?, ?, '2026-08-03')").run(B, Z);
db.prepare("INSERT INTO shift_swaps (company_id, requester_id, shift_id, target_user_id, responder_id) VALUES (?, ?, ?, ?, ?)").run(B, Z, shiftB_Z, X, X);
db.prepare("INSERT INTO absence_reports (company_id, user_id, date, shift_id, cover_user_id) VALUES (?, ?, '2026-08-03', ?, ?)").run(B, Z, shiftB_Z, X);
db.prepare("INSERT INTO audit_logs (user_id, company_id, action, entity) VALUES (?, ?, 'update', 'shift')").run(X, B);

// X 個人のデータ
db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, 'https://e', 'p', 'a')").run(X);
db.prepare("INSERT INTO ical_tokens (user_id, token) VALUES (?, 'tok')").run(X);

console.log('\n=== 1. 唯一の管理者である会社の判定 ===');
const sole = findSoleAdminCompanies(X);
check('会社Aのみが対象', sole.map(c => c.name), ['会社A']);

console.log('\n=== 2. アカウント削除の実行 ===');
deleteAccount(X, sole.map(c => c.id));
console.log('  実行完了（例外なし）');

console.log('\n=== 3. 会社Aが完全に消えたか ===');
check('companies', count('SELECT COUNT(*) n FROM companies WHERE id = ?', A), 0);
check('stores', count('SELECT COUNT(*) n FROM stores WHERE company_id = ?', A), 0);
check('shifts', count('SELECT COUNT(*) n FROM shifts WHERE company_id = ?', A), 0);
check('time_records', count('SELECT COUNT(*) n FROM time_records WHERE company_id = ?', A), 0);
check('time_record_edits', count('SELECT COUNT(*) n FROM time_record_edits WHERE company_id = ?', A), 0);
check('shift_swaps', count('SELECT COUNT(*) n FROM shift_swaps WHERE company_id = ?', A), 0);
check('absence_reports', count('SELECT COUNT(*) n FROM absence_reports WHERE company_id = ?', A), 0);
check('shift_requests', count('SELECT COUNT(*) n FROM shift_requests WHERE company_id = ?', A), 0);
check('skills', count('SELECT COUNT(*) n FROM skills WHERE company_id = ?', A), 0);
check('user_skills（孤児）', count('SELECT COUNT(*) n FROM user_skills WHERE skill_id = ?', skillA), 0);
check('subscriptions', count('SELECT COUNT(*) n FROM subscriptions WHERE company_id = ?', A), 0);
check('user_companies', count('SELECT COUNT(*) n FROM user_companies WHERE company_id = ?', A), 0);

console.log('\n=== 4. ユーザーの扱い ===');
check('X は削除された', count('SELECT COUNT(*) n FROM users WHERE id = ?', X), 0);
check('Y（所属先が消えたスタッフ）も削除', count('SELECT COUNT(*) n FROM users WHERE id = ?', Y), 0);
check('Z は残る', count('SELECT COUNT(*) n FROM users WHERE id = ?', Z), 1);

console.log('\n=== 5. 会社Bは残り、Xの個人データだけ消えたか ===');
check('会社Bは残る', count('SELECT COUNT(*) n FROM companies WHERE id = ?', B), 1);
check('Zのシフトは残る', count('SELECT COUNT(*) n FROM shifts WHERE id = ?', shiftB_Z), 1);
check('Xのシフトは消えた', count('SELECT COUNT(*) n FROM shifts WHERE id = ?', shiftB_X), 0);
check('Xの打刻は消えた', count('SELECT COUNT(*) n FROM time_records WHERE user_id = ?', X), 0);
check('Zの打刻は残る', count('SELECT COUNT(*) n FROM time_records WHERE user_id = ?', Z), 1);
check('Xのpush購読は消えた', count('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ?', X), 0);
check('XのiCalトークンは消えた', count('SELECT COUNT(*) n FROM ical_tokens WHERE user_id = ?', X), 0);
check('会社BからXは抜けた', count('SELECT COUNT(*) n FROM user_companies WHERE user_id = ?', X), 0);

console.log('\n=== 6. 他人のレコードに残ったXへの参照が外れているか ===');
check('shift_swaps.target_user_id', count('SELECT COUNT(*) n FROM shift_swaps WHERE target_user_id = ?', X), 0);
check('shift_swaps.responder_id', count('SELECT COUNT(*) n FROM shift_swaps WHERE responder_id = ?', X), 0);
check('absence_reports.cover_user_id', count('SELECT COUNT(*) n FROM absence_reports WHERE cover_user_id = ?', X), 0);
check('Zの交代依頼自体は残る', count('SELECT COUNT(*) n FROM shift_swaps WHERE company_id = ?', B), 1);
check('audit_logs は残るがuser_idはNULL', count('SELECT COUNT(*) n FROM audit_logs WHERE user_id = ?', X), 0);
check('会社Bのaudit_logsは残る', count('SELECT COUNT(*) n FROM audit_logs WHERE company_id = ?', B), 1);

console.log('\n=== 7. 外部キー整合性チェック ===');
const fk = db.prepare('PRAGMA foreign_key_check').all();
check('壊れた参照なし', fk.length, 0);
if (fk.length) console.log(JSON.stringify(fk, null, 2));

console.log(`\n${failures === 0 ? '✅ 全項目パス' : `❌ ${failures}件 失敗`}`);
process.exit(failures === 0 ? 0 : 1);
