import { useState, useEffect } from 'react'
import { MessageCircle, Save, Send, ExternalLink } from 'lucide-react'
import { lineApi } from '../api/client'
import toast from 'react-hot-toast'

interface LineSettings {
  channel_access_token: string
  notify_on_publish: boolean
  notify_on_change: boolean
  notify_on_help_request: boolean
}

export default function LineSettingsPage() {
  const [settings, setSettings] = useState<LineSettings>({
    channel_access_token: '',
    notify_on_publish: true,
    notify_on_change: true,
    notify_on_help_request: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const res = await lineApi.getSettings()
      if (res.data) {
        setSettings({
          channel_access_token: res.data.channel_access_token || '',
          notify_on_publish: res.data.notify_on_publish ?? true,
          notify_on_change: res.data.notify_on_change ?? true,
          notify_on_help_request: res.data.notify_on_help_request ?? true,
        })
      }
    } catch {
      // Settings may not exist yet, that's OK
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!settings.channel_access_token.trim()) {
      toast.error('チャネルアクセストークンを入力してください')
      return
    }
    setSaving(true)
    try {
      await lineApi.saveSettings(settings)
      toast.success('LINE設定を保存しました')
    } catch (err: any) {
      toast.error(err.response?.data?.error || '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!settings.channel_access_token.trim()) {
      toast.error('先にチャネルアクセストークンを保存してください')
      return
    }
    setTesting(true)
    try {
      await lineApi.testNotify()
      toast.success('テスト通知を送信しました')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'テスト送信に失敗しました')
    } finally {
      setTesting(false)
    }
  }

  const toggleSetting = (key: keyof Omit<LineSettings, 'channel_access_token'>) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-green-500" />
          LINE通知設定
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          LINE公式アカウントからスタッフにシフト通知を送信できます
        </p>
      </div>

      {/* Token Setting */}
      <div className="card p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">チャネルアクセストークン</h3>
        <div className="space-y-3">
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={settings.channel_access_token}
              onChange={e => setSettings(prev => ({ ...prev, channel_access_token: e.target.value }))}
              className="input-field pr-20 font-mono text-sm"
              placeholder="LINE Messaging APIのチャネルアクセストークンを入力"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
            >
              {showToken ? '隠す' : '表示'}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            LINE Developers コンソールの Messaging API 設定から取得できます
          </p>
        </div>
      </div>

      {/* Notification Toggles */}
      <div className="card p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">通知設定</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">シフト公開時に通知</p>
              <p className="text-xs text-gray-500">管理者がシフトを公開した際にスタッフへ通知します</p>
            </div>
            <button
              onClick={() => toggleSetting('notify_on_publish')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.notify_on_publish ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.notify_on_publish ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="border-t border-gray-100" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">シフト変更時に通知</p>
              <p className="text-xs text-gray-500">公開済みシフトが変更された際に該当スタッフへ通知します</p>
            </div>
            <button
              onClick={() => toggleSetting('notify_on_change')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.notify_on_change ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.notify_on_change ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="border-t border-gray-100" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">ヘルプ募集時に通知</p>
              <p className="text-xs text-gray-500">欠勤連絡が発生した際に全スタッフへ通知します</p>
            </div>
            <button
              onClick={() => toggleSetting('notify_on_help_request')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.notify_on_help_request ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.notify_on_help_request ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '設定を保存'}
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !settings.channel_access_token.trim()}
          className="btn-secondary flex items-center gap-2"
        >
          <Send className="w-4 h-4" />
          {testing ? '送信中...' : 'テスト送信'}
        </button>
      </div>

      {/* Setup Guide */}
      <div className="card p-6 bg-gray-50 border-gray-200">
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          <MessageCircle className="w-4 h-4 inline mr-1 text-green-500" />
          LINE公式アカウントの設定方法
        </h3>
        <ol className="space-y-3 text-sm text-gray-700">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">1</span>
            <div>
              <a
                href="https://developers.line.biz/console/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
              >
                LINE Developers コンソール
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              にログインし、新しいプロバイダーを作成します。
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">2</span>
            <span>プロバイダー内で「Messaging API」チャネルを作成します。チャネル名はお店の名前にすると分かりやすいです。</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">3</span>
            <span>チャネル設定の「Messaging API」タブから「チャネルアクセストークン（長期）」を発行し、上のフィールドに貼り付けます。</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">4</span>
            <span>作成したLINE公式アカウントのQRコードをスタッフに共有し、友だち追加してもらいます。友だち追加後にシフトログアプリ内でLINE連携を行います。</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">5</span>
            <span>設定を保存後、「テスト送信」ボタンで通知が届くか確認してください。</span>
          </li>
        </ol>
        <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
          <p className="text-xs text-yellow-800">
            <strong>注意:</strong> LINE Messaging APIの無料プランでは月200通までメッセージを送信できます。スタッフ数が多い場合はライトプラン以上をご検討ください。
          </p>
        </div>
      </div>
    </div>
  )
}
