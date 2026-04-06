import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/auth';
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
import feedbackRoutes from './routes/feedback';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));

// Stripe webhook needs raw body for signature verification
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

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
app.use('/api/feedback', feedbackRoutes);

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

export default app;
