import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Store, Users, Calendar, Send, Check, ArrowRight, Plus, X, Copy, Share2, QrCode } from 'lucide-react'
import { storesApi, usersApi, shiftsApi, User } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import StaffLoginQR, { simpleInviteMessage } from '../components/StaffLoginQR'
import LineShareButton from '../components/LineShareButton'
import toast from 'react-hot-toast'

type Step = 1 | 2 | 3 | 4

const STEP_LABELS: Record<Step, string> = {
  1: '店舗',
  2: 'スタッフ',
  3: 'シフト',
  4: '招待',
}

function StepDots({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {([1, 2, 3, 4] as Step[]).map((s, i) => (
        <div key={s} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              s < current
                ? 'bg-green-500 text-white'
                : s === current
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-400'
            }`}
          >
            {s < current ? <Check className="w-4 h-4" /> : s}
          </div>
          <span className={`ml-1.5 mr-2 text-xs font-medium hidden sm:inline ${s === current ? 'text-blue-700' : 'text-gray-400'}`}>
            {STEP_LABELS[s]}
          </span>
          {i < 3 && <div className={`w-6 sm:w-10 h-0.5 mr-2 ${s < current ? 'bg-green-400' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  )
}

export default function OnboardingPage() {
  const { selectedCompany, clearJustRegistered } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const companyPin = (selectedCompany as any)?.company_pin || ''
  const companyName = selectedCompany?.name || ''

  const finish = () => {
    clearJustRegistered()
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4 py-10">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">ようこそ、{companyName}さん</h1>
          <p className="text-sm text-gray-500 mt-1">3分で、店舗の運用が始められる状態にします</p>
        </div>

        <StepDots current={step} />

        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
          {step === 1 && <StoreStep onNext={() => setStep(2)} onSkip={() => setStep(2)} />}
          {step === 2 && <StaffStep onNext={() => setStep(3)} onSkip={() => setStep(4)} />}
          {step === 3 && <ShiftStep onNext={() => setStep(4)} onSkip={() => setStep(4)} />}
          {step === 4 && <InviteStep companyPin={companyPin} companyName={companyName} onFinish={finish} />}
        </div>

        <button
          onClick={finish}
          className="w-full mt-4 text-xs text-gray-400 hover:text-gray-600 text-center"
        >
          スキップしてダッシュボードへ
        </button>
      </div>
    </div>
  )
}

// ===================== Step 1: 店舗 =====================

function StoreStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await storesApi.create({ name: name.trim() })
      toast.success('店舗を登録しました')
      onNext()
    } catch (err: any) {
      toast.error(err.response?.data?.error || '登録に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
          <Store className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">まず店舗を登録しましょう</h2>
          <p className="text-xs text-gray-500">店舗名だけでOK。あとから編集できます</p>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">店舗名</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="例: 〇〇レストラン 本店"
          className="input-field"
          autoFocus
          required
        />
      </div>
      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">
          あとで登録する
        </button>
        <button type="submit" disabled={loading || !name.trim()} className="btn-primary flex items-center gap-2">
          {loading ? '登録中...' : '次へ'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </form>
  )
}

// ===================== Step 2: スタッフ =====================

function StaffStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [nameInput, setNameInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [staffList, setStaffList] = useState<User[]>([])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nameInput.trim()) return
    setAdding(true)
    try {
      const res = await usersApi.create({ name: nameInput.trim(), role: 'staff', employment_type: 'part_time' })
      setStaffList(prev => [...prev, res.data.user])
      setNameInput('')
      toast.success(`${res.data.user.name}さんを追加しました`)
    } catch (err: any) {
      toast.error(err.response?.data?.error || '追加に失敗しました')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (u: User) => {
    try {
      await usersApi.delete(u.id)
      setStaffList(prev => prev.filter(s => s.id !== u.id))
    } catch {
      toast.error('削除に失敗しました')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
          <Users className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">スタッフを追加しましょう</h2>
          <p className="text-xs text-gray-500">名前だけで登録できます。あとから何人でも追加できます</p>
        </div>
      </div>

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          placeholder="例: 山田花子"
          className="input-field flex-1"
          autoFocus
        />
        <button type="submit" disabled={adding || !nameInput.trim()} className="btn-primary px-4 flex items-center gap-1.5 shrink-0">
          <Plus className="w-4 h-4" />
          追加
        </button>
      </form>

      {staffList.length > 0 && (
        <div className="space-y-1.5">
          {staffList.map(s => (
            <div key={s.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: s.color }}
              >
                {s.name.charAt(0)}
              </div>
              <span className="text-sm font-medium text-gray-800 flex-1">{s.name}</span>
              <button onClick={() => handleRemove(s)} className="text-gray-300 hover:text-red-500">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">
          あとで登録する
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={staffList.length === 0}
          className="btn-primary flex items-center gap-2 disabled:opacity-40"
        >
          次へ{staffList.length > 0 ? `（${staffList.length}名）` : ''}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ===================== Step 3: シフト =====================

function ShiftStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [staffList, setStaffList] = useState<User[] | null>(null)
  const [userId, setUserId] = useState('')
  const [date, setDate] = useState(() => {
    const t = new Date()
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  })
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    usersApi.getAll().then(res => {
      const staff = res.data.users.filter(u => u.company_role === 'staff' || u.role === 'staff')
      setStaffList(staff)
      if (staff[0]) setUserId(String(staff[0].id))
    }).catch(() => setStaffList([]))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) return
    setLoading(true)
    try {
      await shiftsApi.create({ user_id: parseInt(userId), date, start_time: startTime, end_time: endTime, break_minutes: 0 })
      toast.success('シフトを作成しました')
      onNext()
    } catch (err: any) {
      toast.error(err.response?.data?.error || '作成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  if (staffList === null) {
    return <div className="py-12 text-center text-gray-400 text-sm">読み込み中...</div>
  }

  if (staffList.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">シフトを作成しましょう</h2>
            <p className="text-xs text-gray-500">先にスタッフを登録すると、ここでシフトを組めます</p>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button type="button" onClick={onSkip} className="btn-primary flex items-center gap-2">
            次へ
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
          <Calendar className="w-5 h-5 text-green-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">シフトを1件作りましょう</h2>
          <p className="text-xs text-gray-500">試しに1件作ると、画面の見え方がわかります</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">スタッフ</label>
        <select value={userId} onChange={e => setUserId(e.target.value)} className="input-field" required>
          {staffList.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">日付</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field" required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="input-field" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">終了時間</label>
          <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="input-field" required />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">
          あとで作成する
        </button>
        <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
          {loading ? '作成中...' : '次へ'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </form>
  )
}

// ===================== Step 4: 招待 =====================

function InviteStep({ companyPin, companyName, onFinish }: { companyPin: string; companyName: string; onFinish: () => void }) {
  const [staffList, setStaffList] = useState<User[] | null>(null)

  useEffect(() => {
    usersApi.getAll().then(res => {
      setStaffList(res.data.users.filter(u => u.company_role === 'staff' || u.role === 'staff'))
    }).catch(() => setStaffList([]))
  }, [])

  const message = staffList && staffList[0] ? simpleInviteMessage(staffList[0].name, companyName, companyPin) : ''

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
          <Send className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">最後に、スタッフを招待しましょう</h2>
          <p className="text-xs text-gray-500">QRを店舗に貼るか、案内文をLINEで送るだけです</p>
        </div>
      </div>

      {companyPin && (
        <div className="flex justify-center">
          <StaffLoginQR companyPin={companyPin} size={140} />
        </div>
      )}

      {staffList && staffList.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 relative">
          <p className="text-xs text-gray-600 mb-2">案内文の例（{staffList[0].name}さん宛）</p>
          <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans pr-20">{message}</pre>
          <div className="absolute top-2 right-2 flex gap-1.5">
            <LineShareButton text={message} className="px-2.5 py-1.5 text-xs bg-[#06C755] text-white rounded hover:opacity-90 flex items-center gap-1 font-semibold" />
            {typeof navigator !== 'undefined' && !!(navigator as any).share && (
              <button
                type="button"
                onClick={() => (navigator as any).share({ title: 'シフトログ ログイン案内', text: message }).catch(() => {})}
                className="px-2.5 py-1.5 text-xs bg-white border border-green-300 rounded hover:bg-green-50 flex items-center gap-1 font-semibold"
              >
                <Share2 className="w-3 h-3" /> 送る
              </button>
            )}
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(message); toast.success('コピーしました') }}
              className="px-2.5 py-1.5 text-xs bg-white border border-green-300 rounded hover:bg-green-50 flex items-center gap-1 font-semibold"
            >
              <Copy className="w-3 h-3" /> コピー
            </button>
          </div>
        </div>
      )}

      {!companyPin && (
        <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
          <QrCode className="w-4 h-4 shrink-0" />
          会社PINの準備中です。スタッフ管理画面から後で招待できます。
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button type="button" onClick={onFinish} className="btn-primary flex items-center gap-2">
          設定を完了する
          <Check className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
