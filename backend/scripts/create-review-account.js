// App Store 審査用のデモアカウントを作成するスクリプト（Guideline 2.1 対応）。
//
// 審査員が使えるアカウントの提出は必須。空のアカウントを渡すと
// 「機能を確認できない」で却下されるため、スタッフ・シフト・打刻データを入れた状態で用意する。
//
// 使い方:
//
//   # 本番サーバーに作る（提出前に一度だけ実行する）
//   cd backend
//   API_BASE=https://shiftlog-production.up.railway.app node scripts/create-review-account.js
//
//   # ローカルで試す
//   node scripts/create-review-account.js            # 既定は http://localhost:3001
//
// 実行すると App Store Connect の「サインイン情報」にそのまま貼れる内容を出力する。
// パスワードと会社PINは実行のたびにランダム生成されるので、出力を必ず控えること。

const API_BASE = (process.env.API_BASE || 'http://localhost:3001').replace(/\/$/, '');

// 審査ごとに作り直せるよう、メールアドレスに日付を入れる
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const EMAIL = process.env.REVIEW_EMAIL || `appreview+${stamp}@shiftlog.app`;
const PASSWORD = process.env.REVIEW_PASSWORD || randomPassword();
const COMPANY_NAME = 'シフトログ デモ店舗';
const COMPANY_PIN = process.env.REVIEW_COMPANY_PIN || String(Math.floor(1000 + Math.random() * 9000));

function randomPassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

let token = null;
let companyId = null;

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (companyId) headers['X-Company-Id'] = String(companyId);
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 本文なし */ }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// JST の "YYYY-MM-DDTHH:mm"
function jstStamp(daysAgo, hour, minute) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 - daysAgo * 24 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(hour)}:${p(minute)}`;
}

async function main() {
  console.log(`接続先: ${API_BASE}\n`);

  // ---- 1. 管理者アカウントと会社を作成 ----
  const reg = await call('POST', '/api/auth/register', {
    email: EMAIL,
    password: PASSWORD,
    name: '審査用 管理者',
    companyName: COMPANY_NAME,
  });
  token = reg.token;
  companyId = reg.companies[0].id;
  console.log(`✔ 管理者アカウントを作成 (company_id=${companyId})`);

  // ---- 2. 会社PINを設定（スタッフのPINログイン・キオスク打刻に必要）----
  await call('PUT', `/api/companies/${companyId}`, {
    name: COMPANY_NAME,
    company_pin: COMPANY_PIN,
    address: '東京都渋谷区1-2-3',
    phone: '03-1234-5678',
  });
  console.log(`✔ 会社PINを設定`);

  // ---- 3. 店舗・スタッフ・スキル・今週のシフトを投入 ----
  const seeded = await call('POST', '/api/seed/demo', {
    include_store: true, include_staff: true, include_shifts: true, include_skills: true,
  });
  console.log(`✔ デモデータを投入 (店舗${seeded.created.store} / スタッフ${seeded.created.staff} / スキル${seeded.created.skills} / シフト${seeded.created.shifts})`);

  // ---- 4. 過去1週間の打刻データを作る ----
  // 集計・CSV・給与計算の画面に数字が出ていないと「機能が確認できない」と判断される。
  const { users } = await call('GET', '/api/users');
  const staff = users.filter(u => u.role === 'staff');
  let punches = 0;
  for (let daysAgo = 7; daysAgo >= 1; daysAgo--) {
    const date = new Date(Date.now() + 9 * 3600 * 1000 - daysAgo * 24 * 3600 * 1000);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;

    for (const [index, member] of staff.entries()) {
      const inHour = 9 + (index % 2);
      const outHour = inHour + 8;
      try {
        await call('POST', '/api/timecards/clock-in', {
          user_id: member.id,
          client_uuid: `review-${daysAgo}-${member.id}-in`,
          recorded_at: jstStamp(daysAgo, inHour, index * 3),
        });
        await call('POST', '/api/timecards/break-start', {
          user_id: member.id,
          client_uuid: `review-${daysAgo}-${member.id}-bs`,
          recorded_at: jstStamp(daysAgo, 13, 0),
        });
        await call('POST', '/api/timecards/break-end', {
          user_id: member.id,
          client_uuid: `review-${daysAgo}-${member.id}-be`,
          recorded_at: jstStamp(daysAgo, 14, 0),
        });
        await call('POST', '/api/timecards/clock-out', {
          user_id: member.id,
          client_uuid: `review-${daysAgo}-${member.id}-out`,
          recorded_at: jstStamp(daysAgo, outHour, index * 3),
        });
        punches += 4;
      } catch (e) {
        console.warn(`  打刻をスキップ (${daysAgo}日前 / ${member.name}): ${e.message}`);
      }
    }
  }
  console.log(`✔ 打刻データを${punches}件作成`);

  // ---- 5. 今月のシフトを公開する（スタッフ画面で見えるようにする）----
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  await call('POST', '/api/shifts/publication', {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    is_published: true,
  });
  console.log(`✔ 今月のシフトを公開`);

  // ---- 6. スタッフの希望シフト受付を開始する ----
  try {
    const next = new Date(now.getTime());
    next.setUTCMonth(next.getUTCMonth() + 1);
    await call('POST', '/api/shift-requests/period', {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      status: 'open',
    });
    console.log(`✔ 来月のシフト希望の受付を開始`);
  } catch (e) {
    console.warn(`  希望受付の設定をスキップ: ${e.message}`);
  }

  const staffPins = staff.map(s => `${s.name}（PIN ${s.pin || '未設定'}）`).join(' / ');

  console.log(`
