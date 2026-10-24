import axios from 'axios'
import { apiBaseUrl, apiOrigin } from '../native/platform'
import { track } from '../lib/analytics'

// Web は同一オリジンの /api、iOS アプリはバンドル済みアセットから本番サーバーへ絶対URLで叩く
const API_BASE = apiBaseUrl

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor - attach token + company
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  // 明示された認証・会社情報は再送やログアウト時にも保持する。
  if (token && !config.headers['Authorization']) config.headers['Authorization'] = `Bearer ${token}`
  const companyId = localStorage.getItem('selectedCompanyId')
  if (companyId && !config.headers['X-Company-Id']) config.headers['X-Company-Id'] = companyId
  return config
})

// Response interceptor - handle 401
api.interceptors.response.use(
  response => response,
  error => {
    // 保存や読み込みの失敗は「その画面で詰まった」証拠なので記録する（URL内の数値IDは :id に丸める）
    try {
      const status = error.response?.status
      if (status && status !== 401) {
        const endpoint = String(error.config?.url || '').split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id')
        const message = error.response?.data?.error
        track('api_error', {
          status, endpoint, method: String(error.config?.method || '').toUpperCase(),
          message: typeof message === 'string' ? message.slice(0, 120) : undefined,
        })
      }
    } catch { /* 計測失敗は無視 */ }
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      // 認証状態も消し、ルーターにログイン画面への遷移を任せる。
      window.dispatchEvent(new Event('shiftlog:unauthorized'))
    }
    return Promise.reject(error)
  }
)

// Types
export interface Company {
  id: number
  name: string
  company_pin?: string
  address?: string
  phone?: string
  staff_home?: string
  my_role?: string
  company_role?: string
  created_at: string
}

export interface Shift {
  id: number
  company_id: number
  user_id: number
  user_name: string
  user_color: string
  date: string
  start_time: string
  end_time: string
  break_minutes: number
  notes?: string
  status: string
  store_id?: number | null
  store_name?: string | null
}

export interface User {
  id: number
  email: string
  name: string
  pin?: string
  role: string
  employment_type?: string
  color: string
  hourly_wage: number
  phone?: string
  company_role?: string
  is_active: number
  created_at: string
  last_timecard_at?: string | null
  timecard_count?: number
}

export interface Store {
  id: number
  company_id: number
  name: string
  address?: string
  phone?: string
  /** 会場の位置（離れた場所からの打刻に印を付けるため）。未設定は null */
  lat?: number | null
  lng?: number | null
  /** 会場とみなす半径（m）。未設定は300m扱い */
  geofence_m?: number | null
  created_at: string
}

/** 休憩1回分（1日に何回でも記録できる） */
export interface TimeBreak {
  start_time: string
  end_time: string | null
}

/** 位置付き打刻と会場の距離（管理画面の「会場から離れた打刻」の印に使う） */
export interface PunchLocationCheck {
  action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end'
  time: string | null
  store_name: string | null
  distance_m: number
  accuracy_m: number | null
  radius_m: number
  far: boolean
}

export interface TimeRecord {
  id: number
  company_id: number
  user_id: number
  user_name?: string
  user_color?: string
  date: string
  clock_in?: string
  clock_out?: string
  break_start?: string
  break_end?: string
  break_minutes: number
  notes?: string
  status: 'open' | 'closed'
  /** 出勤した会場・退勤した会場（会場QRで打刻したときに入る） */
  store_id?: number | null
  store_name?: string | null
  clock_out_store_id?: number | null
  clock_out_store_name?: string | null
  breaks?: TimeBreak[]
  locations?: PunchLocationCheck[]
}

export interface TimeRecordEdit {
  id: number
  time_record_id: number
  target_user_name: string | null
  target_date: string | null
  action: 'create' | 'update' | 'delete'
  before_json: string | null
  after_json: string | null
  edited_by_name: string | null
  created_at: string
}

// API functions
export const companiesApi = {
  getAll: () => api.get<{ companies: Company[] }>('/companies'),
  getOne: (id: number) => api.get<{ company: Company }>(`/companies/${id}`),
  create: (data: Partial<Company>) => api.post<{ company: Company }>('/companies', data),
  update: (id: number, data: Partial<Company>) => api.put<{ company: Company }>(`/companies/${id}`, data),
  delete: (id: number) => api.delete(`/companies/${id}`),
}

export const shiftsApi = {
  getAll: (params?: { year?: number; month?: number; user_id?: number; store_id?: number; scope?: 'all' }) =>
    api.get<{ shifts: Shift[] }>('/shifts', { params }),
  create: (data: Partial<Shift>) => api.post<{ shift: Shift }>('/shifts', data),
  update: (id: number, data: Partial<Shift>) => api.put<{ shift: Shift }>(`/shifts/${id}`, data),
  delete: (id: number) => api.delete(`/shifts/${id}`),
  getSummary: (year: number, month: number) =>
    api.get('/shifts/report/summary', { params: { year, month } }),
  getPublication: (year: number, month: number) =>
    api.get(`/shifts/publication/${year}/${month}`),
  setPublication: (year: number, month: number, is_published: boolean) =>
    api.post('/shifts/publication', { year, month, is_published }),
  pendingChanges: () => api.get<{ pending: PendingShiftChange[] }>('/shifts/changes/pending'),
  notifyChanges: (user_ids?: number[]) =>
    api.post<{ people: number; sent_line: number; not_linked: string[]; failed: string[] }>('/shifts/changes/notify', { user_ids }),
}

