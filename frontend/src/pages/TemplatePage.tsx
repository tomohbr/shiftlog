import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, X, Play, Clock } from 'lucide-react'
import { templatesApi, usersApi, ShiftTemplate, User } from '../api/client'
import toast from 'react-hot-toast'

const COLORS = [
  '#E74C3C', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
  '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50',
  '#8BC34A', '#CDDC39', '#FFC107', '#FF9800', '#FF5722',
]

interface TemplateModalProps {
  template?: ShiftTemplate | null
  onClose: () => void
  onSave: () => void
}

function TemplateModal({ template, onClose, onSave }: TemplateModalProps) {
  const [name, setName] = useState(template?.name || '')
  const [startTime, setStartTime] = useState(template?.start_time || '09:00')
  const [endTime, setEndTime] = useState(template?.end_time || '17:00')
  const [breakMinutes, setBreakMinutes] = useState(template?.break_minutes ?? 60)
  const [color, setColor] = useState(template?.color || COLORS[5])
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('テンプレート名を入力してください')
      return
    }
    setLoading(true)
    try {
      const data = { name, start_time: startTime, end_time: endTime, break_minutes: breakMinutes, color }
      if (template) {
        await templatesApi.update(template.id, data)
        toast.success('テンプレートを更新しました')
      } else {
        await templatesApi.create(data)
        toast.success('テンプレートを作成しました')
      }
      onSave()
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">
            {template ? 'テンプレート編集' : 'テンプレート作成'}
          </h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">テンプレート名</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="input-field"
              placeholder="例: 早番、遅番、通し"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">開始時刻</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">終了時刻</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="input-field"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">休憩時間（分）</label>
            <input
              type="number"
              value={breakMinutes}
              onChange={e => setBreakMinutes(parseInt(e.target.value) || 0)}
              className="input-field"
              min={0}
              max={480}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">カラー</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-transform ${
                    color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? '保存中...' : template ? '更新' : '作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface ApplyModalProps {
  template: ShiftTemplate
  onClose: () => void
  onApplied: () => void
}

