import { useEffect, useState } from 'react'
import { Tag, Plus, Trash2, Palette, Users } from 'lucide-react'
import { skillsApi, Skill } from '../api/client'
import toast from 'react-hot-toast'

const PRESET_COLORS = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280']

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await skillsApi.list()
      setSkills(r.data.skills)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      await skillsApi.create(newName.trim(), newColor)
      toast.success('スキルを追加しました')
      setNewName('')
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || '追加に失敗しました')
    } finally { setCreating(false) }
  }

  const remove = async (s: Skill) => {
    if (!confirm(`スキル「${s.name}」を削除しますか？付与済みスタッフからも解除されます。`)) return
    try {
      await skillsApi.remove(s.id)
      toast.success('削除しました')
      await load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || '削除に失敗しました')
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">スキル・役割タグ</h2>
        <p className="text-sm text-gray-500 mt-1">「閉店できる」「新人教育」など、スタッフの能力をタグで管理します</p>
      </div>

      <form onSubmit={create} className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4" /> 新しいスキルを追加
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">スキル名</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="閉店できる / レジ打ち / 新人教育 など"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={30}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
              <Palette className="w-3 h-3" /> 色
            </label>
            <div className="flex gap-1">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition ${newColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold px-4 py-2 rounded-lg text-sm"
          >
            {creating ? '追加中...' : '追加'}
          </button>
        </div>
      </form>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-800">
          登録済みスキル（{skills.length}）
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-500">読み込み中...</div>
        ) : skills.length === 0 ? (
          <div className="py-12 text-center">
            <Tag className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">まだスキルが登録されていません</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {skills.map(s => (
              <li key={s.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: s.color }}
                  >
                    <Tag className="w-3 h-3" />
                    {s.name}
                  </span>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {s.user_count || 0}名
                  </span>
                </div>
                <button
                  onClick={() => remove(s)}
                  className="text-red-500 hover:bg-red-50 p-1.5 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