export interface ShiftSnap { date: string; start_time: string; end_time: string; store_id: number | null; store_name: string | null }
export interface PendingShiftChange {
  user_id: number
  name: string
  linked: boolean
  changes: { ids: number[]; shift_id: number; before: ShiftSnap | null; after: ShiftSnap | null }[]
}

export const usersApi = {
  getAll: () => api.get<{ users: User[] }>('/users'),
  getOne: (id: number) => api.get<{ user: User }>(`/users/${id}`),
  create: (data: Partial<User> & { password?: string; pin?: string; employment_type?: string }) => api.post<{ user: User }>('/users', data),
  update: (id: number, data: Partial<User> & { password?: string; employment_type?: string }) => api.put<{ user: User }>(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  resetPassword: (id: number, newPassword: string) =>
    api.post(`/users/${id}/reset-password`, { newPassword }),
}

export const storesApi = {
  getAll: () => api.get<{ stores: Store[], plan: PlanInfo }>('/stores'),
  create: (data: Partial<Store>) => api.post<{ store: Store }>('/stores', data),
  update: (id: number, data: Partial<Store>) => api.put<{ store: Store }>(`/stores/${id}`, data),
  delete: (id: number) => api.delete(`/stores/${id}`),
  /** 会場の打刻用QR（未発行ならサーバー側で発行される） */
  getQr: (id: number) => api.get<{ token: string; store: { id: number; name: string }; company_name: string }>(`/stores/${id}/qr`),
  /** 打刻用QRの再発行。古いポスターのQRは使えなくなる */
  reissueQr: (id: number) => api.post<{ token: string }>(`/stores/${id}/qr/reissue`),
}

// 会場QRの打刻（/q/<token>。ログイン不要）
export type QrClockAction = 'clock-in' | 'clock-out' | 'break-start' | 'break-end'
export interface QrClockInfo {
  line_only?: boolean
  liff_url?: string
  store: { id: number; name: string; color_index?: number }
  company: { id: number; name: string }
  staff: { id: number; name: string; color?: string }[]
}
export interface QrClockStatus {
  record: {
    id: number
    date: string
    clock_in?: string | null
    clock_out?: string | null
    break_minutes: number
    status: 'open' | 'closed'
    store_name?: string | null
    clock_out_store_name?: string | null
  } | null
  breaks: TimeBreak[]
  on_break: boolean
}
// LINE の中の打刻画面（LIFF）
type LiffShift = { start_time: string; end_time: string; store_id: number | null; store_name: string | null }
export const liffApi = {
  config: (companyId: number) => api.get<{ liff_id: string; company_name: string }>(`/liff/config/${companyId}`),
  session: (companyId: number, idToken: string) =>
    api.post<{ linked: false } | (QrClockStatus & { linked: true; key: string; user: { id: number; name: string }; today_shifts: LiffShift[] })>('/liff/session', { companyId, idToken }),
  venue: (key: string, qr: string) => api.post<{ store: { id: number; name: string } }>('/liff/venue', { key, qr }),
  punch: (key: string, qr: string, action: QrClockAction, pos?: { lat: number; lng: number; accuracy: number } | null) =>
    api.post<QrClockStatus & { ok: true; time: string; store_name: string }>('/liff/punch', { key, qr, action, ...(pos || {}) }),
  saveSettings: (data: { liff_id: string; login_channel_id: string; punch_line_only: boolean }) =>
    api.post<{ message: string; endpoint_url: string }>('/liff/settings', data),
}

export const qrClockApi = {
  info: (token: string) => api.get<QrClockInfo>(`/qr/${encodeURIComponent(token)}`),
  status: (token: string, userId: number) =>
    api.get<QrClockStatus & { user: { id: number; name: string }; today_shifts?: { start_time: string; end_time: string; store_id: number | null; store_name: string | null }[] }>(`/qr/${encodeURIComponent(token)}/status`, { params: { userId } }),
  punch: (token: string, payload: { userId: number; action: QrClockAction; lat?: number; lng?: number; accuracy?: number }) =>
    api.post<QrClockStatus & { ok: true; action: QrClockAction; date: string; time: string; store_name: string; user: { id: number; name: string } }>(
      `/qr/${encodeURIComponent(token)}/punch`, payload
    ),
}

export const timecardsApi = {
  getAll: (params?: { year?: number; month?: number; user_id?: number; store_id?: number }) =>
    api.get<{ records: TimeRecord[] }>('/timecards', { params }),
  getEdits: (id: number) => api.get<{ edits: TimeRecordEdit[] }>(`/timecards/${id}/edits`),
  clockIn: (user_id?: number) => api.post<{ record: TimeRecord }>('/timecards/clock-in', { user_id }),
  clockOut: (user_id?: number) => api.post<{ record: TimeRecord }>('/timecards/clock-out', { user_id }),
  breakStart: (user_id?: number) => api.post<{ record: TimeRecord }>('/timecards/break-start', { user_id }),
  breakEnd: (user_id?: number) => api.post<{ record: TimeRecord }>('/timecards/break-end', { user_id }),
  getToday: (user_id?: number) => api.get<{ record: TimeRecord | null }>('/timecards/today', { params: user_id ? { user_id } : {} }),
  update: (id: number, data: Partial<TimeRecord>) => api.put<{ record: TimeRecord }>(`/timecards/${id}`, data),
  delete: (id: number) => api.delete(`/timecards/${id}`),
  getSummary: (year: number, month: number) =>
    api.get('/timecards/summary', { params: { year, month } }),
}

export interface AccountDeletionInfo {
  email?: string
  name: string
  requires_password: boolean
  /** Apple の App内課金が残っている場合、App Store 側で別途解約が必要 */
  has_apple_subscription?: boolean
  // 会社ごと全データが消える
  deleting_companies: { id: number; name: string }[]
  // 自分だけ抜ける（会社は残る）
  leaving_companies: { id: number; name: string; role: string }[]
}

export const authApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  getAccountDeletionInfo: () => api.get<AccountDeletionInfo>('/auth/account'),
  deleteAccount: (payload: { password?: string; confirm?: string }) =>
    api.delete('/auth/account', { data: payload }),
}

