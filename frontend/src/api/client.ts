import axios from 'axios'

const API_BASE = '/api'

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor - attach token + company
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  const companyId = localStorage.getItem('selectedCompanyId')
  if (companyId) config.headers['X-Company-Id'] = companyId
  return config
})

// Response interceptor - handle 401
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
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
}

export interface Store {
  id: number
  company_id: number
  name: string
  address?: string
  phone?: string
  created_at: string
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
  getAll: (params?: { year?: number; month?: number; user_id?: number }) =>
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
}

export const timecardsApi = {
  getAll: (params?: { year?: number; month?: number; user_id?: number }) =>
    api.get<{ records: TimeRecord[] }>('/timecards', { params }),
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

export const authApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
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
  stripe_configured: boolean
}

export const billingApi = {
  getPlan: () => api.get<BillingPlan>('/billing/plan'),
  createCheckout: (additional_stores: number) =>
    api.post<{ url: string }>('/billing/checkout', { additional_stores }),
}
