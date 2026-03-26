import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'workshift.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company_pin TEXT,
    address TEXT,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    password TEXT,
    name TEXT NOT NULL,
    pin TEXT,
    role TEXT NOT NULL DEFAULT 'staff',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    company_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    employment_type TEXT NOT NULL DEFAULT 'part_time',
    color TEXT DEFAULT '#4A90E2',
    hourly_wage INTEGER DEFAULT 0,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(user_id, company_id)
  );

  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    break_minutes INTEGER DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'confirmed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS time_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    clock_in TEXT,
    clock_out TEXT,
    break_start TEXT,
    break_end TEXT,
    break_minutes INTEGER DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS shift_publications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    is_published INTEGER DEFAULT 0,
    published_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, year, month)
  );
`);

// ---- New feature tables ----
db.exec(`
  -- 希望シフト収集
  CREATE TABLE IF NOT EXISTS shift_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    availability TEXT NOT NULL DEFAULT 'available',
    preferred_start TEXT,
    preferred_end TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(company_id, user_id, date)
  );

  -- 希望シフト収集期間
  CREATE TABLE IF NOT EXISTS shift_request_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, year, month)
  );

  -- 日次売上
  CREATE TABLE IF NOT EXISTS daily_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, date)
  );

  -- シフトテンプレート
  CREATE TABLE IF NOT EXISTS shift_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    break_minutes INTEGER DEFAULT 0,
    color TEXT DEFAULT '#4A90E2',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  -- 欠勤連絡・ヘルプ募集
  CREATE TABLE IF NOT EXISTS absence_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    shift_id INTEGER,
    date TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    cover_user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (shift_id) REFERENCES shifts(id),
    FOREIGN KEY (cover_user_id) REFERENCES users(id)
  );

  -- LINE連携
  CREATE TABLE IF NOT EXISTS line_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL UNIQUE,
    channel_access_token TEXT,
    notify_shift_published INTEGER DEFAULT 1,
    notify_shift_changed INTEGER DEFAULT 1,
    notify_help_request INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  -- ユーザーのLINE ID
  CREATE TABLE IF NOT EXISTS user_line_ids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    line_user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ---- Subscriptions table ----
db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    max_stores INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    current_period_end TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );
`);

// ---- Migrations for existing DBs ----
try {
  const userCols = db.prepare("PRAGMA table_info(users)").all().map((c: any) => c.name);
  if (!userCols.includes('pin')) {
    db.exec("ALTER TABLE users ADD COLUMN pin TEXT");
  }
  const compCols = db.prepare("PRAGMA table_info(companies)").all().map((c: any) => c.name);
  if (!compCols.includes('company_pin')) {
    db.exec("ALTER TABLE companies ADD COLUMN company_pin TEXT");
  }
  const ucCols = db.prepare("PRAGMA table_info(user_companies)").all().map((c: any) => c.name);
  if (!ucCols.includes('employment_type')) {
    db.exec("ALTER TABLE user_companies ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'part_time'");
  }
  // Ensure existing companies have a subscription record (free plan)
  const companiesWithoutSub = db.prepare(`
    SELECT c.id FROM companies c
    LEFT JOIN subscriptions s ON s.company_id = c.id
    WHERE s.id IS NULL
  `).all() as { id: number }[];
  for (const comp of companiesWithoutSub) {
    db.prepare('INSERT INTO subscriptions (company_id, plan, max_stores) VALUES (?, ?, ?)').run(comp.id, 'free', 1);
  }
} catch (e) { /* tables may not exist yet */ }

function seedData() {
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@example.com');
  if (existingAdmin) return;

  const adminHash = bcrypt.hashSync('admin123', 10);
  const adminResult = db.prepare(
    'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)'
  ).run('admin@example.com', adminHash, '管理者', 'admin');
  const adminId = adminResult.lastInsertRowid;

  const companyResult = db.prepare(
    'INSERT INTO companies (name, company_pin, address, phone) VALUES (?, ?, ?, ?)'
  ).run('サンプル株式会社', '1234', '東京都渋谷区1-1-1', '03-1234-5678');
  const companyId = companyResult.lastInsertRowid;

  db.prepare(
    'INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)'
  ).run(adminId, companyId, 'admin');

  db.prepare(
    'INSERT INTO stores (company_id, name, address, phone) VALUES (?, ?, ?, ?)'
  ).run(companyId, 'サンプル店舗', '東京都渋谷区1-1-1', '03-1234-5678');

  const staffColors = ['#E74C3C', '#2ECC71', '#F39C12', '#9B59B6', '#1ABC9C'];
  const staffNames = ['田中 太郎', '鈴木 花子', '佐藤 次郎', '高橋 美咲', '伊藤 健太'];
  const staffEmails = ['staff1@example.com', 'staff2@example.com', 'staff3@example.com', 'staff4@example.com', 'staff5@example.com'];

  const employmentTypes = ['full_time', 'part_time', 'part_time', 'part_time', 'full_time'];
  for (let i = 0; i < 5; i++) {
    const hash = bcrypt.hashSync('staff123', 10);
    const pin = String(1001 + i);
    const staffResult = db.prepare(
      'INSERT INTO users (email, password, name, pin, role) VALUES (?, ?, ?, ?, ?)'
    ).run(staffEmails[i], hash, staffNames[i], pin, 'staff');

    db.prepare(
      'INSERT INTO user_companies (user_id, company_id, role, employment_type, color, hourly_wage) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(staffResult.lastInsertRowid, companyId, 'staff', employmentTypes[i], staffColors[i], employmentTypes[i] === 'part_time' ? 1000 + i * 50 : 0);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const staffUsers = db.prepare(`
    SELECT u.id FROM users u
    JOIN user_companies uc ON u.id = uc.user_id
    WHERE uc.company_id = ? AND uc.role = 'staff'
  `).all(companyId) as { id: number }[];

  const shiftTemplates = [
    { start: '09:00', end: '17:00' },
    { start: '12:00', end: '20:00' },
    { start: '17:00', end: '22:00' },
    { start: '10:00', end: '15:00' },
  ];

  for (let day = 1; day <= 28; day++) {
    const date = new Date(year, month, day);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const numShifts = Math.floor(Math.random() * 3) + 1;
    const usedStaff = new Set<number>();
    for (let s = 0; s < numShifts; s++) {
      const staffUser = staffUsers[Math.floor(Math.random() * staffUsers.length)];
      if (usedStaff.has(staffUser.id)) continue;
      usedStaff.add(staffUser.id);
      const template = shiftTemplates[Math.floor(Math.random() * shiftTemplates.length)];
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      db.prepare(
        'INSERT INTO shifts (company_id, user_id, date, start_time, end_time, break_minutes, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(companyId, staffUser.id, dateStr, template.start, template.end, 60, 'confirmed');
    }
  }

  console.log('Database seeded successfully');
}

seedData();

export default db;