export interface PlanInfo {
  name: string
  max_stores: number
  current_stores: number
}

export interface BillingPlan {
  plan: string
  max_stores: number
  current_stores: number
  price_per_store: number
  /** 年払いの価格（2ヶ月分お得） */
  price_per_year: number
  max_free_staff: number
  current_staff: number
  stripe_configured: boolean
  /** 'stripe' | 'apple' — どちらの決済で契約しているか */
  platform: 'stripe' | 'apple'
  apple_configured: boolean
  apple_product_id: string
  apple_product_ids: { monthly: string; yearly: string }
  trial_days_total: number
  in_trial: boolean
  trial_ends_at: string | null
  trial_days_left: number | null
}

export const billingApi = {
  getPlan: () => api.get<BillingPlan>('/billing/plan'),
  verifyApple: (transaction_id: string) =>
    api.post<{ plan: string; status: string; platform: string; expires_at: string | null }>(
      '/billing/apple/verify', { transaction_id }
    ),
  createCheckout: (additional_stores: number = 0, interval: 'month' | 'year' = 'month') =>
    api.post<{ url: string }>('/billing/checkout', { additional_stores, interval }),
  createPortal: () => api.post<{ url: string }>('/billing/portal'),
}

// Feedback (フィードバック)
export type FeedbackCategory = 'bug' | 'feature' | 'question' | 'other'
export type FeedbackStatus = 'open' | 'in_progress' | 'closed'
export interface FeedbackPayload {
  category: FeedbackCategory
  message: string
  email?: string
  /** 送信元（web / ios）と、送ったときの画面。運営者への通知メールに載せる */
  platform?: string
  path?: string
}
export interface FeedbackItem {
  id: number
  user_id: number | null
  company_id: number | null
  category: FeedbackCategory
  message: string
  email: string | null
  status: FeedbackStatus
  created_at: string
  user_email: string | null
  user_name: string | null
  company_name: string | null
}

export const feedbackApi = {
  submit: (payload: FeedbackPayload) =>
    api.post<{ message: string }>('/feedback', payload),
  list: () =>
    api.get<{ feedbacks: FeedbackItem[] }>('/feedback'),
  updateStatus: (id: number, status: FeedbackStatus) =>
    api.patch<{ message: string }>(`/feedback/${id}/status`, { status }),
  remove: (id: number) =>
    api.delete<{ message: string }>(`/feedback/${id}`),
}

// 監査ログ
export interface AuditLogItem {
  id: number
  user_id: number | null
  company_id: number | null
  action: string
  entity: string
  entity_id: number | null
  summary: string | null
  detail: string | null
  created_at: string
  user_name: string | null
  user_email: string | null
  company_name: string | null
}
export const auditApi = {
  list: (params?: { entity?: string; action?: string; limit?: number }) =>
    api.get<{ logs: AuditLogItem[] }>('/audit-logs', { params }),
}

// スキル
export interface Skill {
  id: number
  company_id: number
  name: string
  color: string
  user_count?: number
}
export const skillsApi = {
  list: () => api.get<{ skills: Skill[] }>('/skills'),
  create: (name: string, color?: string) => api.post<{ skill: Skill }>('/skills', { name, color }),
  remove: (id: number) => api.delete<{ message: string }>(`/skills/${id}`),
  getUserSkills: (userId: number) => api.get<{ skills: Skill[] }>(`/skills/user/${userId}`),
  setUserSkills: (userId: number, skillIds: number[]) =>
    api.put<{ message: string }>(`/skills/user/${userId}`, { skill_ids: skillIds }),
}

