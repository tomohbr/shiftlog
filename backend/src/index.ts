import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/auth';
import redirectRoutes from './routes/redirect';
import userRoutes from './routes/users';
import shiftRoutes from './routes/shifts';
import storeRoutes from './routes/stores';
import companyRoutes from './routes/companies';
import timecardRoutes from './routes/timecards';
import billingRoutes from './routes/billing';
import shiftRequestRoutes from './routes/shift-requests';
import laborRoutes from './routes/labor';
import templateRoutes from './routes/templates';
import absenceRoutes from './routes/absence';
import csvRoutes from './routes/csv';
import lineRoutes from './routes/line';
import adminRoutes from './routes/admin';
import feedbackRoutes from './routes/feedback';
import auditRoutes from './routes/audit';
import skillsRoutes from './routes/skills';
import swapsRoutes from './routes/swaps';
import icalRoutes from './routes/ical';
import autoScheduleRoutes from './routes/auto-schedule';
import payrollRoutes from './routes/payroll';
import seedRoutes from './routes/seed';
import pushRoutes from './routes/push';
import { startTrialNotifier } from './utils/trial-notify';

const app = express();
const PORT = process.env.PORT || 3001;

// iOS ネイティブアプリ（Capacitor）の WebView は capacitor://localhost をオリジンとして送ってくる。
// ALLOWED_ORIGIN を本番URLに固定していると弾かれてアプリが一切通信できなくなるため、
// ネイティブシェルのオリジンは常に許可する。
const NATIVE_ORIGINS = ['capacitor://localhost', 'ionic://localhost', 'http://localhost'];
const configuredOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:3000'];
const allowedOrigins = [...new Set([...configuredOrigins, ...NATIVE_ORIGINS])];

app.use(cors({
  origin: (origin, callback) => {
    // origin なし = 同一オリジン、curl、ネイティブの一部リクエスト
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    // 許可しないオリジンでも例外は投げない。投げると Express のエラーハンドラに落ちて
    // 静的ファイルの配信まで 500 になる（＝サイトが真っ白になる）。
    // CORS ヘッダを付けないだけにして、ブラウザ側に判断させる。
    callback(null, false);
  },
  credentials: true,
}));

// Stripe webhook needs raw body for signature verification
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// 短縮URLはSPAのフォールバックより先に処理する。
app.use('/r', redirectRoutes);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/users', userRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/timecards', timecardRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/shift-requests', shiftRequestRoutes);
app.use('/api/labor', laborRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/absence', absenceRoutes);
app.use('/api/csv', csvRoutes);
app.use('/api/line', lineRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/swaps', swapsRoutes);
app.use('/api/ical', icalRoutes);
app.use('/api/auto-schedule', autoScheduleRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/seed', seedRoutes);
app.use('/api/push', pushRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend in production
// __dirname = backend/dist, so frontend/dist is at ../../frontend/dist
const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// トライアル終了前後のメール通知（SMTP未設定時は自動スキップ）
startTrialNotifier();

export default app;
