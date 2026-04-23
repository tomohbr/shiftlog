import { useEffect, useState } from 'react'
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react'
import { payrollApi, PayrollSummary, PayrollFormat } from '../api/client'
import api from '../api/client'
import toast from 'react-hot-toast'

const FORMATS: { id: PayrollFormat; label: string; desc: string }[] = [
  { id: 'generic', label: '汎用CSV', desc: '全項目入り、Excel等で自由に加工可能' },
  { id: 'freee', label: 'freee 人事労務', desc: 'freee の勤怠インポート用' },
  { id: 'moneyforward', label: 'マネーフォワード', desc: 'MF クラウド給与形式' },
  { id: 'kingoftime', label: 'KING OF TIME', desc: 'KOT 取込用' },
]

export default function PayrollPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [summaries, setSummaries] = useState<PayrollSummary[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await payrollApi.getSummary(year, month)
      setSummaries(r.data.summaries)
    } catch (e: any) {
      toast.error(e.response?.data?.error || '読み込みに失敗しました')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [year, month])

  const download = async (format: PayrollFormat) => {
    try {
      // axios 経由で認証ヘッダ付きBLOBダウンロード
      const res = await (api as any).get('/payroll/export', {
        params: { year, month, format },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      const m = String(month).padStart(2, '0')
      a.href = url
      a.download = `${format}-${year}-${m}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('ダウンロードを開始しました')
    } catch (e: any) {
      toast.error('ダウンロードに失敗しました')
    }
  }

  const totalHours = summaries.reduce((a, s) => a + s.total_minutes / 60, 0)
  const totalWage = summaries.reduce((a, s) => a + s.total_wage, 0)

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">給与データ出力</h2>
          <p className="text-sm text-gray-500 mt-1">月次の勤怠集計を給与ソフト向けCSVでエクスポート</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-gray-200 rounded px-2 py-1.5 text-sm">
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border border-gray-200 rounded px-2 py-1.5 text-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
          </select>
          <button onClick={load} className="flex items-center gap-1 px-2 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">対象人数</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{summaries.length}名</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">合計労働時間</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalHours.toFixed(1)}h</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">概算給与合計</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">¥{totalWage.toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" /> 出力形式を選んでダウンロード
        </h3>
        <div className="grid md:grid-cols-2 gap-2">
          {FORMATS.map(f => (
            <button
              key={f.id}
              onClick={() => download(f.id)}
              className="flex items-center justify-between gap-3 px-4 py-3 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition text-left"
            >
              <div>
                <p className="text-sm font-semibold text-gray-800">{f.label}</p>
                <p className="text-xs text-gray-500">{f.desc}</p>
              </div>
              <Download className="w-4 h-4 text-blue-600" />
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 text-sm font-semibold">{year}年{month}月 勤怠サマリー</div>
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">読み込み中...</div>
        ) : summaries.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">対象月のシフトデータがありません</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-600">氏名</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">日数</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">総時間</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">残業</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">深夜</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">休日</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">給与</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(s => (
                <tr key={s.user_id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{s.user_name}</td>
                  <td className="px-4 py-2 text-right">{s.days}</td>
                  <td className="px-4 py-2 text-right">{(s.total_minutes / 60).toFixed(1)}h</td>
                  <td className="px-4 py-2 text-right">{(s.overtime_minutes / 60).toFixed(1)}h</td>
                  <td className="px-4 py-2 text-right">{(s.night_minutes / 60).toFixed(1)}h</td>
                  <td className="px-4 py-2 text-right">{(s.holiday_minutes / 60).toFixed(1)}h</td>
                  <td className="px-4 py-2 text-right font-semibold">¥{s.total_wage.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
