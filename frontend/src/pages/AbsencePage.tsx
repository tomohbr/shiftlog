import { useState, useEffect } from 'react'
import { AlertCircle, UserCheck, Calendar, Send } from 'lucide-react'
import { absenceApi, AbsenceReport } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

export default function AbsencePage() {
  const { user, selectedCompany } = useAuth()
  const isAdmin = selectedCompany?.my_role === 'admin' || selectedCompany?.company_role === 'admin'

  const [myReports, setMyReports] = useState<AbsenceReport[]>([])
  const [helpRequests, setHelpRequests] = useState<AbsenceReport[]>([])
  const [allReports, setAllReports] = useState<AbsenceReport[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [tab, setTab] = useState<'report' | 'help'>('report')

  const loadData = async () => {
    setLoading(true)
    try {
      const [helpRes, allRes] = await Promise.all([
        absenceApi.getHelpRequests(),
        absenceApi.getAll(),
      ])
      setHelpRequests(helpRes.data.reports)
      const reports = allRes.data.reports
      setAllReports(reports)
      setMyReports(reports.filter(r => r.user_id === user?.id))
    } catch {
      toast.error('データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!date) {
      toast.error('日付を選択してください')
      return
    }
    setSubmitting(true)
    try {
      await absenceApi.report({ date, reason: reason || undefined })
      toast.success('欠勤連絡を送信しました')
      setDate('')
      setReason('')
      loadData()
    } catch (err: any) {
      toast.error(err.response?.data?.error || '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCover = async (id: number) => {
    if (!confirm('このシフトの代わりに入りますか？')) return
    try {
      await absenceApi.cover(id)
      toast.success('代替を申し出ました')
      loadData()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'エラーが発生しました')
    }
  }

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      await absenceApi.update(id, status)
      toast.success('ステータスを更新しました')
      loadData()
    } catch (err: any) {
      toast.error(err.response?.data?.error || '更新に失敗しました')
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">未対応</span>
      case 'covered':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">代替あり</span>
      case 'approved':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">承認済み</span>
      case 'rejected':
        return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">却下</span>
      default:
        return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{status}</span>
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setTab('report')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
            tab === 'report'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <AlertCircle className="w-4 h-4" />
          欠勤連絡
        </button>
        <button
          onClick={() => setTab('help')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
            tab === 'help'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          ヘルプ募集
          {helpRequests.length > 0 && (
            <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {helpRequests.length}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <>
          {/* 欠勤連絡 Tab */}
          {tab === 'report' && (
            <div className="space-y-6">
              {/* Report Form */}
              <div className="card p-6">
                <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  欠勤を連絡する
                </h3>
                <form onSubmit={handleReport} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      <Calendar className="w-4 h-4 inline mr-1" />
                      欠勤日
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={e => setDate(e.target.value)}
                      className="input-field"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">理由（任意）</label>
                    <textarea
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      className="input-field"
                      rows={3}
                      placeholder="体調不良、家庭の事情など"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    {submitting ? '送信中...' : '欠勤を連絡する'}
                  </button>
                </form>
              </div>

              {/* My Reports List */}
              <div className="card p-0 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <h3 className="text-sm font-semibold text-gray-700">自分の欠勤連絡一覧</h3>
                </div>
                {myReports.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    欠勤連絡はありません
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {myReports.map(report => (
                      <div key={report.id} className="px-6 py-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {formatDate(report.date)}
                            {report.start_time && report.end_time && (
                              <span className="text-gray-500 ml-2">
                                {report.start_time.slice(0, 5)} - {report.end_time.slice(0, 5)}
                              </span>
                            )}
                          </p>
                          {report.reason && (
                            <p className="text-xs text-gray-500 mt-0.5">{report.reason}</p>
                          )}
                          {report.cover_user_name && (
                            <p className="text-xs text-blue-600 mt-0.5">
                              代替: {report.cover_user_name}
                            </p>
                          )}
                        </div>
                        <div>{statusBadge(report.status)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Admin: All Reports */}
              {isAdmin && (
                <div className="card p-0 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-700">全スタッフの欠勤連絡（管理者）</h3>
                  </div>
                  {allReports.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      欠勤連絡はありません
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {allReports.map(report => (
                        <div key={report.id} className="px-6 py-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                                style={{ backgroundColor: report.user_color || '#6B7280' }}
                              >
                                {(report.user_name || '?').charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {report.user_name} - {formatDate(report.date)}
                                </p>
                                {report.reason && (
                                  <p className="text-xs text-gray-500">{report.reason}</p>
                                )}
                                {report.cover_user_name && (
                                  <p className="text-xs text-blue-600">代替: {report.cover_user_name}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {statusBadge(report.status)}
                              {(report.status === 'pending' || report.status === 'covered') && (
                                <div className="flex gap-1 ml-2">
                                  <button
                                    onClick={() => handleUpdateStatus(report.id, 'approved')}
                                    className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100"
                                  >
                                    承認
                                  </button>
                                  <button
                                    onClick={() => handleUpdateStatus(report.id, 'rejected')}
                                    className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100"
                                  >
                                    却下
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ヘルプ募集 Tab */}
          {tab === 'help' && (
            <div className="space-y-4">
              <div className="card p-4 bg-blue-50 border-blue-200">
                <p className="text-sm text-blue-700">
                  他のスタッフが欠勤するシフトの一覧です。代わりに入れる場合は「代わりに入る」ボタンを押してください。
                </p>
              </div>

              {helpRequests.length === 0 ? (
                <div className="card p-0">
                  <div className="text-center py-16 text-gray-400">
                    <UserCheck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>現在ヘルプ募集はありません</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {helpRequests.map(report => (
                    <div key={report.id} className="card p-0 overflow-hidden">
                      <div className="p-5">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                              style={{ backgroundColor: report.user_color || '#6B7280' }}
                            >
                              {(report.user_name || '?').charAt(0)}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{report.user_name}</p>
                              <p className="text-sm text-gray-600 mt-0.5">
                                <Calendar className="w-3.5 h-3.5 inline mr-1" />
                                {formatDate(report.date)}
                                {report.start_time && report.end_time && (
                                  <span className="ml-2">
                                    {report.start_time.slice(0, 5)} - {report.end_time.slice(0, 5)}
                                  </span>
                                )}
                              </p>
                              {report.reason && (
                                <p className="text-xs text-gray-400 mt-1">理由: {report.reason}</p>
                              )}
                            </div>
                          </div>
                          {statusBadge(report.status)}
                        </div>

                        {report.cover_user_name ? (
                          <div className="mt-4 px-3 py-2 bg-green-50 rounded-lg">
                            <p className="text-sm text-green-700">
                              <UserCheck className="w-4 h-4 inline mr-1" />
                              {report.cover_user_name} さんが代替予定
                            </p>
                          </div>
                        ) : (
                          <div className="mt-4">
                            {report.user_id !== user?.id && (
                              <button
                                onClick={() => handleCover(report.id)}
                                className="btn-primary w-full flex items-center justify-center gap-2"
                              >
                                <UserCheck className="w-4 h-4" />
                                代わりに入る
                              </button>
                            )}
                          </div>
                        )}

                        {/* Admin actions on help tab */}
                        {isAdmin && report.status === 'covered' && (
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => handleUpdateStatus(report.id, 'approved')}
                              className="btn-primary flex-1 text-sm py-1.5"
                            >
                              承認する
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(report.id, 'rejected')}
                              className="btn-secondary flex-1 text-sm py-1.5"
                            >
                              却下する
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
