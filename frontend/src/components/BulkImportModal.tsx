import { useState } from 'react'
import { X, Upload, FileText, CheckCircle2, AlertCircle } from 'lucide-react'
import { userBulkApi, BulkImportRow, BulkImportResult } from '../api/client'
import toast from 'react-hot-toast'

interface Props {
  onClose: () => void
  onDone: () => void
}

// 「,」と「\"」を考慮した簡易CSVパーサ
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else cur += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { row.push(cur); cur = '' }
      else if (ch === '\n' || ch === '\r') {
        if (cur || row.length) { row.push(cur); rows.push(row); row = []; cur = '' }
        if (ch === '\r' && text[i + 1] === '\n') i++
      } else cur += ch
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

const TEMPLATE = `氏名,メール,PIN,時給,雇用形態,電話
山田太郎,taro@example.com,1234,1100,パート,090-1234-5678
佐藤花子,,5678,1500,アルバイト,
`

export default function BulkImportModal({ onClose, onDone }: Props) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<BulkImportRow[]>([])
  const [results, setResults] = useState<BulkImportResult[] | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleFile = (f: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const content = String(e.target?.result || '')
      setText(content)
      buildPreview(content)
    }
    reader.readAsText(f, 'utf-8')
  }

  const buildPreview = (content: string) => {
    if (!content.trim()) { setPreview([]); return }
    const rows = parseCsv(content)
    if (rows.length === 0) { setPreview([]); return }
    const header = rows[0].map(h => h.trim())
    const idx = (key: string) => header.findIndex(h => h === key)
    const parsed: BulkImportRow[] = []
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      if (r.every(c => !c || !c.trim())) continue
      const row: BulkImportRow = {
        name: (r[idx('氏名')] || r[0] || '').trim(),
        email: (r[idx('メール')] || '').trim() || undefined,
        pin: (r[idx('PIN')] || '').trim() || undefined,
        hourly_wage: r[idx('時給')] ? Number(r[idx('時給')]) : undefined,
        employment_type: (r[idx('雇用形態')] || '').trim() || undefined,
        phone: (r[idx('電話')] || '').trim() || undefined,
      }
      if (row.name) parsed.push(row)
    }
    setPreview(parsed)
  }

  const submit = async () => {
    if (preview.length === 0) { toast.error('プレビューに行がありません'); return }
    setSubmitting(true)
    try {
      const res = await userBulkApi.import(preview)
      setResults(res.data.results)
      const created = res.data.results.filter(r => r.status === 'created').length
      toast.success(`${created}名を登録しました`)
      onDone()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'インポートに失敗しました')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="text-lg font-bold flex items-center gap-2"><Upload className="w-5 h-5 text-blue-600" /> CSV一括インポート</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {!results && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                <p className="font-semibold mb-1">CSV フォーマット（1行目がヘッダー）</p>
                <pre className="text-[10px] bg-white rounded p-2 overflow-x-auto">{TEMPLATE}</pre>
                <button
                  onClick={() => {
                    const blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url; a.download = 'shiftlog-staff-template.csv'; a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="mt-2 text-blue-700 underline text-xs"
                >
                  テンプレートをダウンロード
                </button>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">ファイル選択（.csv）</label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                  className="text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">またはCSVを直接貼り付け</label>
                <textarea
                  value={text}
                  onChange={e => { setText(e.target.value); buildPreview(e.target.value) }}
                  rows={6}
                  placeholder="氏名,メール,PIN,時給,雇用形態,電話..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-mono"
                />
              </div>

              {preview.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2 flex items-center gap-1">
                    <FileText className="w-4 h-4" /> プレビュー（{preview.length}名）
                  </p>
                  <div className="border border-gray-200 rounded max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1.5">氏名</th>
                          <th className="text-left px-2 py-1.5">メール</th>
                          <th className="text-left px-2 py-1.5">PIN</th>
                          <th className="text-left px-2 py-1.5">時給</th>
                          <th className="text-left px-2 py-1.5">形態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((r, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-2 py-1.5">{r.name}</td>
                            <td className="px-2 py-1.5 text-gray-500">{r.email || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-500">{r.pin || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-500">{r.hourly_wage ?? '—'}</td>
                            <td className="px-2 py-1.5 text-gray-500">{r.employment_type || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {results && (
            <div>
              <p className="text-sm font-semibold mb-2">インポート結果</p>
              <div className="space-y-1 text-xs">
                {results.map(r => (
                  <div key={r.row} className={`flex items-center gap-2 px-2 py-1 rounded ${r.status === 'created' ? 'bg-green-50' : r.status === 'skipped' ? 'bg-yellow-50' : 'bg-red-50'}`}>
                    {r.status === 'created' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <AlertCircle className="w-3.5 h-3.5 text-orange-600" />}
                    <span className="font-mono w-8">#{r.row}</span>
                    <span>{r.status === 'created' ? '登録' : r.status === 'skipped' ? 'スキップ' : 'エラー'}</span>
                    {r.message && <span className="text-gray-500">— {r.message}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">閉じる</button>
          {!results && (
            <button
              onClick={submit}
              disabled={submitting || preview.length === 0}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded"
            >
              {submitting ? '登録中...' : `${preview.length}名を登録`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
