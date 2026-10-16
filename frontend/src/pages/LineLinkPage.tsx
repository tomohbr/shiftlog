import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

// LINE で届いた「本人専用の希望提出リンク」の受け口。
// リンクの本人としてログインし、その月の希望提出画面へ移る（名前選択を省く）。期間の募集なら /campaign/:id へ
export default function LineLinkPage({ token }: { token: string }) {
  const { lineLinkLogin } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    lineLinkLogin(token)
      .then(({ year, month, page, campaign_id }) => {
        // 期間の募集（マーケットなど）のリンクは、その募集の回答画面へ
        if (page === 'campaign' && campaign_id) { window.location.replace(`/campaign/${campaign_id}`); return }
        const to = page === 'shifts' ? '/my-shifts' : '/shift-requests'
        window.location.replace(`${to}?year=${year}&month=${month}`)
      })
      .catch((e: any) => setError(e.response?.data?.error || 'リンクを開けませんでした'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div className="flex flex-col items-center justify-center h-screen px-6 text-center">
      {error ? (
        <>
          <p className="text-gray-800 font-semibold">{error}</p>
          <a href="/login" className="mt-4 text-blue-600 underline text-sm">ログイン画面へ</a>
        </>
      ) : (
        <>
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
          <p className="mt-4 text-sm text-gray-600">開いています…</p>
        </>
      )}
    </div>
  )
}