function ApplyModal({ template, onClose, onApplied }: ApplyModalProps) {
  const [users, setUsers] = useState<User[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])
  const [dates, setDates] = useState<string[]>([''])
  const [loading, setLoading] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(true)

  useEffect(() => {
    usersApi.getAll()
      .then(res => setUsers(res.data.users))
      .catch(() => toast.error('スタッフ一覧の取得に失敗しました'))
      .finally(() => setLoadingUsers(false))
  }, [])

  const toggleUser = (id: number) => {
    setSelectedUserIds(prev =>
      prev.includes(id) ? prev.filter(uid => uid !== id) : [...prev, id]
    )
  }

  const selectAllUsers = () => {
    if (selectedUserIds.length === users.length) {
      setSelectedUserIds([])
    } else {
      setSelectedUserIds(users.map(u => u.id))
    }
  }

  const addDateField = () => {
    setDates(prev => [...prev, ''])
  }

  const updateDate = (index: number, value: string) => {
    setDates(prev => prev.map((d, i) => i === index ? value : d))
  }

  const removeDate = (index: number) => {
    if (dates.length <= 1) return
    setDates(prev => prev.filter((_, i) => i !== index))
  }

  const handleApply = async () => {
    const validDates = dates.filter(d => d)
    if (selectedUserIds.length === 0) {
      toast.error('スタッフを選択してください')
      return
    }
    if (validDates.length === 0) {
      toast.error('日付を選択してください')
      return
    }
    setLoading(true)
    try {
      await templatesApi.apply(template.id, selectedUserIds, validDates)
      toast.success(`${selectedUserIds.length}名 x ${validDates.length}日にシフトを適用しました`)
      onApplied()
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.error || '適用に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold">テンプレート適用</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="inline-block w-3 h-3 rounded-full mr-1 align-middle" style={{ backgroundColor: template.color }} />
              {template.name}（{template.start_time.slice(0, 5)} - {template.end_time.slice(0, 5)}）
            </p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Staff Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">対象スタッフ</label>
              <button
                type="button"
                onClick={selectAllUsers}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                {selectedUserIds.length === users.length ? '全解除' : '全選択'}
              </button>
            </div>
            {loadingUsers ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
                {users.map(u => (
                  <label
                    key={u.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(u.id)}
                      onChange={() => toggleUser(u.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                      style={{ backgroundColor: u.color }}
                    >
                      {u.name.charAt(0)}
                    </div>
                    <span className="text-sm text-gray-900">{u.name}</span>
                  </label>
                ))}
              </div>
            )}
            {selectedUserIds.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">{selectedUserIds.length}名選択中</p>
            )}
          </div>

          {/* Date Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">適用日</label>
            <div className="space-y-2">
              {dates.map((d, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="date"
                    value={d}
                    onChange={e => updateDate(i, e.target.value)}
                    className="input-field flex-1"
                  />
                  {dates.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDate(i)}
                      className="p-2 text-gray-400 hover:text-red-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addDateField}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              日付を追加
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
            <button
              onClick={handleApply}
              disabled={loading}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              {loading ? '適用中...' : '適用する'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TemplatePage() {
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null)
  const [applyingTemplate, setApplyingTemplate] = useState<ShiftTemplate | null>(null)

  const loadTemplates = async () => {
    setLoading(true)
    try {
      const res = await templatesApi.getAll()
      setTemplates(res.data.templates)
    } catch {
      toast.error('テンプレートの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTemplates() }, [])

  const handleDelete = async (template: ShiftTemplate) => {
    if (!confirm(`「${template.name}」を削除してもよいですか？`)) return
    try {
      await templatesApi.delete(template.id)
      toast.success('テンプレートを削除しました')
      loadTemplates()
    } catch (err: any) {
      toast.error(err.response?.data?.error || '削除に失敗しました')
    }
  }

  const calcHours = (start: string, end: string, breakMin: number) => {
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    let totalMin = (eh * 60 + em) - (sh * 60 + sm)
    if (totalMin < 0) totalMin += 24 * 60
    const workMin = totalMin - breakMin
    return (workMin / 60).toFixed(1)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">シフトテンプレート</h2>
          <p className="text-sm text-gray-500 mt-0.5">よく使うシフトパターンを登録して一括適用できます</p>
        </div>
        <button
          onClick={() => { setEditingTemplate(null); setModalOpen(true) }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          テンプレート追加
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : templates.length === 0 ? (
        <div className="card p-0">
          <div className="text-center py-16 text-gray-400">
            <Clock className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>テンプレートが登録されていません</p>
            <p className="text-xs mt-1">「テンプレート追加」から作成してください</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map(tmpl => (
            <div key={tmpl.id} className="card p-0 overflow-hidden">
              {/* Color bar */}
              <div className="h-2" style={{ backgroundColor: tmpl.color }} />

              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tmpl.color }}
                    />
                    <h3 className="font-semibold text-gray-900">{tmpl.name}</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingTemplate(tmpl); setModalOpen(true) }}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(tmpl)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span>{tmpl.start_time.slice(0, 5)} - {tmpl.end_time.slice(0, 5)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      休憩 {tmpl.break_minutes}分 / 実働 {calcHours(tmpl.start_time, tmpl.end_time, tmpl.break_minutes)}h
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setApplyingTemplate(tmpl)}
                  className="mt-4 w-full btn-secondary flex items-center justify-center gap-2 text-sm"
                >
                  <Play className="w-4 h-4" />
                  テンプレート適用
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Template Create/Edit Modal */}
      {modalOpen && (
        <TemplateModal
          template={editingTemplate}
          onClose={() => { setModalOpen(false); setEditingTemplate(null) }}
          onSave={loadTemplates}
        />
      )}

      {/* Apply Modal */}
      {applyingTemplate && (
        <ApplyModal
          template={applyingTemplate}
          onClose={() => setApplyingTemplate(null)}
          onApplied={loadTemplates}
        />
      )}
    </div>
  )
}