// シフト交代
export type SwapStatus = 'pending' | 'accepted' | 'rejected'
export interface ShiftSwap {
  id: number
  company_id: number
  requester_id: number
  requester_name: string
  shift_id: number
  target_user_id: number | null
  target_user_name: string | null
  reason: string | null
  status: SwapStatus
  responder_id: number | null
  responder_name: string | null
  created_at: string
  resolved_at: string | null
  date: string
  start_time: string
  end_time: string
}
export const swapsApi = {
  list: () => api.get<{ swaps: ShiftSwap[] }>('/swaps'),
  create: (shiftId: number, targetUserId?: number | null, reason?: string) =>
    api.post<{ id: number }>('/swaps', { shift_id: shiftId, target_user_id: targetUserId || null, reason }),
  accept: (id: number) => api.post<{ message: string }>(`/swaps/${id}/accept`),
  reject: (id: number) => api.post<{ message: string }>(`/swaps/${id}/reject`),
  remove: (id: number) => api.delete<{ message: string }>(`/swaps/${id}`),
}

// iCal
export const icalApi = {
  getToken: () => api.post<{ url: string; token: string }>('/ical/token'),
  revoke: () => api.delete<{ message: string }>('/ical/token'),
}

// ユーザー一括インポート
export interface BulkImportRow {
  name: string
  email?: string
  pin?: string
  hourly_wage?: number
  employment_type?: string
  phone?: string
}
export interface BulkImportResult {
  row: number
  status: 'created' | 'skipped' | 'error'
  message?: string
  user_id?: number
}
export const userBulkApi = {
  import: (rows: BulkImportRow[]) =>
    api.post<{ results: BulkImportResult[] }>('/users/bulk', { rows }),
}

// 会場ごとの必要人数（枠）と、希望からのシフト下書き
export interface SlotRule {
  id: number
  store_id: number | null
  /** 曜日番号（0=日〜6=土）を並べた文字列。日付指定のときは null */
  weekdays: string | null
  /** 日付指定の上書き（この日はこの会場の曜日ルールを使わない。needed=0 は休み） */
  date: string | null
  start_time: string
  end_time: string
  needed: number
  break_minutes: number
  valid_from: string | null
  valid_to: string | null
}
export type SlotRuleInput = Omit<SlotRule, 'id'>
export interface DraftPerson {
  assignment_id: number | null
  shift_id: number | null
  user_id: number
  user_name: string
  /** auto=自動 / manual=手で入れた / existing=確定済みのシフト */
  source: 'auto' | 'manual' | 'existing'
  availability: 'preferred' | 'available' | 'unavailable' | null
  partial: boolean
  warning?: string | null
}
export interface DraftSlot {
  id: number
  store_id: number | null
  date: string
  start_time: string
  end_time: string
  needed: number
  break_minutes: number
  people: DraftPerson[]
  short: number
  over: number
}
export interface DraftStaff {
  id: number
  name: string
  color: string | null
  days: number
  minutes: number
  draft_minutes: number
  existing_minutes: number
  draft_count: number
  preferred_days: number
  available_days: number
  unavailable_days: number
  submitted: boolean
}
export interface DraftView {
  draft: {
    id: number
    start_date: string
    end_date: string
    status: 'draft' | 'committed' | 'discarded'
    include_unsubmitted: boolean
    created_at: string
    committed_at: string | null
    committed_count: number | null
  }
  stores: { id: number; name: string }[]
  slots: DraftSlot[]
  staff: DraftStaff[]
  conflicts: { user_id: number; user_name: string; date: string }[]
  totals: { needed: number; filled: number; short_slots: number; short_people: number; draft_count: number }
}
export interface DraftCandidate {
  user_id: number
  name: string
  color: string | null
  days: number
  minutes: number
  availability: 'preferred' | 'available' | 'unavailable' | null
  preferred_time: string | null
  in_slot: boolean
  ok: boolean
  partial: boolean
  reason: string | null
}
export interface DraftSummary {
  id: number
  start_date: string
  end_date: string
  status: 'draft' | 'committed'
  assignment_count: number
  created_at: string
  committed_at: string | null
}
export const venueScheduleApi = {
  getRules: () => api.get<{ rules: SlotRule[] }>('/venue-schedule/rules'),
  createRule: (data: Partial<SlotRuleInput>) => api.post<{ rule: SlotRule }>('/venue-schedule/rules', data),
  updateRule: (id: number, data: Partial<SlotRuleInput>) => api.put<{ rule: SlotRule }>(`/venue-schedule/rules/${id}`, data),
  deleteRule: (id: number) => api.delete(`/venue-schedule/rules/${id}`),
  listDrafts: () => api.get<{ drafts: DraftSummary[] }>('/venue-schedule/drafts'),
  createDraft: (data: { start_date: string; end_date: string; include_unsubmitted?: boolean }) =>
    api.post<DraftView>('/venue-schedule/drafts', data),
  getDraft: (id: number) => api.get<DraftView>(`/venue-schedule/drafts/${id}`),
  candidates: (draftId: number, slotId: number) =>
    api.get<{ candidates: DraftCandidate[] }>(`/venue-schedule/drafts/${draftId}/slots/${slotId}/candidates`),
  assign: (draftId: number, data: { slot_id: number; user_id: number; replace_assignment_id?: number }) =>
    api.post<DraftView>(`/venue-schedule/drafts/${draftId}/assign`, data),
  unassign: (draftId: number, assignmentId: number) =>
    api.delete<DraftView>(`/venue-schedule/drafts/${draftId}/assignments/${assignmentId}`),
  discard: (draftId: number) => api.delete(`/venue-schedule/drafts/${draftId}`),
  commit: (draftId: number) =>
    api.post<{ created: number; skipped: { user_name: string; date: string; start_time: string; end_time: string; reason: string }[] }>(`/venue-schedule/drafts/${draftId}/commit`),
}

