import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, X } from 'lucide-react'
import { lineApi } from '../api/client'

// LINE 招待カードの一括印刷（A4に8枚）。顔合わせの日に配って、その場で読んでもらう用。
// 既定はまだ連携していない人だけ。カードは名前入りの本人専用QR。

type Link = { user_id: number; name: string; role: string; linked: boolean; url: string }

export default function LineInvitePrintPage() {
  const [links, setLinks] = useState<Link[]>([])
  const [company, setCompany] = useState('')
  const [onlyUnlinked, setOnlyUnlinked] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    lineApi.inviteLinks()
      .then(r => { setLinks(r.data.links); setCompany(r.data.company_name) })
      .finally(() => setLoading(false))
  }, [])

  const shown = links.filter(l => l.role === 'staff' && (!onlyUnlinked || !l.linked))

  return (
    <div className="min-h-screen bg-gray-100">
      <style>{`
        @page { size: A4 portrait; margin: 8mm; }
        @media print {
          .noprint { display: none !important; }
          body { background: white !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
        }
        .card { break-inside: avoid; }
      `}</style>
      <div className="noprint sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-700 font-semibold">LINE招待カード（{shown.length}枚）</p>
        <label className="text-sm text-gray-600 flex items-center gap-1.5">
          <input type="checkbox" checked={onlyUnlinked} onChange={e => setOnlyUnlinked(e.target.checked)} />
          まだ連携していない人だけ
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={() => window.print()} className="btn-primary flex items-center gap-1.5"><Printer className="w-4 h-4" />印刷する</button>
          <button onClick={() => window.close()} className="btn-secondary flex items-center gap-1.5"><X className="w-4 h-4" />閉じる</button>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-gray-500 py-20">読み込み中…</p>
      ) : shown.length === 0 ? (
        <p className="text-center text-gray-500 py-20">全員連携済みです</p>
      ) : (
        <div className="overflow-x-auto">
        <div className="sheet mx-auto my-6 bg-white shadow p-[8mm] w-[210mm] grid grid-cols-2 gap-[4mm]">
          {shown.map(l => (
            <div key={l.user_id} className="card border-2 border-dashed border-gray-300 rounded-xl p-4 flex items-center gap-4">
              <QRCodeSVG value={l.url} size={120} className="shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-gray-500">{company}</p>
                <p className="text-xl font-bold text-gray-900 break-words">{l.name} さん</p>
                <p className="text-xs font-bold text-[#06C755] mt-1">シフトの連絡をLINEで</p>
                <ol className="text-[11px] text-gray-700 mt-1 leading-snug list-decimal pl-4">
                  <li>カメラでQRを読む</li>
                  <li>「友だち追加」を押す</li>
                  <li>「コードを送る」を押して送信</li>
                </ol>
              </div>
            </div>
          ))}
        </div>
        </div>
      )}
    </div>
  )
}
