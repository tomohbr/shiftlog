const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'https://shiftlog-production.up.railway.app';
const OUT = path.join(__dirname, 'screenshots');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2.77 });

  // 1. Login page
  await mobile.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1500);
  await mobile.screenshot({ path: path.join(OUT, '01_login.png'), fullPage: false });
  console.log('1/6 Login page');

  // Login
  try {
    await mobile.type('input[type="email"]', 'admin@example.com');
    await mobile.type('input[type="password"]', 'admin123');
    const buttons = await mobile.$$('button[type="submit"]');
    if (buttons.length > 0) await buttons[0].click();
    await mobile.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await wait(2000);
  } catch (e) {
    console.log('Login attempt:', e.message);
  }

  // 2. Dashboard
  await mobile.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(1500);
  await mobile.screenshot({ path: path.join(OUT, '02_dashboard.png'), fullPage: false });
  console.log('2/6 Dashboard');

  // 3. Shift management
  await mobile.goto(`${BASE_URL}/shifts`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(1500);
  await mobile.screenshot({ path: path.join(OUT, '03_shifts.png'), fullPage: false });
  console.log('3/6 Shifts');

  // 4. Timecards
  await mobile.goto(`${BASE_URL}/timecards`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(1500);
  await mobile.screenshot({ path: path.join(OUT, '04_timecards.png'), fullPage: false });
  console.log('4/6 Timecards');

  // 5. Staff
  await mobile.goto(`${BASE_URL}/staff`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(1500);
  await mobile.screenshot({ path: path.join(OUT, '05_staff.png'), fullPage: false });
  console.log('5/6 Staff');

  // 6. Report
  await mobile.goto(`${BASE_URL}/report`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
  await wait(1500);
  await mobile.screenshot({ path: path.join(OUT, '06_report.png'), fullPage: false });
  console.log('6/6 Report');

  // Feature graphic (1024x500)
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
        h1 { font-size: 48px; font-weight: 800; margin: 0 0 16px; }
        .sub { font-size: 22px; opacity: 0.9; }
        .badge { background: rgba(255,255,255,0.2); padding: 8px 20px; border-radius: 20px; font-size: 18px; margin-top: 20px; display: inline-block; }
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
  await wait(1500);
  await wide.screenshot({ path: path.join(OUT, 'feature_graphic.png') });
  console.log('Feature graphic done');

  await browser.close();
  console.log('\nAll screenshots saved to store-assets/screenshots/');
}

main().catch(console.error);