// 給与ソフト連携
export type PayrollFormat = 'generic' | 'freee' | 'moneyforward' | 'kingoftime'
export interface PayrollSummary {
  user_id: number
  user_name: string
  email: string | null
  days: number
  total_minutes: number
  overtime_minutes: number
  night_minutes: number
  holiday_minutes: number
  total_wage: number
  hourly_wage: number
}
// デモデータ投入
export const seedApi = {
  demo: (opts?: { include_store?: boolean; include_staff?: boolean; include_shifts?: boolean; include_skills?: boolean }) =>
    api.post<{ ok: boolean; created: { store: number; staff: number; skills: number; shifts: number } }>('/seed/demo', opts || {}),
  removeDemo: () =>
    api.delete<{ ok: boolean; removed: any }>('/seed/demo'),
}

// 利用定着ファネル (super_admin)
export interface ActivationFunnel {
  total: number
  withStore: number
  withStaff: number
  withShift: number
  withTimecard: number
  activeLast7d: number
  dropoff: { noStore: number; noStaff: number; noShift: number; noTimecard: number }
}
export const funnelApi = {
  get: () => api.get<ActivationFunnel>('/admin/activation-funnel'),
}

export const payrollApi = {
  getSummary: (year: number, month: number) =>
    api.get<{ summaries: PayrollSummary[]; year: number; month: number }>('/payroll/summary', { params: { year, month } }),
  exportUrl: (year: number, month: number, format: PayrollFormat) => {
    const token = localStorage.getItem('token') || ''
    const companyId = localStorage.getItem('selectedCompanyId') || ''
    return `${apiOrigin}/api/payroll/export?year=${year}&month=${month}&format=${format}&access_token=${encodeURIComponent(token)}&company_id=${companyId}`
  },
}

// Shift Requests (希望シフト収集)
export interface ShiftRequest {
  id: number
  company_id: number
  user_id: number
  user_name?: string
  user_color?: string
  date: string
  availability: 'available' | 'unavailable' | 'preferred'
  preferred_start?: string
  preferred_end?: string
  notes?: string
}

export const shiftRequestsApi = {
  getAll: (params?: { year?: number; month?: number; user_id?: number }) =>
    api.get<{ requests: ShiftRequest[] }>('/shift-requests', { params }),
  submit: (data: Partial<ShiftRequest>) =>
    api.post('/shift-requests', data),
  submitBulk: (requests: Partial<ShiftRequest>[], clear?: string[]) =>
    api.post('/shift-requests/bulk', { requests, clear }),
  getSummary: (year: number, month: number) =>
    api.get('/shift-requests/summary', { params: { year, month } }),
  getPeriod: (year: number, month: number) =>
    api.get('/shift-requests/period', { params: { year, month } }),
  setPeriod: (year: number, month: number, deadline?: string, status?: string, start_date?: string, end_date?: string) =>
    api.post('/shift-requests/period', { year, month, deadline, status, start_date, end_date }),
  remindByLine: (year: number, month: number) =>
    api.post<{ sent: number; unsubmitted: number; not_linked: string[] }>('/shift-requests/remind', { year, month }),
}

