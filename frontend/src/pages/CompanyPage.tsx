import { useState, useEffect } from 'react'
import { companiesApi, Company } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { Building2, Plus, Edit2, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'

export default function CompanyPage() {
  const { selectCompany, selectedCompany } = useAuth()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [form, setForm] = useState({ name: '', company_pin: '', address: '', phone: '' })

  const fetchCompanies = async () => {
    try {
      const res = await companiesApi.getAll()
      setCompanies(res.data.companies)
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCompanies() }, [])

  const openCreate = () => {
    setEditingCompany(null)
    setForm({ name: '', company_pin: '', address: '', phone: '' })
    setShowModal(true)
  }

  const openEdit = (c: Company) => {
    setEditingCompany(c)
    setForm({ name: c.name, company_pin: c.company_pin || '', address: c.address || '', phone: c.phone || '' })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('会社名を入力してください')
      return
    }
    try {
      if (editingCompany) {
        await companiesApi.update(editingCompany.id, form)
        toast.success('会社情報を更新しました')
      } else {
        await companiesApi.create(form)
        toast.success('会社を追加しました')
      }
      setShowModal(false)
      fetchCompanies()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラーが発生しました')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('この会社とすべてのデータを削除しますか？')) return
    try {
      await companiesApi.delete(id)
      toast.success('会社を削除しました')
      fetchCompanies()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'エラーが発生しました')
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">会社管理</h2>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          会社を追加
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {companies.map(c => (
          <div
            key={c.id}
            className={`bg-white rounded-xl border-2 p-5 cursor-pointer transition-all hover:shadow-md ${
              selectedCompany?.id === c.id ? 'border-blue-500 shadow-md' : 'border-gray-200'
            }`}
            onClick={() => selectCompany(c)}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(c) }}
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{c.name}</h3>
            {c.company_pin && <p className="text-sm text-gray-500 mb-1">PIN: <span className="font-mono font-medium">{c.company_pin}</span></p>}
            {c.address && <p className="text-sm text-gray-500 mb-1">{c.address}</p>}
            {c.phone && <p className="text-sm text-gray-500">{c.phone}</p>}
            {selectedCompany?.id === c.id && (
              <span className="inline-block mt-3 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                選択中
              </span>
            )}
          </div>
        ))}
      </div>

      {companies.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Building2 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p>会社が登録されていません</p>
          <p className="text-sm mt-1">「会社を追加」ボタンから最初の会社を追加してください</p>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{editingCompany ? '会社を編集' : '会社を追加'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">会社名 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="株式会社サンプル"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">会社PIN（スタッフログイン用）</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.company_pin}
                  onChange={e => setForm({ ...form, company_pin: e.target.value.replace(/\D/g, '') })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-lg tracking-widest"
                  placeholder="4桁の数字"
                  maxLength={8}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">住所</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {editingCompany ? '更新' : '追加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
