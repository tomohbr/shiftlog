import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { trackPageView } from './lib/analytics'
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
import VenueSchedulePage from './pages/VenueSchedulePage'
import AdminHubPage from './pages/AdminHubPage'
import SetupGuidePage from './pages/SetupGuidePage'
import OrganizationPage from './pages/OrganizationPage'
import QrPosterPage from './pages/QrPosterPage'
import LineLinkPage from './pages/LineLinkPage'
import QrClockPage from './pages/QrClockPage'
import StoreQrPosterPage from './pages/StoreQrPosterPage'
import LineInvitePage from './pages/LineInvitePage'
import LiffPunchPage from './pages/LiffPunchPage'
import LiffStockPage from './pages/LiffStockPage'
import InventoryPage from './pages/InventoryPage'
import LineInvitePrintPage from './pages/LineInvitePrintPage'
import StaffGuidePage from './pages/StaffGuidePage'
import RequestCampaignPage from './pages/RequestCampaignPage'
import CampaignAnswerPage from './pages/CampaignAnswerPage'
import Layout from './components/Layout'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { KioskProvider } from './contexts/KioskContext'
import NativeShell from './native/NativeShell'
import { isNative } from './native/platform'
import { isEventMode } from './lib/terms'

function AppRoutes() {
  const { user, selectedCompany, loading, justRegistered } = useAuth()
  const location = useLocation()

  // どの画面まで来たかを記録する（離脱箇所の把握用。ログイン前も含む）
  useEffect(() => { trackPageView(location.pathname) }, [location.pathname])

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
  // LINE の希望提出リンク。ログイン中かどうかに関係なく、リンクの本人で入り直す
  if (location.pathname.startsWith('/l/')) {
    return <LineLinkPage token={location.pathname.slice(3)} />
  }

  // LINE の中の本人専用の打刻画面（LIFF）。本人確認は LINE が行う
  const liffMatch = location.pathname.match(/^\/liff\/punch\/(\d+)/)
  // 同じ LIFF の /stock は在庫の画面（LINE から開いた直後は ?liff.state=/stock… の形で来る）
  const liffState = new URLSearchParams(location.search).get('liff.state') || ''
  if (liffMatch && (/^\/liff\/punch\/\d+\/stock/.test(location.pathname) || liffState.startsWith('/stock'))) {
    return <LiffStockPage companyId={Number(liffMatch[1])} />
  }
  if (liffMatch) {
    return <LiffPunchPage companyId={Number(liffMatch[1])} />
  }

  // LINE 招待（スタッフ本人専用のQR/リンク）。ログイン不要
  if (location.pathname.startsWith('/i/')) {
    return <LineInvitePage token={decodeURIComponent(location.pathname.slice(3).split('/')[0])} />
  }

  // 会場QRの打刻画面。ログイン不要（ログイン中でその会社の人ならそのまま本人として扱う）
  if (location.pathname.startsWith('/q/')) {
    return <QrClockPage token={decodeURIComponent(location.pathname.slice(3).split('/')[0])} />
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
        {/* ネイティブアプリでは営業用のLPを出さず、ログイン画面から始める（Appらしさ・4.2対策） */}
        <Route path="/" element={isNative ? <Navigate to="/login" replace /> : <LandingPage />} />
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
  // スタッフ向けの使い方（印刷・LINEで送る）
  if (isAdminRole && location.pathname === '/staff-guide') {
    return <StaffGuidePage />
  }
  // LINE 招待カードの一括印刷
  if (isAdminRole && location.pathname === '/line-invites/print') {
    return <LineInvitePrintPage />
  }
  // 会場ごとの打刻用QRポスター（/qr-poster/store/:id）
  const storePosterMatch = location.pathname.match(/^\/qr-poster\/store\/(\d+)$/)
  if (isAdminRole && storePosterMatch) {
    return <StoreQrPosterPage storeId={Number(storePosterMatch[1])} />
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
          <Route path="/request-campaigns" element={isEventMode(selectedCompany) ? <RequestCampaignPage /> : <Navigate to="/dashboard" replace />} />
          <Route path="/campaign/:id" element={<CampaignAnswerPage />} />
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
          <Route path="/auto-schedule" element={isEventMode(selectedCompany) ? <VenueSchedulePage /> : <Navigate to="/dashboard" replace />} />
          <Route path="/inventory" element={isEventMode(selectedCompany) ? <InventoryPage /> : <Navigate to="/dashboard" replace />} />
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
        {/* 期間の募集（マーケットなど）の回答画面。LINE の本人専用リンクから来る */}
        <Route path="/campaign/:id" element={<CampaignAnswerPage />} />
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