// 期間をまたぐ希望の募集（マーケットなど）
export type CampaignStatus = 'draft' | 'open' | 'closed'
export type CampaignPart = 'a' | 'b' | 'full' | 'all'
export type CampaignAvailability = 'preferred' | 'available' | 'unavailable'
export interface Campaign {
  id: number
  title: string
  start_date: string
  end_date: string
  deadline: string | null
  status: CampaignStatus
  sent_at: string | null
  created_at: string
  days_left: number | null
  accepting: boolean
  answered?: number
  staff_count?: number
  submitted?: boolean
}
export interface CampaignDay {
  date: string
  weekday: number
  long: boolean
  venues: { store_id: number | null; slots: { start_time: string; end_time: string; part: 'a' | 'b' }[] }[]
  times: Record<'a' | 'b', { start: string; end: string }>
}
export interface CampaignAnswerInput {
  venues: 'any' | number[]
  days_per_week: '1-2' | '3-4' | '5+' | null
  ng_weekdays: number[]
  transport: string[]
  transport_note: string
  other_job: 'none' | 'yes' | null
  other_job_note: string
  long_day: 'yes' | 'half' | 'depends' | null
  referral: 'yes' | 'ask' | 'no' | null
  referral_note: string
  comment: string
}
export interface CampaignAnswerView {
  venues_any: boolean
  venue_ids: number[]
  venue_names: string[]
  days_per_week: '1-2' | '3-4' | '5+' | null
  days_per_week_label: string | null
  ng_weekdays: number[]
  ng_label: string
  transport: string[]
  transport_note: string
  other_job: 'none' | 'yes' | null
  other_job_note: string
  long_day: 'yes' | 'half' | 'depends' | null
  long_day_label: string | null
  referral: 'yes' | 'ask' | 'no' | null
  referral_label: string | null
  referral_note: string
  comment: string
  submitted_at: string | null
}
export interface CampaignMine {
  campaign: Campaign
  contact: string
  me: { name: string }
  stores: { id: number; name: string }[]
  days: CampaignDay[]
  answer: CampaignAnswerView | null
  entries: Record<string, { availability: CampaignAvailability; part: CampaignPart | null }>
  transports: string[]
}
export interface CampaignPerson { user_id: number; name: string; availability: CampaignAvailability; part: CampaignPart | null; part_label: string | null }
export interface CampaignSummary {
  campaign: Campaign
  line_configured: boolean
  contact: string
  stores: { id: number; name: string }[]
  days: {
    date: string
    weekday: number
    long: boolean
    short: boolean
    venues: {
      store_id: number | null
      needed: number
      preferred: number
      available: number
      short: number
      people: CampaignPerson[]
      slots: { start_time: string; end_time: string; needed: number; part: 'a' | 'b'; candidates: number; short: number }[]
    }[]
  }[]
  staff: {
    id: number
    name: string
    color: string | null
    linked: boolean
    answered: boolean
    answer: CampaignAnswerView | null
    counts: { preferred: number; available: number; unavailable: number; blank: number }
  }[]
  totals: { staff: number; answered: number; days: number; short_days: number }
}
type SendResult = { sent: number; targets: number; failed: string[]; not_linked: string[] }
export const campaignsApi = {
  list: () => api.get<{ campaigns: Campaign[] }>('/request-campaigns'),
  open: () => api.get<{ campaigns: Campaign[] }>('/request-campaigns/open'),
  previewDays: (start_date: string, end_date: string) =>
    api.get<{ count: number; long: number; first: string | null; last: string | null }>('/request-campaigns/preview-days', { params: { start_date, end_date } }),
  create: (data: { title: string; start_date: string; end_date: string; deadline: string | null }) =>
    api.post<{ campaign: Campaign }>('/request-campaigns', data),
  update: (id: number, data: Partial<{ title: string; start_date: string; end_date: string; deadline: string | null }>) =>
    api.put<{ campaign: Campaign }>(`/request-campaigns/${id}`, data),
  remove: (id: number) => api.delete(`/request-campaigns/${id}`),
  send: (id: number) => api.post<SendResult & { campaign: Campaign }>(`/request-campaigns/${id}/send`),
  remind: (id: number) => api.post<SendResult & { unanswered: number }>(`/request-campaigns/${id}/remind`),
  preview: (id: number) => api.post<SendResult>(`/request-campaigns/${id}/preview`),
  close: (id: number) => api.post<{ campaign: Campaign }>(`/request-campaigns/${id}/close`),
  reopen: (id: number) => api.post<{ campaign: Campaign }>(`/request-campaigns/${id}/reopen`),
  summary: (id: number) => api.get<CampaignSummary>(`/request-campaigns/${id}/summary`),
  mine: (id: number) => api.get<CampaignMine>(`/request-campaigns/${id}/mine`),
  submit: (id: number, data: { answer: CampaignAnswerInput; entries: { date: string; availability: CampaignAvailability; part?: CampaignPart | null }[] }) =>
    api.put<{ message: string; count: number }>(`/request-campaigns/${id}/mine`, data),
}

// Labor costs & alerts
export const laborApi = {
  getCosts: (year: number, month: number) =>
    api.get('/labor/costs', { params: { year, month } }),
  getAlerts: (year: number, month: number) =>
    api.get('/labor/alerts', { params: { year, month } }),
  getRatio: (year: number, month: number) =>
    api.get('/labor/ratio', { params: { year, month } }),
  getSales: (year: number, month: number) =>
    api.get('/labor/sales', { params: { year, month } }),
  saveSales: (date: string, amount: number, notes?: string) =>
    api.post('/labor/sales', { date, amount, notes }),
}

// Templates
export interface ShiftTemplate {
  id: number
  company_id: number
  name: string
  start_time: string
  end_time: string
  break_minutes: number
  color: string
}

export const templatesApi = {
  getAll: () => api.get<{ templates: ShiftTemplate[] }>('/templates'),
  create: (data: Partial<ShiftTemplate>) => api.post<{ template: ShiftTemplate }>('/templates', data),
  update: (id: number, data: Partial<ShiftTemplate>) => api.put<{ template: ShiftTemplate }>(`/templates/${id}`, data),
  delete: (id: number) => api.delete(`/templates/${id}`),
  apply: (id: number, user_ids: number[], dates: string[]) =>
    api.post(`/templates/${id}/apply`, { user_ids, dates }),
}

// Absence & Help
export interface AbsenceReport {
  id: number
  company_id: number
  user_id: number
  user_name?: string
  user_color?: string
  shift_id?: number
  date: string
  reason?: string
  status: 'pending' | 'covered' | 'approved' | 'rejected'
  cover_user_id?: number
  cover_user_name?: string
  start_time?: string
  end_time?: string
}

