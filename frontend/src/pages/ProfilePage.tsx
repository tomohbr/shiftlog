import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { authApi, usersApi, icalApi } from '../api/client'
import { User, Mail, Lock, Save, Calendar, Copy, Trash2, Sun, Moon } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ProfilePage() {
  const { user } = useAuth()
  const [email, setEmail] = useState(user?.email || '')
  const [name, setName] = useState(user?.name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [icalUrl, setIcalUrl] = useState<string | null>(null)
  const [icalLoading, setIcalLoading] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) ? 'dark' : 'light'
  )

  const issueIcal = async () => {
    setIcalLoading(true)
    try {
      const res = await icalApi.getToken()
      setIcalUrl(res.data.url)
      toast.success('購読URLを生成しました')
    } catch (e: any) {
      toast.error(e.response?.data?.error || '生成に失敗しました')
    } finally { setIcalLoading(false) }
  }
  const revokeIcal = async () => {
    if (!confirm('購読URLを失効させますか？既に設定済みのカレンダーアプリからは読み込めなくなります。')) return
    try {
      await icalApi.revoke()
      setIcalUrl(null)
      toast.success('失効しました')
    } catch (e: any) {
      toast.error(e.response?.data?.error || '失敗しました')
    }
  }
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    if (next === 'dark') document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
    try { localStorage.setItem('theme', next) } catch {}
  }

  const handleProfileSave = async () => {
    if (!user) return
    setSavingProfile(true)
    try {
      await usersApi.update(user.id, { name, email })
      toast.success('プロフィールを更新しました')
    } catch (e: any) {
      toast.error(e.response?.data?.error || '更新に失敗しました')
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword) {
      toast.error('現在のパスワードと新しいパスワードを入力してください')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('新しいパスワードが一致しません')
      return
    }
    if (newPassword.length < 4) {
      toast.error('パスワードは4文字以上にしてください')
      return
    }
    setSavingPassword(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      toast.success('パスワードを変更しました')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'パスワード変更に失敗しました')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Profile Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <User className="w-6 h-6 text-blue-600" />
          <h2 className="text-lg font-bold text-gray-900">プロフィール設定</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <span className="flex items-center gap-1.5">
                <User className="w-4 h-4" />
                名前
              </span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <span className="flex items-center gap-1.5">
                <Mail className="w-4 h-4" />
                メールアドレス
              </span>
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <button
            onClick={handleProfileSave}
            disabled={savingProfile}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {savingProfile ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Password Change */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Lock className="w-6 h-6 text-blue-600" />
          <h2 className="text-lg font-bold text-gray-900">パスワード変更</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              現在のパスワード
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="現在のパスワード"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              新しいパスワード
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="新しいパスワード"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              新しいパスワード（確認）
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="もう一度入力"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <button
            onClick={handlePasswordChange}
            disabled={savingPassword}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
          >
            <Lock className="w-4 h-4" />
            {savingPassword ? '変更中...' : 'パスワードを変更'}
          </button>
        </div>
      </div>

      {/* カレンダー購読 (iCal) */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-600" /> カレンダー購読
        </h3>
        <p className="text-sm text-gray-500">
          自分のシフトを Google/Apple カレンダーに自動同期できる購読URLを発行します。URLは秘密情報として扱ってください。
        </p>
        {icalUrl ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input readOnly value={icalUrl} className="flex-1 border border-gray-300 rounded px-3 py-2 text-xs font-mono bg-gray-50" />
              <button
                onClick={() => { navigator.clipboard.writeText(icalUrl); toast.success('URLをコピーしました') }}
                className="px-3 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5" /> コピー
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Google カレンダー: 「他のカレンダー」→「URLで追加」にこのURLを貼り付け<br />
              iPhone: 「設定」→「カレンダー」→「アカウント」→「アカウントを追加」→「その他」→「照会するカレンダーを追加」
            </p>
            <button
              onClick={revokeIcal}
              className="text-xs text-red-600 hover:underline flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> 購読URLを失効
            </button>
          </div>
        ) : (
          <button
            onClick={issueIcal}
            disabled={icalLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg text-sm"
          >
            {icalLoading ? '生成中...' : '購読URLを生成'}
          </button>
        )}
      </div>

      {/* 表示設定 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-3">表示設定</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {theme === 'dark' ? <Moon className="w-5 h-5 text-indigo-600" /> : <Sun className="w-5 h-5 text-amber-500" />}
            <span className="text-sm">ダークモード</span>
          </div>
          <button
            onClick={toggleTheme}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${theme === 'dark' ? 'bg-indigo-600' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${theme === 'dark' ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>
    </div>
  )
}
