import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Calendar, Eye, EyeOff, Clock, Coffee, LogOut, ArrowLeft } from 'lucide-react'
import { api } from '../api/client'
import toast from 'react-hot-toast'

interface StaffMember {
  id: number
  name: string
  color: string
  employment_type: string
}

interface TodayRecord {
  user_id: number
  clock_in: string | null
  clock_out: string | null
  break_start: string | null
  break_end: string | null
  status: string
}

export default function LoginPage() {
  const { login, pinLogin } = useAuth()
  const [mode, setMode] = useState<'select' | 'admin' | 'kiosk' | 'pin-login'>('select')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  // Kiosk state
  const [companyPin, setCompanyPin] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [todayRecords, setTodayRecords] = useState<TodayRecord[]>([])

  // PIN login state
  const [pinLoginCompanyPin, setPinLoginCompanyPin] = useState('')
  const [pinLoginCompanyName, setPinLoginCompanyName] = useState('')
  const [pinLoginStaff, setPinLoginStaff] = useState<StaffMember[]>([])
  const [pinLoginStep, setPinLoginStep] = useState<1 | 2>(1)

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handlePinCompanyEnter = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await api.post('/auth/kiosk', { companyPin: pinLoginCompanyPin })
      setPinLoginCompanyName(res.data.company.name)
      setPinLoginStaff(res.data.staff)
      setPinLoginStep(2)
    } catch (err: any) {
      toast.error(err.response?.data?.error || '会社PINが正しくありません')
    } finally {
      setLoading(false)
    }
  }

  const handleStaffSelect = async (userId: number) => {
    setLoading(true)
    try {
      await pinLogin!(pinLoginCompanyPin, userId)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleKioskEnter = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await api.post('/auth/kiosk', { companyPin })
      setCompanyName(res.data.company.name)
      setStaff(res.data.staff)
      setTodayRecords(res.data.todayRecords)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'PINが正しくありません')
    } finally {
      setLoading(false)
    }
  }

  const handleClock = async (userId: number, action: string) => {
    try {
      const res = await api.post('/auth/kiosk-clock', { companyPin, userId, action })
      setTodayRecords(res.data.todayRecords)
      const actionLabels: Record<string, string> = {
        'clock-in': '出勤',
        'clock-out': '退勤',
        'break-start': '休憩開始',
        'break-end': '休憩終了',
      }
      toast.success(actionLabels[action] + 'しました')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'エラーが発生しました')
    }
  }

  const getStaffStatus = (userId: number) => {
    const rec = todayRecords.find(r => r.user_id === userId)
    if (!rec || !rec.clock_in) return 'none'
    if (rec.clock_out) return 'done'
    if (rec.break_start && !rec.break_end) return 'break'
    return 'working'
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'working': return { text: '勤務中', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' }
      case 'break': return { text: '休憩中', color: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' }
      case 'done': return { text: '退勤済', color: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' }
      default: return { text: '未出勤', color: 'bg-blue-50 text-blue-600', dot: 'bg-blue-400' }
    }
  }

  // Kiosk: Staff list view
  if (mode === 'kiosk' && staff.length > 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
          <button onClick={() => { setStaff([]); setCompanyPin('') }} className="flex items-center gap-1 text-gray-500 hover:text-gray-700">
            <ArrowLeft className="w-4 h-4" /> 戻る
          </button>
          <h1 className="text-lg font-bold">{companyName}</h1>
          <div className="text-sm text-gray-500">{new Date().toLocaleDateString('ja-JP')}</div>
        </div>

        <div className="max-w-lg mx-auto p-4 space-y-3">
          {staff.map(s => {
            const status = getStaffStatus(s.id)
            const label = getStatusLabel(status)
            const rec = todayRecords.find(r => r.user_id === s.id)

            return (
              <div key={s.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: s.color }}
                  >
                    {s.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">{s.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.employment_type === 'full_time' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {s.employment_type === 'full_time' ? '社員' : 'パート'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${label.dot}`} />
                    <span className={`text-xs px-2 py-0.5 rounded-full ${label.color}`}>{label.text}</span>
                  </div>
                </div>

                {rec?.clock_in && (
                  <div className="text-xs text-gray-500 mb-2">
                    出勤: {rec.clock_in}
                    {rec.break_start && ' / 休憩: ' + rec.break_start}
                    {rec.break_end && '〜' + rec.break_end}
                    {rec.clock_out && ' / 退勤: ' + rec.clock_out}
                  </div>
                )}

                <div className="flex gap-2">
                  {status === 'none' && (
                    <button
                      onClick={() => handleClock(s.id, 'clock-in')}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                    >
                      <Clock className="w-4 h-4" /> 出勤
                    </button>
                  )}
                  {status === 'working' && (
                    <>
                      <button
                        onClick={() => handleClock(s.id, 'break-start')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600"
                      >
                        <Coffee className="w-4 h-4" /> 休憩
                      </button>
                      <button
                        onClick={() => handleClock(s.id, 'clock-out')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600"
                      >
                        <LogOut className="w-4 h-4" /> 退勤
                      </button>
                    </>
                  )}
                  {status === 'break' && (
                    <button
                      onClick={() => handleClock(s.id, 'break-end')}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                      <Clock className="w-4 h-4" /> 休憩終了
                    </button>
                  )}
                  {status === 'done' && (
                    <p className="text-xs text-gray-400 py-2">本日の勤務は終了しました</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Kiosk: PIN entry
  if (mode === 'kiosk') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-600 rounded-2xl shadow-lg mb-4">
              <Clock className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">出退勤</h1>
            <p className="text-gray-500 mt-1">会社PINを入力してください</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <form onSubmit={handleKioskEnter} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">会社PIN</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={companyPin}
                  onChange={e => setCompanyPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="PINコードを入力"
                  className="input-field text-center text-3xl tracking-[0.5em] py-4"
                  maxLength={8}
                  required
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading} className="w-full btn-primary py-3 text-base">
                {loading ? '読み込み中...' : '入る'}
              </button>
            </form>

            <button
              onClick={() => setMode('select')}
              className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700"
            >
              戻る
            </button>
          </div>
        </div>
      </div>
    )
  }

  // PIN login: step 1 - company PIN
  if (mode === 'pin-login' && pinLoginStep === 1) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl shadow-lg mb-4">
              <Calendar className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">会社PIN入力</h1>
            <p className="text-gray-500 mt-1">会社のPINコードを入力してください</p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <form onSubmit={handlePinCompanyEnter} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">会社PIN</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pinLoginCompanyPin}
                  onChange={e => setPinLoginCompanyPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="会社PINを入力"
                  className="input-field text-center text-3xl tracking-[0.5em] py-4"
                  maxLength={8}
                  required
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading} className="w-full btn-primary py-3 text-base">
                {loading ? '確認中...' : '次へ'}
              </button>
            </form>

            <button
              onClick={() => { setMode('select'); setPinLoginCompanyPin('') }}
              className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700"
            >
              戻る
            </button>
          </div>
        </div>
      </div>
    )
  }

  // PIN login: step 2 - staff select
  if (mode === 'pin-login' && pinLoginStep === 2) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">{pinLoginCompanyName}</h1>
            <p className="text-gray-500 mt-1">ログインするスタッフを選択してください</p>
          </div>

          <div className="space-y-2">
            {pinLoginStaff.map(s => (
              <button
                key={s.id}
                onClick={() => handleStaffSelect(s.id)}
                disabled={loading}
                className="w-full bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-left hover:shadow-md hover:border-blue-300 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: s.color }}
                  >
                    {s.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">{s.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.employment_type === 'full_time' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {s.employment_type === 'full_time' ? '社員' : 'パート'}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={() => { setPinLoginStep(1); setPinLoginStaff([]); setPinLoginCompanyPin('') }}
            className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700 text-center"
          >
            戻る
          </button>
        </div>
      </div>
    )
  }

  // Admin login
  if (mode === 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg mb-4">
              <Calendar className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">管理者ログイン</h1>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" required autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="input-field pr-10"
                    required
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full btn-primary py-3 text-base">
                {loading ? 'ログイン中...' : 'ログイン'}
              </button>
            </form>

            <button
              onClick={() => setMode('select')}
              className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700"
            >
              戻る
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Mode selection
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg mb-4">
            <Calendar className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">シフトログ</h1>
          <p className="text-gray-500 mt-1">シフト管理アプリ</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={() => setMode('pin-login')}
            className="w-full bg-white rounded-2xl shadow-xl p-6 text-left hover:shadow-2xl transition-shadow"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Calendar className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">PINログイン</h2>
                <p className="text-sm text-gray-500">会社PINでログイン</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setMode('kiosk')}
            className="w-full bg-white rounded-2xl shadow-xl p-6 text-left hover:shadow-2xl transition-shadow"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                <Clock className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">出退勤</h2>
                <p className="text-sm text-gray-500">会社PINで出退勤の打刻</p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setMode('admin')}
            className="w-full bg-white rounded-2xl shadow-xl p-6 text-left hover:shadow-2xl transition-shadow"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <Calendar className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">管理者ログイン</h2>
                <p className="text-sm text-gray-500">メール + パスワードでログイン</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