export const absenceApi = {
  getAll: (params?: { status?: string; year?: number; month?: number }) =>
    api.get<{ reports: AbsenceReport[] }>('/absence', { params }),
  report: (data: { shift_id?: number; date: string; reason?: string }) =>
    api.post<{ report: AbsenceReport }>('/absence', data),
  cover: (id: number) => api.post(`/absence/${id}/cover`),
  update: (id: number, status: string) => api.put(`/absence/${id}`, { status }),
  getHelpRequests: () => api.get<{ reports: AbsenceReport[] }>('/absence/help-requests'),
}

// CSV Export
export const csvApi = {
  downloadShifts: (year: number, month: number) =>
    api.get('/csv/shifts', { params: { year, month }, responseType: 'blob' }),
  downloadTimecards: (year: number, month: number) =>
    api.get('/csv/timecards', { params: { year, month }, responseType: 'blob' }),
  downloadSummary: (year: number, month: number) =>
    api.get('/csv/summary', { params: { year, month }, responseType: 'blob' }),
}

// Admin (super_admin専用)
export interface AdminUser {
  id: number
  email: string | null
  name: string
  role: string
  is_active: boolean
  created_at: string
  last_activity: string | null
  recently_active: boolean
  in_use: boolean
  company_count: number
  // 管理画面で登録時の流入元を併記する。
  companies: { id: number; name: string; role: string; acq_source: string | null }[]
}

export interface AdminStats {
  totalUsers: number
  activeUsers: number
  totalCompanies: number
  adminUsers: number
}

export const adminApi = {
  getUsers: () => api.get<{ users: AdminUser[] }>('/admin/users'),
  getStats: () => api.get<AdminStats>('/admin/stats'),
  setActive: (id: number, is_active: boolean) =>
    api.patch(`/admin/users/${id}/active`, { is_active }),
}

// LINE
export const lineApi = {
  getSettings: () => api.get('/line/settings'),
  saveSettings: (data: any) => api.post('/line/settings', data),
  register: (line_user_id: string) => api.post('/line/register', { line_user_id }),
  testNotify: () => api.post('/line/test'),
  linkCode: () => api.post<{ code: string; minutes: number; bot_name: string | null; basic_id: string; add_friend_url: string; send_code_url: string }>('/line/link-code'),
  me: () => api.get<{ configured: boolean; bot_name: string | null; linked: boolean }>('/line/me'),
  unlink: () => api.delete('/line/me'),
  saveAbsenceRule: (days: number | null, phone: string, contact_name?: string) => api.post('/line/absence-rule', { days, phone, contact_name }),
  inviteLinks: (user_ids?: number[]) =>
    api.post<{ company_name: string; links: { user_id: number; name: string; role: string; linked: boolean; url: string }[] }>('/line/invite-links', { user_ids }),
}

// LINE 招待（ログイン不要。/i/:token の画面から使う）
export const lineInviteApi = {
  info: (token: string) =>
    api.get<{ name: string; company_name: string; configured: boolean; bot_name: string | null; add_friend_url: string | null; linked: boolean }>(`/line/invite/${encodeURIComponent(token)}`),
  code: (token: string) =>
    api.post<{ code: string; minutes: number; send_code_url: string }>(`/line/invite/${encodeURIComponent(token)}/code`),
}

// プッシュ通知（iOSアプリ）
export const pushApi = {
  registerDevice: (payload: { token: string; platform?: string; environment?: string; app_version?: string }) =>
    api.post<{ ok: boolean; configured: boolean }>('/push/device', payload),
  unregisterDevice: (token: string) => api.delete('/push/device', { data: { token } }),
  test: () => api.post<{ ok: boolean; sent: number }>('/push/test'),
}

// ---- 催事の在庫・補充 ----
// LINE の中（LIFF）では打刻と同じ鍵を x-inv-key で送る。管理画面ではいつものログインのまま使う。
export type InvRole = 'admin' | 'full' | 'part'
export interface InvItem {
  id: number; name: string; category: 'food' | 'container'; count_unit: string; use_unit: string; per_count: number
  half_ok: number; source: 'kobo' | 'purchase'; track_company: number; lead_days: number | null; cap_per_venue: number | null
  tolerance: number; note: string | null; sort: number; active: number
}
export interface InvMenu { id: number; name: string; register_label: string | null; store_ids: number[] | null; price: number | null; sort: number; active: number; parts: { item_id: number; qty: number }[] }
export interface InvMe {
  enabled: boolean; role: InvRole; name: string; date?: string
  stores?: { id: number; name: string }[]; my_store?: number | null; ocr?: boolean; items?: InvItem[]; menus?: InvMenu[]
}
export interface InvDiff { item_id: number; name: string; count_unit: string; counted: number; expected: number; diff: number }
export interface InvClosing { store_id: number; date: string; name?: string; open_today?: boolean; counted: boolean; counted_at: string | null; sales_done: boolean; sales_at: string | null; complete: boolean; diffs: InvDiff[] }
export interface InvLoadLine { item_id: number; name: string; count_unit: string; category: string; need: number; stock: number; request: number; suggested: number; qty: number; capped: boolean; company_stock: number | null }
export interface InvLoad { store_id: number; name: string; date: string | null; status: string; confirmed_at: string | null; daytype?: string; forecast?: { menu_id: number; name: string; qty: number; basis: string }[]; stale?: { name: string; since: string; days: number }[]; lines: InvLoadLine[] }
export interface InvReorder { item_id: number; name: string; count_unit: string; total: number; per_day: number; days_left: number; lead_days: number }
export interface InvSettings { company_id: number; enabled: number; store_ids: number[]; notify_user_ids: number[]; margin_pct: number; special_days: Record<string, string>; active_from: string | null; active_to: string | null }
export interface InvReceipt { lines: { menu_id: number; qty: number; amount: number | null }[]; total_amount: number | null; unmatched: { label: string; qty: number | null; amount: number | null }[]; receipt_date: string | null; note: string | null }

