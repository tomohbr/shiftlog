import { track } from '../lib/analytics'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Calendar, Eye, EyeOff, Clock, Coffee, LogOut, ArrowLeft, UserPlus, Fingerprint, Users, ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import toast from 'react-hot-toast'
import { isNative } from '../native/platform'
import { getBiometricInfo, getQuickLoginEmail, loadQuickLogin, saveQuickLogin } from '../native/biometric'

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
  const { login, register, pinLogin } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMode = searchParams.get('mode') === 'register' ? 'register' : 'select'
  const [mode, setMode] = useState<'select' | 'admin' | 'kiosk' | 'pin-login' | 'register'>(initialMode)
  const previousMode = useRef<string | null>(null)
  // 登録画面への切り替えを計測し、StrictModeでの重複を防ぐ。
  useEffect(() => {
    if (mode === 'register' && previousMode.current !== mode) track('register_start')
    previousMode.current = mode
  }, [mode])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  // Kiosk state
  const [companyPin, setCompanyPin] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [todayRecords, setTodayRecords] = useState<TodayRecord[]>([])

  // Register state
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regCompanyName, setRegCompanyName] = useState('')
  const [regIndustry, setRegIndustry] = useState('restaurant')

  // PIN login state
  const [pinLoginCompanyPin, setPinLoginCompanyPin] = useState('')
  const [pinLoginCompanyName, setPinLoginCompanyName] = useState('')
  const [pinLoginStaff, setPinLoginStaff] = useState<StaffMember[]>([])
  const [pinLoginStep, setPinLoginStep] = useState<1 | 2>(1)

  // QRコード/招待リンクの ?pin= を踏んだ場合、PIN入力を省略して名前選択まで自動で進める
  useEffect(() => {
    const pinFromUrl = searchParams.get('pin')?.replace(/\D/g, '')
    if (!pinFromUrl) return
    setMode('pin-login')
    setPinLoginCompanyPin(pinFromUrl)
    api.post('/auth/kiosk', { companyPin: pinFromUrl })
      .then(res => {
        setPinLoginCompanyName(res.data.company.name)
        setPinLoginStaff(res.data.staff)
        setPinLoginStep(2)
      })
      .catch(() => toast.error('QRコードの読み取りに失敗しました。会社PINを入力してください'))
    searchParams.delete('pin')
    setSearchParams(searchParams, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Face ID / Touch ID でのかんたんログイン（iOSアプリのみ）
  const [quickLoginEmail, setQuickLoginEmail] = useState<string | null>(null)
  const [biometryLabel, setBiometryLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!isNative) return
    void (async () => {
      const info = await getBiometricInfo()
      if (!info.available) return
      setBiometryLabel(info.label)
      setQuickLoginEmail(await getQuickLoginEmail())
    })()
  }, [])

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      // ログインできたら、次回から生体認証で入れるよう端末の Keychain に保存する
      if (isNative && biometryLabel && quickLoginEmail !== email) {
        try {
          await saveQuickLogin(email, password)
          setQuickLoginEmail(email)
        } catch { /* Keychain に保存できなくてもログイン自体は成功している */ }
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleBiometricLogin = async () => {
    setLoading(true)
    try {
      const creds = await loadQuickLogin()
      if (!creds) {
        setLoading(false)
        return
      }
      await login(creds.email, creds.password)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'ログインに失敗しました。パスワードを入力してください。')
    } finally {
      setLoading(false)
    }
  }

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await register(regEmail, regPassword, regName, regCompanyName)
    } catch (err: any) {
      toast.error(err.response?.data?.error || '登録に失敗しました')
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
      <div className="auth-shell">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4">
              <Clock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">出退勤</h1>
            <p className="text-gray-500 mt-1">会社PINを入力してください</p>
          </div>

          <div className="auth-card">
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
      <div className="auth-shell">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4">
              <Calendar className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">スタッフログイン</h1>
            <p className="text-gray-500 mt-1">店長から共有されたPINコードを入力</p>
          </div>

          <div className="auth-card">
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
      <div className="auth-shell">
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

  // Register
  if (mode === 'register') {
    return (
      <div className="auth-shell">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4">
              <UserPlus className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">まず1店舗を3分で作成</h1>
            <p className="text-gray-500 mt-1">出退勤打刻・シフト・勤務集計をまとめて確認できます</p>
          </div>

          <div className="auth-card">
            <div className="mb-5 rounded-xl bg-blue-50 border border-blue-100 p-3">
              <p className="text-sm font-semibold text-blue-900">30日間Proの全機能を無料でお試し・クレジットカード不要</p>
              <p className="text-xs text-blue-800 mt-1">終了後も1店舗の打刻・シフト管理はずっと無料。登録するとその店舗名で店舗ができ、すぐスタッフ登録から始められます。</p>
            </div>
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">お名前</label>
                <input type="text" value={regName} onChange={e => setRegName(e.target.value)} className="input-field" required autoFocus placeholder="山田太郎" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">店舗名・会社名</label>
                <input type="text" value={regCompanyName} onChange={e => setRegCompanyName(e.target.value)} className="input-field" required placeholder="〇〇レストラン" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">業種</label>
                <select value={regIndustry} onChange={e => setRegIndustry(e.target.value)} className="input-field">
                  <option value="restaurant">飲食店</option>
                  <option value="salon">美容室・サロン</option>
                  <option value="retail">小売</option>
                  <option value="other">その他</option>
                </select>
                
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
                <input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} className="input-field" required placeholder="example@email.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
                <input type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} className="input-field" required placeholder="4文字以上" minLength={4} />
              </div>
              <button type="submit" disabled={loading} className="w-full btn-primary py-3 rounded-xl text-base">
                {loading ? '登録中...' : '無料で店舗を作成する'}
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

  // Admin login
  if (mode === 'admin') {
    return (
      <div className="auth-shell">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4">
              <Calendar className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">オーナー・店長ログイン</h1>
          </div>

          <div className="auth-card">
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

            {isNative && biometryLabel && quickLoginEmail && (
              <>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-xs text-gray-400">または</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleBiometricLogin()}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg font-semibold disabled:opacity-50"
                >
                  <Fingerprint className="w-5 h-5" />
                  {biometryLabel}でログイン
                </button>
                <p className="text-xs text-gray-400 text-center mt-2">{quickLoginEmail}</p>
              </>
            )}

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
    <div className="auth-shell">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4">
            <Calendar className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">シフトログ</h1>
          <p className="text-gray-600 mt-2 leading-relaxed">打刻とシフトを、オーナーが毎日見える状態に</p>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">出退勤打刻・今日のシフト・勤務集計を1画面で。1店舗なら無料で始められます。</p>
        </div>

        {/* 初めての方: 画面で唯一の青いボタン */}
        <button
          onClick={() => setMode('register')}
          className="w-full btn-primary py-3.5 text-base rounded-xl"
        >
          <UserPlus className="w-5 h-5" />
          無料で店舗を作成する
        </button>
        <p className="text-center text-xs text-gray-500 mt-2">30日間Proを無料でお試し。クレジットカードは不要です</p>

        <p className="eyebrow mt-8 mb-2">アカウントをお持ちの方</p>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
          {([
            ['admin', Calendar, 'オーナー・店長ログイン', 'メールアドレスとパスワード'],
            ['pin-login', Users, 'スタッフログイン', '店長から共有された会社PIN'],
            ['kiosk', Clock, '出退勤タイムレコーダー', '店舗に置くタブレットで打刻する'],
          ] as const).map(([m, Icon, title, sub]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="w-full flex items-center gap-4 px-4 py-4 text-left hover:bg-gray-50 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
            </button>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-5 text-xs text-gray-400">
          <Link to="/" className="hover:text-gray-600">シフトログについて</Link>
          <Link to="/legal/tokusho" className="hover:text-gray-600">特定商取引法に基づく表記</Link>
        </div>
      </div>
    </div>
  )
}
