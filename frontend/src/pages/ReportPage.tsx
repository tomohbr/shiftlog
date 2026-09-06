import { useState, useEffect, useCallback } from 'react'
import { format, addMonths, subMonths } from 'date-fns'
import { Crown, Download, TrendingUp, Clock, DollarSign } from 'lucide-react'
import { shiftsApi, csvApi, billingApi, Shift } from '../api/client'
import MonthNavigator from '../components/MonthNavigator'
import toast from 'react-hot-toast'

interface SummaryRow {
  user_id: number
  user_name: string
  user_color: string
  hourly_wage: number
  shift_count: number
  total_minutes: number
  total_hours: number
  total_minutes_remainder: number
  total_wage: number
}

export default function ReportPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [upgradeRequired, setUpgradeRequired] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState(false)

  const startProCheckout = async () => {
    setCheckoutLoading(true)
    try {
      const res = await billingApi.createCheckout()
      window.location.href = res.data.url
    } catch (e: any) {
      toast.error(e.response?.data?.error || '決済ページの作成に失敗しました')
      setCheckoutLoading(false)
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth() + 1
      const [summaryRes, shiftsRes] = await Promise.all([
        shiftsApi.getSummary(year, month),
        shiftsApi.getAll({ year, month }),
      ])
      setSummary(summaryRes.data.summary)
      setShifts(shiftsRes.data.shifts)
      setUpgradeRequired(false)
    } catch (e: any) {
      if (e.response?.data?.code === 'UPGRADE_REQUIRED') {
        setUpgradeRequired(true)
      } else {
        toast.error('データの取得に失敗しました')
      }
    } finally {
      setLoading(false)
    }
  }, [currentDate])

  useEffect(() => { loadData() }, [loadData])

  const totalShifts = shifts.length
  const totalHours = summary.reduce((sum, row) => sum + row.total_hours + row.total_minutes_remainder / 60, 0)
  const totalWage = summary.reduce((sum, row) => sum + row.total_wage, 0)

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCSV = async (type: 'shifts' | 'timecards' | 'summary') => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1
    try {
      const fn = type === 'shifts' ? csvApi.downloadShifts : type === 'timecards' ? csvApi.downloadTimecards : csvApi.downloadSummary
      const res = await fn(year, month)
      const names = { shifts: 'シフト一覧', timecards: 'タイムカード', summary: '勤務集計' }
      downloadBlob(res.data, `${names[type]}_${year}年${month}月.csv`)
      toast.success('CSVをダウンロードしました')
    } catch (e: any) {
      if (e.response?.data?.code === 'UPGRADE_REQUIRED') {
        setUpgradeRequired(true)
        toast.error('CSV出力はProプランで利用できます')
      } else {
        toast.error('ダウンロードに失敗しました')
      }
    }
  }

  // Shift detail by date
  const shiftsByDate: Record<string, Shift[]> = {}
  for (const s of shifts) {
    if (!shiftsByDate[s.date]) shiftsByDate[s.date] = []
    shiftsByDate[s.date].push(s)
  }
  const sortedDates = Object.keys(shiftsByDate).sort()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNavigator
          currentDate={currentDate}
          onPrev={() => setCurrentDate(d => subMonths(d, 1))}
          onNext={() => setCurrentDate(d => addMonths(d, 1))}
          onToday={() => setCurrentDate(new Date())}
        />
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button onClick={() => handleExportCSV('summary')} className="btn-secondary flex items-center justify-center gap-1 sm:gap-2 whitespace-nowrap text-xs sm:text-base px-2 sm:px-4 min-h-[44px] sm:min-h-0">
            <Download className="w-4 h-4" />勤務集計
          </button>
          <button onClick={() => handleExportCSV('shifts')} className="btn-secondary flex items-center justify-center gap-1 sm:gap-2 whitespace-nowrap text-xs sm:text-base px-2 sm:px-4 min-h-[44px] sm:min-h-0">
            <Download className="w-4 h-4" />シフト
          </button>
          <button onClick={() => handleExportCSV('timecards')} className="btn-secondary flex items-center justify-center gap-1 sm:gap-2 whitespace-nowrap text-xs sm:text-base px-2 sm:px-4 min-h-[44px] sm:min-h-0">
            <Download className="w-4 h-4" />タイムカード
          </button>
        </div>
      </div>

      {upgradeRequired && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-yellow-900">過去月の集計・CSV出力はPro機能です</p>
            <p className="text-sm text-yellow-800 mt-1">打刻・シフト管理・当月の集計は無料のまま使えます。過去月の履歴、CSV出力、スタッフ31名以上は月額¥980で利用できます。</p>
          </div>
          <button
            onClick={startProCheckout}
            disabled={checkoutLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600 disabled:opacity-60"
          >
            <Crown className="w-4 h-4" />
            {checkoutLoading ? '決済ページへ移動中...' : 'Proにする（月額¥980）'}
          </button>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        <div className="card p-3 md:p-6 flex items-center gap-2 md:gap-4">
          <div className="w-8 h-8 md:w-12 md:h-12 shrink-0 bg-blue-100 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-4 h-4 md:w-6 md:h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">総シフト数</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">{totalShifts}件</p>
          </div>
        </div>
        <div className="card p-3 md:p-6 flex items-center gap-2 md:gap-4">
          <div className="w-8 h-8 md:w-12 md:h-12 shrink-0 bg-green-100 rounded-xl flex items-center justify-center">
            <Clock className="w-4 h-4 md:w-6 md:h-6 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">総勤務時間</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">{totalHours.toFixed(1)}h</p>
          </div>
        </div>
        <div className="card col-span-2 md:col-span-1 p-3 md:p-6 flex items-center gap-2 md:gap-4">
          <div className="w-8 h-8 md:w-12 md:h-12 shrink-0 bg-yellow-100 rounded-xl flex items-center justify-center">
            <DollarSign className="w-4 h-4 md:w-6 md:h-6 text-yellow-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">総人件費</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">¥{totalWage.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <>
          {/* Per-staff summary table */}
          <div className="card p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">スタッフ別集計</h3>
            </div>
            <div className="overflow-x-auto">
              <div className="md:hidden divide-y divide-gray-100">
                {summary.map(row => (
                  <article key={row.user_id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: row.user_color }} />
                        <span className="text-sm font-medium text-gray-900 break-words">{row.user_name}</span>
                      </div>
                      <span className="text-base font-bold text-gray-900 whitespace-nowrap">¥{row.total_wage.toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-gray-600">{row.shift_count}日 / {row.total_hours}時間{row.total_minutes_remainder > 0 ? `${row.total_minutes_remainder}分` : ''} / 時給 ¥{row.hourly_wage.toLocaleString()}</p>
                  </article>
                ))}
                <div className="p-4 bg-gray-50 space-y-2">
                  <div className="flex justify-between gap-3 text-sm font-bold text-gray-900"><span>合計</span><span>¥{totalWage.toLocaleString()}</span></div>
                  <p className="text-xs text-gray-600">{summary.reduce((s, r) => s + r.shift_count, 0)}日 / {Math.floor(totalHours)}時間{Math.round((totalHours % 1) * 60) > 0 ? `${Math.round((totalHours % 1) * 60)}分` : ''}</p>
                </div>
              </div>
              <table className="hidden md:table w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">スタッフ</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">シフト日数</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">勤務時間</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">時給</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase">給与合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {summary.map(row => (
                    <tr key={row.user_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                            style={{ backgroundColor: row.user_color }}
                          >
                            {row.user_name.charAt(0)}
                          </div>
                          <span className="text-sm font-medium text-gray-900">{row.user_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="text-sm text-gray-700">{row.shift_count}日</span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="text-sm font-medium text-gray-900">
                          {row.total_hours}時間{row.total_minutes_remainder > 0 ? `${row.total_minutes_remainder}分` : ''}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="text-sm text-gray-600">¥{row.hourly_wage.toLocaleString()}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-bold text-gray-900">¥{row.total_wage.toLocaleString()}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td className="px-6 py-3 text-sm font-semibold text-gray-700">合計</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                      {summary.reduce((s, r) => s + r.shift_count, 0)}日
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                      {Math.floor(totalHours)}時間{Math.round((totalHours % 1) * 60) > 0 ? `${Math.round((totalHours % 1) * 60)}分` : ''}
                    </td>
                    <td className="px-4 py-3"></td>
                    <td className="px-6 py-3 text-right text-sm font-bold text-gray-900">
                      ¥{totalWage.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Daily shift details */}
          <div className="card p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">日別シフト一覧</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {sortedDates.length === 0 ? (
                <p className="text-center py-8 text-gray-400">シフトデータがありません</p>
              ) : (
                sortedDates.map(date => {
                  const dateShifts = shiftsByDate[date]
                  const d = new Date(date)
                  const dow = d.getDay()
                  const dayLabel = ['日', '月', '火', '水', '木', '金', '土'][dow]

                  return (
                    <div key={date} className="px-6 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-sm font-semibold ${dow === 0 ? 'text-red-600' : dow === 6 ? 'text-blue-600' : 'text-gray-800'}`}>
                          {format(d, 'M/d')} ({dayLabel})
                        </span>
                        <span className="text-xs text-gray-400">{dateShifts.length}名</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {dateShifts.map(s => {
                          const [sh, sm] = s.start_time.split(':').map(Number)
                          const [eh, em] = s.end_time.split(':').map(Number)
                          const mins = (eh * 60 + em) - (sh * 60 + sm) - s.break_minutes
                          return (
                            <div
                              key={s.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs"
                              style={{ backgroundColor: s.user_color }}
                            >
                              <span className="font-medium">{s.user_name}</span>
                              <span className="opacity-80">{s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)}</span>
                              <span className="opacity-70">({Math.floor(mins / 60)}h{mins % 60 > 0 ? `${mins % 60}m` : ''})</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