export function invApi(key?: string) {
  const h = key ? { headers: { 'x-inv-key': key } } : {}
  return {
    me: () => api.get<InvMe>('/inventory/me', h),
    status: (date?: string) => api.get<{ date: string; stores: InvClosing[] }>('/inventory/status', { ...h, params: { date } }),
    getCount: (loc: number, date?: string) => api.get<{ loc: number; date: string; items: InvItem[]; lines: { item_id: number; counted: number; expected?: number | null }[]; saved_at: string | null; finalized: boolean; previous: { date: string | null; lines: { item_id: number; counted: number }[] }; book?: { item_id: number; qty: number }[] }>('/inventory/count', { ...h, params: { loc, date } }),
    saveCount: (loc: number, date: string, lines: { item_id: number; counted: number }[]) => api.post<{ ok: true; status: InvClosing | null }>('/inventory/count', { loc, date, lines }, h),
    getSales: (store_id: number, date?: string) => api.get<{ store_id: number; date: string; menus: InvMenu[]; sales: { source: string; total_amount: number | null; updated_at: string; lines: { menu_id: number; qty: number; amount: number | null }[] } | null; ocr: boolean }>('/inventory/sales', { ...h, params: { store_id, date } }),
    readReceipt: (store_id: number, image: string, media_type: string) => api.post<InvReceipt>('/inventory/sales/read', { store_id, image, media_type }, { ...h, timeout: 120000 }),
    saveSales: (data: { store_id: number; date: string; lines: { menu_id: number; qty: number; amount: number | null }[]; total_amount: number | null; source: 'photo' | 'manual'; photo?: string | null; ocr_raw?: unknown }) => api.post<{ ok: true; status: InvClosing }>('/inventory/sales', data, h),
    localBuy: (store_id: number, item_id: number, qty: number, note: string) => api.post('/inventory/local-buy', { store_id, item_id, qty, note }, h),
    requests: () => api.get<{ id: number; store_id: number; store_name: string; item_id: number; item_name: string; count_unit: string; qty: number; note: string | null; user_id: number; user_name: string | null; status: string; created_at: string }[]>('/inventory/requests', h),
    addRequest: (store_id: number, item_id: number, qty: number, note: string) => api.post('/inventory/requests', { store_id, item_id, qty, note }, h),
    deleteRequest: (id: number) => api.delete(`/inventory/requests/${id}`, h),
    load: (store_id?: number, date?: string) => api.get<{ margin_pct: number; loads: InvLoad[]; reorder: InvReorder[] }>('/inventory/load', { ...h, params: { store_id, date } }),
    confirmLoad: (store_id: number, date: string, lines: { item_id: number; qty: number }[]) => api.post('/inventory/load/confirm', { store_id, date, lines }, h),
    purchase: (item_id: number, qty: number, note: string) => api.post('/inventory/purchase', { item_id, qty, note }, h),
    stock: () => api.get<{ locs: { id: number; name: string }[]; items: InvItem[]; stock: Record<string, Record<string, number>>; reorder: InvReorder[] }>('/inventory/stock', h),
    history: (days = 14) => api.get<(InvClosing & { name: string; total_amount: number | null; lines: { menu_id: number; qty: number; amount: number | null }[] })[]>('/inventory/history', { ...h, params: { days } }),
    master: () => api.get<{ settings: InvSettings | null; stores: { id: number; name: string }[]; users: { id: number; name: string; line_linked: number }[]; items: InvItem[]; menus: InvMenu[]; baselines: { store_id: number; menu_id: number; daytype: string; qty: number }[] }>('/inventory/master', h),
    seed: () => api.post('/inventory/seed', {}, h),
    saveSettings: (s: Partial<InvSettings>) => api.put('/inventory/settings', s, h),
    addItem: (it: Partial<InvItem>) => api.post('/inventory/items', it, h),
    saveItem: (it: InvItem) => api.put(`/inventory/items/${it.id}`, it, h),
    addMenu: (m: Partial<InvMenu>) => api.post('/inventory/menus', m, h),
    saveMenu: (m: InvMenu) => api.put(`/inventory/menus/${m.id}`, m, h),
    saveBaselines: (rows: { store_id: number; menu_id: number; daytype: string; qty: number }[]) => api.put('/inventory/baselines', { rows }, h),
  }
}
export type InvApi = ReturnType<typeof invApi>
