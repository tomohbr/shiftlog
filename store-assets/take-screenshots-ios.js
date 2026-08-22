// App Store 用スクリーンショット撮影スクリプト
//
// 既存の take-screenshots.js は Google Play 向け（1080x2338）で、App Store には使えない。
// こちらは iPhone 6.9インチ の必須サイズ 1320x2868 で出力する。
//
//   npm install puppeteer
//   node take-screenshots-ios.js
//
// ログイン情報は環境変数で渡す:
//   SHIFTLOG_EMAIL=xxx SHIFTLOG_PASSWORD=yyy node take-screenshots-ios.js

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.SHIFTLOG_URL || 'https://shiftlog-production.up.railway.app';
const EMAIL = process.env.SHIFTLOG_EMAIL || 'admin@example.com';
const PASSWORD = process.env.SHIFTLOG_PASSWORD || 'admin123';
const OUT = path.join(__dirname, 'screenshots-ios');

// iPhone 6.9インチ: 440 x 956 論理ピクセル × 3 = 1320 x 2868
const VIEWPORT = { width: 440, height: 956, deviceScaleFactor: 3 };

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const PAGES = [
  { file: '02_dashboard.png', url: '/dashboard', label: 'ダッシュボード' },
  { file: '03_shifts.png', url: '/shifts', label: 'シフト編集' },
  { file: '04_timecards.png', url: '/timecards', label: '打刻' },
  { file: '05_shift_requests.png', url: '/shift-requests', label: 'シフト希望' },
  { file: '06_report.png', url: '/report', label: '集計・給与' },
  { file: '07_staff.png', url: '/staff', label: 'スタッフ管理' },
];

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // 1. ログイン画面
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(2000);
  await page.screenshot({ path: path.join(OUT, '01_login.png') });
  console.log('撮影: ログイン画面');

  // 管理者ログイン
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('管理者ログイン')) {
        await btn.click();
        break;
      }
    }
    await wait(1000);

    const emailInput = await page.$('input[type="email"]');
    const passwordInput = await page.$('input[type="password"]');
    if (!emailInput || !passwordInput) {
      throw new Error('ログインフォームが見つかりません');
    }

    await emailInput.type(EMAIL);
    await passwordInput.type(PASSWORD);

    const submitBtns = await page.$$('button[type="submit"]');
    if (submitBtns.length > 0) await submitBtns[0].click();
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await wait(3000);
    console.log('ログイン成功');
  } catch (e) {
    console.error('ログインに失敗しました:', e.message);
    console.error('SHIFTLOG_EMAIL / SHIFTLOG_PASSWORD を確認してください。');
    await browser.close();
    process.exit(1);
  }

  // 2. 各画面
  for (const target of PAGES) {
    await page.goto(`${BASE_URL}${target.url}`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await wait(2500);
    await page.screenshot({ path: path.join(OUT, target.file) });
    console.log(`撮影: ${target.label}`);
  }

  await browser.close();
  console.log(`\n完了: ${OUT} に出力しました（1320x2868）`);
  console.log('App Store Connect にアップロードする前に、実際のサイズを確認してください:');
  console.log(`  sips -g pixelWidth -g pixelHeight ${OUT}/*.png`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
