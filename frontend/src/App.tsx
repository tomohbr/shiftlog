import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import LandingPage from './pages/LandingPage'
import TokushohoPage from './pages/TokushohoPage'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage'
import TermsPage from './pages/TermsPage'
import DashboardPage from './pages/DashboardPage'
import OnboardingPage from './pages/OnboardingPage'
import StaffPage from './pages/StaffPage'
import ShiftEditPage from './pages/ShiftEditPage'
import ReportPage from './pages/ReportPage'
import StorePage from './pages/StorePage'
import CompanyPage from './pages/CompanyPage'
import TimecardPage from './pages/TimecardPage'
import ProfilePage from './pages/ProfilePage'
import ShiftRequestPage from './pages/ShiftRequestPage'
import MyShiftsPage from './pages/MyShiftsPage'
import LaborPage from './pages/LaborPage'
import AbsencePage from './pages/AbsencePage'
import TemplatePage from './pages/TemplatePage'
import LineSettingsPage from './pages/LineSettingsPage'
import SuperAdminPage from './pages/SuperAdminPage'
import HelpPage from './pages/HelpPage'
import FeedbackPage from './pages/FeedbackPage'
import FeedbackAdminPage from './pages/FeedbackAdminPage'
import AuditLogPage from './pages/AuditLogPage'
import SkillsPage from './pages/SkillsPage'
import SwapsPage from './pages/SwapsPage'
import PayrollPage from './pages/PayrollPage'
import AutoSchedulePage from './pages/AutoSchedulePage'
import AdminHubPage from './pages/AdminHubPage'
import SetupGuidePage from './pages/SetupGuidePage'
import OrganizationPage from './pages/OrganizationPage'
import QrPosterPage from './pages/QrPosterPage'
import Layout from './components/Layout'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { KioskProvider } from './contexts/KioskContext'
import NativeShell from './native/NativeShell'

function AppRoutes() {
  const { user, selectedCompany, loading, justRegistered } = useAuth()
  const location = useLocation()

  // 法的ページはログイン状態に関係なく表示。
  // プライバシーポリシーは App Store Connect に提出する単独URLでもあるため、
  // 未ログインでもそのまま開けなければならない。
  if (location.pathname === '/legal/tokusho') {
    return <TokushohoPage />
  }
  if (location.pathname === '/legal/privacy') {
    return <PrivacyPolicyPage />
  }
  if (location.pathname === '/legal/terms') {
    return <TermsPage />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  const isAdminRole = user.role === 'admin' || user.role === 'super_admin'

  // No company selected - show company selection
  if (!selectedCompany && isAdminRole) {
    return (
      <Layout>
        <Routes>
          <Route path="/" element={<CompanyPage />} />
          <Route path="/companies" element={<CompanyPage />} />
          <Route path="*" element={<Navigate to="/companies" replace />} />
        </Routes>
      </Layout>
    )
  }

  // Staff with no company
  if (!selectedCompany) {
    return (
      <Layout>
        <div className="p-8 text-center text-gray-500">
          所属する会社がありません。管理者にお問い合わせください。
        </div>
      </Layout>
    )
  }

  // 印刷用QRポスターはレイアウト（サイドバー等）なしの独立ページとして表示する
  if (isAdminRole && location.pathname === '/qr-poster') {
    return <QrPosterPage />
  }

  // 登録直後は、サイドバー等のない全画面ウィザードで初期設定を案内する
  if (isAdminRole && justRegistered) {
    return <OnboardingPage />
  }

  // Admin / Super admin gets full access
  if (isAdminRole) {
    return (
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/shifts" element={<ShiftEditPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/stores" element={<StorePage />} />
          <Route path="/companies" element={<CompanyPage />} />
          <Route path="/timecards" element={<TimecardPage />} />
          <Route path="/shift-requests" element={<ShiftRequestPage />} />
          <Route path="/labor" element={<LaborPage />} />
          <Route path="/absence" element={<AbsencePage />} />
          <Route path="/templates" element={<TemplatePage />} />
          <Route path="/line-settings" element={<LineSettingsPage />} />
          <Route path="/settings" element={<ProfilePage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/audit-logs" element={<AuditLogPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/swaps" element={<SwapsPage />} />
          <Route path="/payroll" element={<PayrollPage />} />
          <Route path="/auto-schedule" element={<AutoSchedulePage />} />
          <Route path="/admin-hub" element={<AdminHubPage />} />
          <Route path="/setup-guide" element={<SetupGuidePage />} />
          <Route path="/organization" element={<OrganizationPage />} />
          {user.role === 'super_admin' && (
            <>
              <Route path="/admin" element={<SuperAdminPage />} />
              <Route path="/feedback-admin" element={<FeedbackAdminPage />} />
            </>
          )}
          <Route path="/login" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout>
    )
  }

  // Staff gets limited routes
  // 会社設定「スタッフの最初の画面」に応じてTOPを切り替える（既定はタイムカード）
  const staffHomePath = ['timecards', 'my-shifts', 'shift-requests'].includes(selectedCompany.staff_home || '')
    ? `/${selectedCompany.staff_home}`
    : '/timecards'
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to={staffHomePath} replace />} />
        <Route path="/timecards" element={<TimecardPage />} />
        <Route path="/my-shifts" element={<MyShiftsPage />} />
        <Route path="/shift-requests" element={<ShiftRequestPage />} />
        <Route path="/absence" element={<AbsencePage />} />
        <Route path="/swaps" element={<SwapsPage />} />
        <Route path="/setup-guide" element={<SetupGuidePage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/login" element={<Navigate to={staffHomePath} replace />} />
        <Route path="*" element={<Navigate to={staffHomePath} replace />} />
      </Routes>
    </Layout>
  )
}

function App() {
  return (
    <AuthProvider>
      <KioskProvider>
        {/* iOSアプリのアプリロック・プッシュ通知・オフライン同期の通知。Webでは何もしない */}
        <NativeShell>
          <AppRoutes />
        </NativeShell>
      </KioskProvider>
    </AuthProvider>
  )
}

export default App