============================================================
App Store Connect の「App Review に関する情報」に貼る内容
============================================================

【サインインが必要】: はい

ユーザ名: ${EMAIL}
パスワード: ${PASSWORD}

【メモ（Notes）に貼る内容】

■ ログイン方法（2種類あります）

1) オーナー・店長としてログイン
   起動画面の「オーナー・店長ログイン」を選び、上記のメールアドレスとパスワードを入力してください。
   シフト作成、勤務集計、スタッフ管理、給与計算のすべてを確認できます。

2) スタッフとしてログイン（PINのみ・パスワード不要）
   起動画面の「スタッフログイン」→ 会社PIN「${COMPANY_PIN}」を入力 → 一覧から名前をタップ。
   登録済みスタッフ: ${staffPins}

■ 出退勤の打刻を確認する方法
   スタッフとしてログインすると最初に打刻画面が開きます。「出勤」→「休憩開始」→「休憩終了」→「退勤」の順にタップできます。
   店舗のタブレットを共有端末として使う「キオスク打刻」は、起動画面の「出退勤の打刻」から会社PINを入力して確認できます。

■ ネイティブ機能について（Guideline 4.2）
   このアプリは Web サイトのラッパーではなく、以下は iOS ネイティブでのみ動作します。

   ・オフライン打刻
     機内モードにしてから打刻してください。「端末に記録しました」と表示され、打刻は端末内に保存されます。
     機内モードを解除すると自動的にサーバーへ送信され、「未同期だった打刻を送信しました」と表示されます。
     打刻時刻は通信が回復した時刻ではなく、実際に打刻した時刻で記録されます。
     厨房・バックヤード・地下の店舗では電波が届かないことが多く、この機能が本アプリの中心的な価値です。

   ・プッシュ通知（APNs）
     シフトの公開、交代依頼、ヘルプ募集、シフト希望の受付開始を通知します。
     オーナーとしてログインし「シフト管理」から今月のシフトを公開し直すと、通知が届きます。
     設定画面の「通知」からテスト通知も送れます。

   ・Face ID / Touch ID
     設定画面の「セキュリティ」で「Face IDでアプリをロック」を有効にすると、
     アプリを一度バックグラウンドに送って戻したときに生体認証が要求されます。
     ログイン画面では、一度ログインした後に Face ID でのログインも選べます。

■ App内課金
   設定画面の「プラン」から「Proにアップグレード」を選ぶと、StoreKit の購入画面が表示されます。
   購入後は Apple の取引IDをサーバーで検証し、Proプランが有効になります。
   iOS アプリ内には外部決済（Stripe）への導線はありません。

■ アカウント削除（Guideline 5.1.1(v)）
   設定画面の一番下「アカウントの削除」から、アプリ内で完全に削除できます。
   削除前に「何が消えるか」を提示します。

============================================================
※ このアカウントの情報は控えておいてください。パスワードは再表示できません。
※ 審査が終わったら、設定画面の「アカウントの削除」から削除できます。
============================================================
`);
}

main().catch(e => {
  console.error('\n失敗:', e.message);
  process.exit(1);
});
