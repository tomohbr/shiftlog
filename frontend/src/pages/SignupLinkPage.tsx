import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { apiBaseUrl } from '../native/platform'

// ログインの新規登録（/signup/:token）。担当者から届いたリンクを開き、本人がメールアドレスとパスワードを決める。
// 登録できたら、そのメールとパスワードでログインすればダッシュボードに入れる。

export default function SignupLinkPage({ token }: { token: string }) {
  const [info, setInfo] = useState<{ name: string; company_name: string; email: string } | null>(null)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    document.title = 'ログインの新規登録'
    fetch(`${apiBaseUrl}/login-setup/${encodeURIComponent(token)}`)
      .then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.error); setInfo(b); setEmail(b.email || '') })
      .catch(e => setError(e.message || '開けませんでした'))
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (pw.length < 8) { setFormError('パスワードは8文字以上にしてください'); return }
    if (pw !== pw2) { setFormError('パスワードが1回目と2回目で違います'); return }
    setSaving(true)
    try {
      const r = await fetch(`${apiBaseUrl}/login-setup/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }),
      })
      const b = await r.json()
      if (!r.ok) throw new Error(b.error)
      setDone(b.email)
    } catch (err: any) {
      setFormError(err.message || '登録できませんでした')
    } finally {
      setSaving(false)
    }
  }

  if (error) return <div className="min-h-screen flex items-center justify-center px-6 text-center text-gray-700 font-semibold">{error}</div>
  if (!info) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <p className="text-xs font-semibold text-gray-500">{info.company_name}｜シフトログ</p>
        {done ? (
          <>
            <h1 className="text-xl font-bold text-gray-900 mt-1">登録できました</h1>
            <p className="text-sm text-gray-600 mt-3">次からは、このメールアドレスと決めたパスワードでログインしてください。</p>
            <p className="mt-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm font-mono break-all">{done}</p>
            <a href={`/login?email=${encodeURIComponent(done)}`} className="btn-primary w-full justify-center mt-5">ログインする</a>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900 mt-1">{info.name}さんのログインを作ります</h1>
            <p className="text-sm text-gray-600 mt-2">メールアドレスとパスワードを決めてください。次からはこの2つでログインして、ダッシュボードを見られます。</p>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
                <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder="例：name@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">パスワード（8文字以上）</label>
                <div className="relative">
                  <input type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={pw} onChange={e => setPw(e.target.value)} className="input-field pr-10" />
                  <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? '隠す' : '表示'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">パスワード（もう一度）</label>
                <input type={show ? 'text' : 'password'} autoComplete="new-password" required value={pw2} onChange={e => setPw2(e.target.value)} className="input-field" />
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <button type="submit" disabled={saving} className="btn-primary w-full justify-center disabled:opacity-50">{saving ? '登録中…' : '登録する'}</button>
            </form>
            <p className="text-xs text-gray-400 mt-4">このリンクは1回だけ使えます。パスワードは本人しか知りません。</p>
          </>
        )}
      </div>
    </div>
  )
}
