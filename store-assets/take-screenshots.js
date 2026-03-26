const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'https://shiftlog-production.up.railway.app';
const OUT = path.join(__dirname, 'screenshots');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // Mobile viewport (iPhone 14 Pro equivalent, scaled for 1080x1920 output)
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2.77 });

  // 1. Login select screen
  await mobile.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(2000);
  await mobile.screenshot({ path: path.join(OUT, '01_login.png'), fullPage: false });
  console.log('1/7 Login page');

  // Click "管理者ログイン" button (3rd button on the select screen)
  try {
    const buttons = await mobile.$$('button');
    for (const btn of buttons) {
      const text = await mobile.evaluate(el => el.textContent, btn);
      if (text && text.includes('管理者ログイン')) {
        await btn.click();
        break;
      }
    }
    await wait(1000);

    // Fill login form
    const emailInput = await mobile.$('input[type="email"]');
    const passwordInput = await mobile.$('input[type="password"]');
    if (emailInput && passwordInput) {
      await emailInput.type('admin@example.com');
      await passwordInput.type('admin123');

      // Click submit
      const submitBtns = await mobile.$$('button[type="submit"]');
      if (submitBtns.length > 0) await submitBtns[0].click();
      await mobile.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      await wait(3000);
      console.log('Logged in successfully');
    } else {
      console.log('Login form not found');
    }
  } catch (e) {
    console.log('Login error:', e.message);
  }

  // 2. Dashboard
  await mobile.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(2000);
  await mobile.screenshot({ path: path.join(OUT, '02_dashboard.png'), fullPage: false });
  console.log('2/7 Dashboard');

  // 3. Shift management
  await mobile.goto(`${BASE_URL}/shifts`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(2000);
  await mobile.screenshot({ path: path.join(OUT, '03_shifts.png'), fullPage: false });
  console.log('3/7 Shifts');

  // 4. Timecards
  await mobile.goto(`${BASE_URL}/timecards`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(2000);
  await mobile.screenshot({ path: path.join(OUT, '04_timecards.png'), fullPage: false });
  console.log('4/7 Timecards');

  // 5. Staff
  await mobile.goto(`${BASE_URL}/staff`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(2000);
  await mobile.screenshot({ path: path.join(OUT, '05_staff.png'), fullPage: false });
  console.log('5/7 Staff');

  // 6. Report
  await mobile.goto(`${BASE_URL}/report`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(2000);
  await mobile.screenshot({ path: path.join(OUT, '06_report.png'), fullPage: false });
  console.log('6/7 Report');

  // 7. Shift Requests
  await mobile.goto(`${BASE_URL}/shift-requests`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(2000);
  await mobile.screenshot({ path: path.join(OUT, '07_shift_requests.png'), fullPage: false });
  console.log('7/7 Shift Requests');

  // Feature graphic (1024x500) for Google Play
  const wide = await browser.newPage();
  await wide.setViewport({ width: 1024, height: 500 });
  await wide.setContent(`
    <html>
    <head>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700;800&display=swap" rel="stylesheet">
      <style>
        body { margin: 0; font-family: 'Noto Sans JP', sans-serif; }
        .container {
          width: 1024px; height: 500px;
          background: linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%);
          display: flex; align-items: center; justify-content: center;
          color: white; text-align: center;
        }
        h1 { font-size: 52px; font-weight: 800; margin: 0 0 12px; }
        .sub { font-size: 24px; opacity: 0.95; }
        .badge { background: rgba(255,255,255,0.2); padding: 10px 24px; border-radius: 24px; font-size: 18px; margin-top: 24px; display: inline-block; }
        .price { color: #fbbf24; font-weight: 800; }
      </style>
    </head>
    <body>
      <div class="container">
        <div>
          <h1>シフトログ</h1>
          <div class="sub">1店舗 <span class="price">完全無料</span> のシフト管理アプリ</div>
          <div class="badge">シフト作成 ・ タイムカード ・ 勤務集計 ・ LINE通知</div>
        </div>
      </div>
    </body>
    </html>
  `, { waitUntil: 'networkidle0' });
  await wait(2000);
  await wide.screenshot({ path: path.join(OUT, 'feature_graphic.png') });
  console.log('Feature graphic done');

  await browser.close();
  console.log('\nAll screenshots saved to store-assets/screenshots/');
}

main().catch(console.error);
