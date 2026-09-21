import { useState, useEffect } from 'react'
import { MessageCircle, Save, Send, ExternalLink, Check, Copy } from 'lucide-react'
import { lineApi } from '../api/client'
import LineLinkCard from '../components/LineLinkCard'
import toast from 'react-hot-toast'

interface LineSettings {
  channel_access_token: string
  channel_secret: string
  notify_shift_published: boolean
  notify_shift_changed: boolean
  notify_help_request: boolean
  notify_request_open: boolean
}
type Toggle = 'notify_shift_published' | 'notify_request_open'
interface Member { id: number; name: string; role: string; linked: boolean }

export default function LineSettingsPage() {
  const [settings, setSettings] = useState<LineSettings>({
    channel_access_token: '',
    channel_secret: '',
    notify_shift_published: true,
    notify_shift_changed: true,
    notify_help_request: true,
    notify_request_open: true,
  })
  const [bot, setBot] = useState<{ name: string | null; basicId: string | null }>({ name: null, basicId: null })
  const [webhookUrl, setWebhookUrl] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [check, setCheck] = useState<{ bot?: string; webhook?: string; error?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [cardKey, setCardKey] = useState(0)

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    try {
      const res = await lineApi.getSettings()
      const s = res.data?.settings
      setWebhookUrl(res.data?.webhook_url || '')
      setMembers(res.data?.members || [])
      if (s) {
        setSettings({
          channel_access_token: s.channel_access_token || '',
          channel_secret: s.channel_secret || '',
          notify_shift_published: s.notify_shift_published == null ? true : !!s.notify_shift_published,
          notify_shift_changed: s.notify_shift_changed == null ? true : !!s.notify_shift_changed,
          notify_help_request: s.notify_help_request == null ? true : !!s.notify_help_request,
          notify_request_open: s.notify_request_open == null ? true : !!s.notify_request_open,
        })
        setBot({ name: s.bot_name || null, basicId: s.bot_basic_id || null })
      }
    } catch {
      // Settings may not exist yet, that's OK
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!settings.channel_access_token.trim() || !settings.channel_secret.trim()) {
      toast.error('チャネルアクセストークンとチャネルシークレットの両方を入力してください')
      return
    }
    setSaving(true)
    setCheck(null)
    try {
      const res = await lineApi.saveSettings(settings)
      setCheck(res.data?.check || null)
      toast.success('LINE設定を保存しました')
      await loadSettings()
      setCardKey(k => k + 1)
    } catch (err: any) {
      toast.error(err.response?.data?.error || '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const res = await lineApi.testNotify()
      toast.success(res.data?.message || 'テスト通知を送信しました')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'テスト送信に失敗しました')
    } finally {
      setTesting(false)
    }
  }

  const toggleSetting = (key: Toggle) => setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  const linkedCount = members.filter(m => m.linked).length

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
          お店のLINE公式アカウントから、スタッフにシフト公開などをお知らせします
        </p>
      </div>

      {bot.basicId && (
        <div className="card p-4 bg-green-50 border-green-200 text-sm text-green-900 flex items-center gap-2">
          <Check className="w-4 h-4" /> つながっているLINE: <b>{bot.name}</b>（{bot.basicId}）
        </div>
      )}

      {/* 自分の連携（管理者もテスト受信のために連携しておく） */}
      <LineLinkCard key={cardKey} />

      {/* 接続情報 */}
      <div className="card p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">LINE公式アカウントとの接続</h3>
        <div>
          <label className="text-sm font-medium text-gray-700">チャネルアクセストークン（長期）</label>
          <div className="relative mt-1">
            <input
              type={showToken ? 'text' : 'password'}
              value={settings.channel_access_token}
              onChange={e => setSettings(prev => ({ ...prev, channel_access_token: e.target.value }))}
              className="input-field pr-20 font-mono text-sm"
              placeholder="Messaging API設定 → チャネルアクセストークン"
            />
            <button type="button" onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700">
              {showToken ? '隠す' : '表示'}
            </button>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">チャネルシークレット</label>
          <input
            type={showToken ? 'text' : 'password'}
            value={settings.channel_secret}
            onChange={e => setSettings(prev => ({ ...prev, channel_secret: e.target.value }))}
            className="input-field mt-1 font-mono text-sm"
            placeholder="チャネル基本設定 → チャネルシークレット"
          />
        </div>
        <p className="text-xs text-gray-500">
          保存すると、LINE側の「Webhook URL」の登録までシフトログが自動で行います。
        </p>
        {webhookUrl && (
          <p className="text-[11px] text-gray-400 flex items-center gap-1 break-all">
            Webhook URL: <span className="font-mono">{webhookUrl}</span>
            <button onClick={() => { navigator.clipboard?.writeText(webhookUrl); toast.success('コピーしました') }} className="shrink-0 text-gray-500"><Copy className="w-3 h-3" /></button>
          </p>
        )}
        {check && (
          <div className={`text-xs rounded-lg p-3 ${check.error || check.webhook?.includes('NG') || check.webhook?.includes('失敗') ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
            {check.bot && <p>LINE: {check.bot}</p>}
            {check.webhook && <p>{check.webhook}</p>}
            {check.error && <p>{check.error}</p>}
          </div>
        )}
      </div>

      {/* Notification Toggles */}
      <div className="card p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">お知らせする内容</h3>
        <div className="space-y-4">
          {([
            ['notify_shift_published', 'シフトを公開したとき', '「公開」を押すと、連携済みの全員に「○月のシフトが公開されました」と届きます'],
            ['notify_request_open', 'シフト希望の受付を始めたとき', '対象期間と締切をつけて全員に届きます'],
          ] as const).map(([key, title, desc], i) => (
            <div key={key}>
              {i > 0 && <div className="border-t border-gray-100 mb-4" />}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{title}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
                <button
                  onClick={() => toggleSetting(key)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-3 ${settings[key] ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings[key] ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" />
          {saving ? '接続を確認中...' : '保存して接続'}
        </button>
        <button onClick={handleTest} disabled={testing || !bot.basicId} className="btn-secondary flex items-center gap-2">
          <Send className="w-4 h-4" />
          {testing ? '送信中...' : 'テスト送信'}
        </button>
      </div>

      {/* 連携状況 */}
      {bot.basicId && (
        <div className="card p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-1">スタッフの連携状況</h3>
          <p className="text-xs text-gray-500 mb-3">
            {members.length}人中 <b className="text-gray-800">{linkedCount}人</b> がLINEで受け取れます。
            まだの人には「スタッフ画面の『自分のシフト』→『シフトをLINEで受け取る』」を案内してください。
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            {members.map(m => (
              <li key={m.id} className={`rounded-lg border px-2 py-1.5 flex items-center justify-between ${m.linked ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
                <span className="truncate">{m.name}{m.role !== 'staff' && <span className="text-[10px] text-gray-400 ml-1">管理者</span>}</span>
                <span className={`text-[11px] shrink-0 ml-1 ${m.linked ? 'text-green-700' : 'text-gray-400'}`}>{m.linked ? '連携済み' : '未連携'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Setup Guide */}
      <div className="card p-6 bg-gray-50 border-gray-200">
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          <MessageCircle className="w-4 h-4 inline mr-1 text-green-500" />
          はじめての設定（10分）
        </h3>
        <ol className="space-y-3 text-sm text-gray-700">
          {[
            <>
              <a href="https://manager.line.biz/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1">
                LINE Official Account Manager <ExternalLink className="w-3.5 h-3.5" />
              </a>
              でお店の「LINE公式アカウント」を作ります（すでにあればそれを使えます）。
            </>,
            <>アカウントの「設定 → Messaging API」で「Messaging APIを利用する」を押します。</>,
            <>
              <a href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1">
                LINE Developers <ExternalLink className="w-3.5 h-3.5" />
              </a>
              で、そのチャネルの「チャネルシークレット」（チャネル基本設定）と「チャネルアクセストークン（長期）」（Messaging API設定の一番下で発行）をコピーして、上に貼り付けます。
            </>,
            <>「保存して接続」を押します。Webhook の登録はシフトログが自動で行います。</>,
            <>LINE Official Account Manager の「応答設定」で、<b>Webhook をオン</b>、<b>応答メッセージをオフ</b>にします（オンのままだと連携コードに自動返信が混ざります）。</>,
            <>このページ上の「シフトをLINEで受け取る」でまず自分を連携し、「テスト送信」で届くか確認します。</>,
          ].map((body, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">{i + 1}</span>
              <span>{body}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
          <p className="text-xs text-yellow-800">
            <strong>通数について:</strong> LINE公式アカウントの無料プランは月200通までです（1人に1通送ると1通）。スタッフ10人に月2回の公開なら40通で収まります。
          </p>
        </div>
      </div>
    </div>
  )
}
