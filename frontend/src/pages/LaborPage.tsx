import { useState, useEffect, useCallback } from 'react'
import { format, addMonths, subMonths, getDaysInMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { DollarSign, AlertTriangle, TrendingUp, Save } from 'lucide-react'
import { laborApi } from '../api/client'
import MonthNavigator from '../components/MonthNavigator'
import toast from 'react-hot-toast'

type TabKey = 'costs' | 'ratio' | 'alerts'

interface DailyCost {
  date: string
  labor_cost: number
  hours: number
  staff_count: number
}

interface WeeklySummary {
  week: number
  start_date: string
  end_date: string
  labor_cost: number
  hours: number
}

interface CostsData {
  total_cost: number
  daily: DailyCost[]
  weekly: WeeklySummary[]
}

interface DailyRatio {
  date: string
  sales: number
  labor_cost: number
  ratio: number
}

interface RatioData {
  total_sales: number
  total_labor_cost: number
  total_ratio: number
  daily: DailyRatio[]
}

interface LaborAlert {
  id: number
  severity: 'warning' | 'error'
  type: 'consecutive_days' | 'weekly_overtime' | 'monthly_overtime'
  user_name: string
  user_color?: string
  message: string
  details: string
  affected_dates: string[]
}

interface AlertsData {
  alerts: LaborAlert[]
}

export default function LaborPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [activeTab, setActiveTab] = useState<TabKey>('costs')
  const [loading, setLoading] = useState(true)

  // Tab 1 state
  const [costsData, setCostsData] = useState<CostsData>({
    total_cost: 0,
    daily: [],
    weekly: [],
  })

  // Tab 2 state
  const [ratioData, setRatioData] = useState<RatioData>({
    total_sales: 0,
    total_labor_cost: 0,
    total_ratio: 0,
    daily: [],
  })
  const [salesInputs, setSalesInputs] = useState<Record<string, string>>({})
  const [savingDate, setSavingDate] = useState<string | null>(null)

  // Tab 3 state
  const [alertsData, setAlertsData] = useState<AlertsData>({ alerts: [] })

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth() + 1

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (activeTab === 'costs') {
        const res = await laborApi.getCosts(year, month)
        const data = res.data as CostsData
        setCostsData({
          total_cost: data.total_cost ?? 0,
          daily: data.daily ?? [],
          weekly: data.weekly ?? [],
        })
      } else if (activeTab === 'ratio') {
        const res = await laborApi.getRatio(year, month)
        const data = res.data as RatioData
        setRatioData({
          total_sales: data.total_sales ?? 0,
          total_labor_cost: data.total_labor_cost ?? 0,
          total_ratio: data.total_ratio ?? 0,
          daily: data.daily ?? [],
        })
        // Initialize sales inputs from data
        const inputs: Record<string, string> = {}
        for (const d of data.daily ?? []) {
          inputs[d.date] = d.sales > 0 ? String(d.sales) : ''
        }
        setSalesInputs(inputs)
      } else if (activeTab === 'alerts') {
        const res = await laborApi.getAlerts(year, month)
        const data = res.data as AlertsData
        setAlertsData({ alerts: data.alerts ?? [] })
      }
    } catch {
      toast.error('データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [year, month, activeTab])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSaveSales = async (date: string) => {
    const amount = Number(salesInputs[date] || 0)
    if (isNaN(amount) || amount < 0) {
      toast.error('有効な金額を入力してください')
      return
    }
    setSavingDate(date)
    try {
      await laborApi.saveSales(date, amount)
      toast.success('売上を保存しました')
      // Reload ratio data
      const res = await laborApi.getRatio(year, month)
      const data = res.data as RatioData
      setRatioData({
        total_sales: data.total_sales ?? 0,
        total_labor_cost: data.total_labor_cost ?? 0,
        total_ratio: data.total_ratio ?? 0,
        daily: data.daily ?? [],
      })
    } catch {
      toast.error('売上の保存に失敗しました')
    } finally {
      setSavingDate(null)
    }
  }

  const getRatioColor = (ratio: number): string => {
    if (ratio <= 0) return 'text-gray-400'
    if (ratio < 30) return 'text-green-600'
    if (ratio <= 35) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getRatioBgColor = (ratio: number): string => {
    if (ratio <= 0) return 'bg-gray-100'
    if (ratio < 30) return 'bg-green-100'
    if (ratio <= 35) return 'bg-yellow-100'
    return 'bg-red-100'
  }

  const getAlertTypeLabel = (type: string): string => {
    switch (type) {
      case 'consecutive_days':
        return '連勤'
      case 'weekly_overtime':
        return '週40時間超過'
      case 'monthly_overtime':
        return '月間残業'
      default:
        return type
    }
  }

  const maxDailyCost = Math.max(...costsData.daily.map(d => d.labor_cost), 1)

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'costs', label: '人件費', icon: <DollarSign className="w-4 h-4" /> },
    { key: 'ratio', label: '売上・人件費率', icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'alerts', label: '労務アラート', icon: <AlertTriangle className="w-4 h-4" /> },
  ]

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
    return `${d.getMonth() + 1}/${d.getDate()} (${dow})`
  }

  const getDowClass = (dateStr: string) => {
    const dow = new Date(dateStr).getDay()
    if (dow === 0) return 'text-red-600'
    if (dow === 6) return 'text-blue-600'
    return 'text-gray-800'
  }

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
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <>
          {/* Tab 1: 人件費 */}
          {activeTab === 'costs' && (
            <div className="space-y-6">
              {/* Total cost card */}
              <div className="card text-center py-8">
                <p className="text-sm text-gray-500 mb-1">月間人件費合計</p>
                <p className="text-4xl font-bold text-gray-900">
                  ¥{costsData.total_cost.toLocaleString()}
                </p>
              </div>

              {/* Daily bar chart */}
              <div className="card p-0 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-base font-semibold text-gray-900">日別人件費</h3>
                </div>
                <div className="px-6 py-4">
                  {costsData.daily.length === 0 ? (
                    <p className="text-center py-8 text-gray-400">データがありません</p>
                  ) : (
                    <div className="space-y-1.5">
                      {costsData.daily.map(day => {
                        const barWidth = maxDailyCost > 0 ? (day.labor_cost / maxDailyCost) * 100 : 0
                        return (
                          <div key={day.date} className="flex items-center gap-3">
                            <span className={`text-xs font-medium w-20 shrink-0 ${getDowClass(day.date)}`}>
                              {formatDate(day.date)}
                            </span>
                            <div className="flex-1 h-6 bg-gray-100 rounded-md overflow-hidden relative">
                              <div
                                className="h-full bg-blue-500 rounded-md transition-all duration-300"
                                style={{ width: `${barWidth}%` }}
                              />
                              {day.labor_cost > 0 && (
                                <span className="absolute inset-y-0 right-2 flex items-center text-xs font-medium text-gray-700">
                                  ¥{day.labor_cost.toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Weekly summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {costsData.weekly.map(week => (
                  <div key={week.week} className="card">
                    <p className="text-xs text-gray-500 mb-1">第{week.week}週</p>
                    <p className="text-xs text-gray-400 mb-2">
                      {formatDate(week.start_date)} ~ {formatDate(week.end_date)}
                    </p>
                    <p className="text-xl font-bold text-gray-900">
                      ¥{week.labor_cost.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {week.hours.toFixed(1)}時間
                    </p>
                  </div>
                ))}
                {costsData.weekly.length === 0 && (
                  <p className="text-gray-400 text-sm col-span-full text-center py-4">
                    週別データがありません
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: 売上・人件費率 */}
          {activeTab === 'ratio' && (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">月間売上</p>
                    <p className="text-2xl font-bold text-gray-900">
                      ¥{ratioData.total_sales.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="card flex items-center gap-4">
                  <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center">
                    <DollarSign className="w-6 h-6 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">月間人件費</p>
                    <p className="text-2xl font-bold text-gray-900">
                      ¥{ratioData.total_labor_cost.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className={`card flex items-center gap-4`}>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${getRatioBgColor(ratioData.total_ratio)}`}>
                    <TrendingUp className={`w-6 h-6 ${getRatioColor(ratioData.total_ratio)}`} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">人件費率</p>
                    <p className={`text-2xl font-bold ${getRatioColor(ratioData.total_ratio)}`}>
                      {ratioData.total_ratio > 0 ? `${ratioData.total_ratio.toFixed(1)}%` : '---'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Daily table */}
              <div className="card p-0 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-base font-semibold text-gray-900">日別 売上・人件費率</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">日付</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">売上</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">人件費</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">人件費率</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">保存</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ratioData.daily.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-gray-400">
                            データがありません
                          </td>
                        </tr>
                      ) : (
                        ratioData.daily.map(row => (
                          <tr key={row.date} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <span className={`text-sm font-medium ${getDowClass(row.date)}`}>
                                {formatDate(row.date)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end">
                                <div className="relative">
                                  <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 text-sm">¥</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="1000"
                                    className="w-32 pl-7 pr-3 py-1.5 text-right text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    value={salesInputs[row.date] ?? ''}
                                    onChange={e => {
                                      setSalesInputs(prev => ({
                                        ...prev,
                                        [row.date]: e.target.value,
                                      }))
                                    }}
                                    placeholder="0"
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm text-gray-700">
                                ¥{row.labor_cost.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`text-sm font-bold ${getRatioColor(row.ratio)}`}>
                                {row.ratio > 0 ? `${row.ratio.toFixed(1)}%` : '---'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => handleSaveSales(row.date)}
                                disabled={savingDate === row.date}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                                title="保存"
                              >
                                {savingDate === row.date ? (
                                  <div className="w-4 h-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                                ) : (
                                  <Save className="w-4 h-4" />
                                )}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: 労務アラート */}
          {activeTab === 'alerts' && (
            <div className="space-y-4">
              {alertsData.alerts.length === 0 ? (
                <div className="card text-center py-12">
                  <AlertTriangle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">アラートはありません</p>
                  <p className="text-sm text-gray-400 mt-1">労務上の問題が検出されると、ここに表示されます</p>
                </div>
              ) : (
                <>
                  {/* Alert summary */}
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-xl">
                      <div className="w-2.5 h-2.5 bg-red-500 rounded-full" />
                      <span className="text-sm font-medium text-red-700">
                        重大: {alertsData.alerts.filter(a => a.severity === 'error').length}件
                      </span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 bg-yellow-50 border border-yellow-200 rounded-xl">
                      <div className="w-2.5 h-2.5 bg-yellow-500 rounded-full" />
                      <span className="text-sm font-medium text-yellow-700">
                        注意: {alertsData.alerts.filter(a => a.severity === 'warning').length}件
                      </span>
                    </div>
                  </div>

                  {/* Alert list */}
                  <div className="space-y-3">
                    {alertsData.alerts.map(alert => (
                      <div
                        key={alert.id}
                        className={`card border-l-4 ${
                          alert.severity === 'error'
                            ? 'border-l-red-500'
                            : 'border-l-yellow-500'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                              alert.severity === 'error'
                                ? 'bg-red-100'
                                : 'bg-yellow-100'
                            }`}
                          >
                            <AlertTriangle
                              className={`w-4 h-4 ${
                                alert.severity === 'error'
                                  ? 'text-red-600'
                                  : 'text-yellow-600'
                              }`}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  alert.severity === 'error'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-yellow-100 text-yellow-700'
                                }`}
                              >
                                {alert.severity === 'error' ? '重大' : '注意'}
                              </span>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                {getAlertTypeLabel(alert.type)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              {alert.user_color && (
                                <div
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                  style={{ backgroundColor: alert.user_color }}
                                >
                                  {alert.user_name.charAt(0)}
                                </div>
                              )}
                              <span className="text-sm font-semibold text-gray-900">
                                {alert.user_name}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 mb-2">{alert.message}</p>
                            <p className="text-xs text-gray-500 mb-2">{alert.details}</p>
                            {alert.affected_dates.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {alert.affected_dates.map(date => (
                                  <span
                                    key={date}
                                    className="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600"
                                  >
                                    {formatDate(date)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
