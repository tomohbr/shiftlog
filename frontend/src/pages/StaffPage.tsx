import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, X, Eye, EyeOff, Upload, AlertCircle, Send, Copy } from 'lucide-react'
import { usersApi, User } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import BulkImportModal from '../components/BulkImportModal'
import toast from 'react-hot-toast'

const COLORS = [
  '#E74C3C', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
  '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50',
  '#8BC34A', '#CDDC39', '#FFC107', '#FF9800', '#FF5722',
]

interface UserModalProps {
  user?: User | null
  onClose: () => void
  onSave: () => void
}

function UserModal({ user, onClose, onSave }: UserModalProps) {
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [pin, setPin] = useState((user as any)?.pin || '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [color, setColor] = useState(user?.color || COLORS[0])
  const [hourlyWage, setHourlyWage] = useState(user?.hourly_wage || 1000)
  const [phone, setPhone] = useState(user?.phone || '')
  const [role, setRole] = useState(user?.role || 'staff')
  const [employmentType, setEmploymentType] = useState((user as any)?.employment_type || 'part_time')
  const [loading, setLoading] = useState(false)

  const isAdmin = role === 'admin'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isAdmin && !email) {
      toast.error('管理者にはメールアドレスが必須です')
      return
    }
    if (isAdmin && !user && !password) {
      toast.error('管理者にはパスワードが必須です')
      return
    }
    setLoading(true)
    try {
      if (user) {
        await usersApi.update(user.id, { name, email: email || undefined, password: password || undefined, pin, color, hourly_wage: hourlyWage, phone, role, employment_type: employmentType })
        toast.success('スタッフ情報を更新しました')
      } else {
        await usersApi.create({ name, email: email || undefined, password: password || undefined, pin, color, hourly_wage: hourlyWage, phone, role, employment_type: employmentType })
        toast.success('スタッフを追加しました')
      }
      onSave()
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">{user ? 'スタッフ編集' : 'スタッフ追加'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">氏名</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input-field" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">個人PIN（ログイン用）</label>
            <input
              type="text"
              inputMode="numeric"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              className="input-field"
              placeholder="4桁の数字"
              maxLength={8}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              メールアドレス{isAdmin ? '（必須）' : '（任意）'}
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder={isAdmin ? '管理者は必須' : '任意'} required={isAdmin} />
          </div>

          {(!user || isAdmin) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                パスワード{isAdmin && !user ? '（必須）' : '（任意）'}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input-field pr-10"
                  placeholder={isAdmin ? '管理者は必須（6文字以上）' : 'メールログイン時のみ必要'}
                  minLength={6}
                  required={isAdmin && !user}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {isAdmin && user && <p className="text-xs text-gray-400 mt-1">空欄の場合、パスワードは変更されません</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">役割</label>
              <select value={role} onChange={e => setRole(e.target.value)} className="input-field">
                <option value="staff">スタッフ</option>
                <option value="admin">管理者</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">雇用形態</label>
              <select value={employmentType} onChange={e => setEmploymentType(e.target.value)} className="input-field">
                <option value="full_time">社員</option>
                <option value="part_time">パート</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">時給 (円){employmentType === 'full_time' && <span className="text-gray-400 text-xs ml-1">※社員は月給制</span>}</label>
            <input
              type="number"
              value={hourlyWage}
              onChange={e => setHourlyWage(parseInt(e.target.value))}
              className="input-field"
              min={0}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className="input-field" placeholder="任意" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">カラー</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? '保存中...' : user ? '更新' : '追加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function isNeverLoggedIn(u: User): boolean {
  if (u.role === 'admin') return false
  // 打刻がなく、登録から24時間以上経過
  if (u.timecard_count && u.timecard_count > 0) return false
  if (!u.created_at) return false
  const created = new Date(u.created_at.replace(' ', 'T') + 'Z').getTime()
  return Date.now() - created > 24 * 60 * 60 * 1000
}

function generateInviteMessage(u: User, companyName: string, companyPin: string): string {
  const url = 'https://shiftlog-production.up.railway.app/'
  return `【シフトログご案内】${companyName}
${u.name}さん、スタッフ管理アプリ「シフトログ」のアカウントを作成しました。
スマホ・PCどちらでも使えます。

▼ アプリURL
${url}

▼ ログイン手順
1. 上のURLを開く
2. 「スタッフログイン」をタップ
3. 会社PIN: ${companyPin}
4. 一覧から「${u.name}」をタップ
${u.pin ? `5. 個人PIN: ${u.pin}` : '5. 個人PIN（4桁）を入力'}

▼ できること
・出退勤の打刻
・シフト確認・希望提出
・シフト交代の依頼
・急な欠勤連絡

▼ スマホ: ホーム画面に追加すると便利です
iPhone(Safari): 共有 → ホーム画面に追加
Android(Chrome): メニュー → ホーム画面に追加

ご不明な点があればお気軽に。`
}

export default function StaffPage() {
  const { selectedCompany } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [inviteUser, setInviteUser] = useState<User | null>(null)
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const loadUsers = async () => {
    setLoading(true)
    try {
      const res = await usersApi.getAll()
      setUsers(res.data.users)
    } catch {
      toast.error('スタッフ一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  const handleDelete = async (user: User) => {
    if (!confirm(`${user.name} を削除してもよいですか？`)) return
    try {
      await usersApi.delete(user.id)
      toast.success('スタッフを削除しました')
      loadUsers()
    } catch (err: any) {
      toast.error(err.response?.data?.error || '削除に失敗しました')
    }
  }

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !newPassword) return
    try {
      await usersApi.resetPassword(resetPasswordUser.id, newPassword)
      toast.success('パスワードをリセットしました')
      setResetPasswordUser(null)
      setNewPassword('')
    } catch {
      toast.error('パスワードリセットに失敗しました')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">スタッフ一覧</h2>
          <p className="text-sm text-gray-500 mt-0.5">{users.length}名登録中</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setBulkOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <Upload className="w-4 h-4" />
            CSV一括登録
          </button>
          <button
            onClick={() => { setEditingUser(null); setModalOpen(true) }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            スタッフ追加
          </button>
        </div>
      </div>
      {bulkOpen && <BulkImportModal onClose={() => setBulkOpen(false)} onDone={loadUsers} />}

      {(() => {
        const neverCount = users.filter(isNeverLoggedIn).length
        if (neverCount === 0) return null
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                {neverCount}名のスタッフがまだ一度もログインしていません
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                右の「招待」ボタンから会社PIN入りの招待メッセージを表示・コピーして、LINEやメールで送ってください。
              </p>
            </div>
          </div>
        )
      })()}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">スタッフ</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">PIN</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">時給</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">形態</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">役割</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                        style={{ backgroundColor: u.color }}
                      >
                        {u.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-gray-900">{u.name}</p>
                          {isNeverLoggedIn(u) && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                              <AlertCircle className="w-2.5 h-2.5" />未ログイン
                            </span>
                          )}
                        </div>
                        {u.phone && <p className="text-xs text-gray-400">{u.phone}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell">
                    <span className="text-sm text-gray-600 font-mono">{(u as any).pin || '-'}</span>
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    <span className="text-sm text-gray-600">¥{(u.hourly_wage || 0).toLocaleString()}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={(u as any).employment_type === 'full_time' ? 'text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700' : 'text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700'}>
                      {(u as any).employment_type === 'full_time' ? '社員' : 'パート'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={u.role === 'admin' ? 'badge-confirmed' : 'badge-approved'}>
                      {u.role === 'admin' ? '管理者' : 'スタッフ'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 justify-end">
                      {u.role === 'staff' && (
                        <button
                          onClick={() => setInviteUser(u)}
                          className="text-xs text-green-700 hover:text-green-900 px-2 py-1 rounded hover:bg-green-50 flex items-center gap-1 border border-green-200"
                          title="招待メッセージを表示"
                        >
                          <Send className="w-3 h-3" />
                          招待
                        </button>
                      )}
                      <button
                        onClick={() => setResetPasswordUser(u)}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                      >
                        PW変更
                      </button>
                      <button
                        onClick={() => { setEditingUser(u); setModalOpen(true) }}
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {users.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              スタッフが登録されていません
            </div>
          )}
        </div>
      )}

      {modalOpen && (
        <UserModal
          user={editingUser}
          onClose={() => { setModalOpen(false); setEditingUser(null) }}
          onSave={loadUsers}
        />
      )}

      {resetPasswordUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setResetPasswordUser(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold mb-4">パスワードリセット</h3>
            <p className="text-sm text-gray-600 mb-4">{resetPasswordUser.name} のパスワードを変更します</p>
            <input
              type="password"
              placeholder="新しいパスワード"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="input-field mb-4"
              minLength={6}
            />
            <div className="flex gap-2">
              <button onClick={() => { setResetPasswordUser(null); setNewPassword('') }} className="btn-secondary flex-1">キャンセル</button>
              <button onClick={handleResetPassword} className="btn-primary flex-1">変更</button>
            </div>
          </div>
        </div>
      )}

      {inviteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setInviteUser(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Send className="w-5 h-5 text-green-600" />
                招待メッセージ
              </h3>
              <button onClick={() => setInviteUser(null)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3">
              <p className="text-sm text-gray-700">
                <b className="text-gray-900">{inviteUser.name}</b> さんに下記メッセージを LINE やメールで送ってください。コピーボタン1タップで貼り付けられます。
              </p>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 relative">
                <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans pr-20">
                  {generateInviteMessage(inviteUser, selectedCompany?.name || '', (selectedCompany as any)?.company_pin || '')}
                </pre>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generateInviteMessage(inviteUser, selectedCompany?.name || '', (selectedCompany as any)?.company_pin || ''))
                    toast.success('メッセージをコピーしました')
                  }}
                  className="absolute top-2 right-2 px-3 py-1.5 text-xs bg-white border border-green-300 rounded hover:bg-green-50 flex items-center gap-1 font-semibold"
                >
                  <Copy className="w-3 h-3" /> コピー
                </button>
              </div>
              {isNeverLoggedIn(inviteUser) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                  <p className="font-semibold mb-1">⚠️ この方はまだ一度もログインしていません</p>
                  <p>登録から24時間以上経過しています。上のメッセージを再度送ってアクセスを促してください。</p>
                </div>
              )}
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-gray-200 bg-gray-50">
              <button onClick={() => setInviteUser(null)} className="btn-secondary">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
