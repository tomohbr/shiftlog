import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, X, Store, Crown, AlertTriangle } from 'lucide-react'
import { storesApi, Store as StoreType, PlanInfo } from '../api/client'
import toast from 'react-hot-toast'

interface StoreModalProps {
  store?: StoreType | null
  onClose: () => void
  onSave: () => void
}

function StoreModal({ store, onClose, onSave }: StoreModalProps) {
  const [name, setName] = useState(store?.name || '')
  const [address, setAddress] = useState(store?.address || '')
  const [phone, setPhone] = useState(store?.phone || '')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (store) {
        await storesApi.update(store.id, { name, address, phone })
        toast.success('店舗情報を更新しました')
      } else {
        await storesApi.create({ name, address, phone })
        toast.success('店舗を追加しました')
      }
      onSave()
      onClose()
    } catch (err: any) {
      if (err.response?.data?.code === 'STORE_LIMIT_REACHED') {
        toast.error('店舗数の上限に達しています')
      } else {
        toast.error(err.response?.data?.error || 'エラーが発生しました')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">{store ? '店舗編集' : '店舗追加'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">店舗名 <span className="text-red-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} className="input-field" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">住所</label>
            <input value={address} onChange={e => setAddress(e.target.value)} className="input-field" placeholder="任意" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className="input-field" placeholder="任意" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">キャンセル</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? '保存中...' : store ? '更新' : '追加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface UpgradeModalProps {
  planInfo: PlanInfo
  onClose: () => void
}

function UpgradeModal({ planInfo, onClose }: UpgradeModalProps) {
  const [copied, setCopied] = useState(false)

  const handleCopyEmail = () => {
    navigator.clipboard.writeText('shibahara.724@gmail.com')
    setCopied(true)
    toast.success('メールアドレスをコピーしました')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-yellow-500" />
            <h2 className="text-lg font-semibold">プランアップグレード</h2>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-sm text-blue-800 font-medium mb-2">現在のプラン: 無料（1店舗）</p>
            <p className="text-sm text-blue-600">
              {planInfo.current_stores}店舗登録中 / 最大{planInfo.max_stores}店舗
            </p>
          </div>

          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg p-4 border border-yellow-200">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4 text-yellow-600" />
              <p className="text-sm font-bold text-gray-900">追加店舗プラン</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">¥980<span className="text-sm font-normal text-gray-500">/月/店舗</span></p>
            <ul className="mt-3 space-y-1 text-sm text-gray-600">
              <li>・ 店舗を追加するごとに月額980円</li>
              <li>・ 全機能利用可能</li>
              <li>・ いつでもキャンセル可能</li>
            </ul>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm font-medium text-gray-800 mb-2">お申し込み方法</p>
            <p className="text-sm text-gray-600 mb-3">
              以下のメールアドレスまで、会社名と追加店舗数をご連絡ください。お振込先をご案内いたします。
            </p>
            <button
              onClick={handleCopyEmail}
              className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-lg py-2.5 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              {copied ? 'コピーしました!' : 'shibahara.724@gmail.com'}
            </button>
          </div>

          <div className="pt-2">
            <button type="button" onClick={onClose} className="btn-secondary w-full">閉じる</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StorePage() {
  const [stores, setStores] = useState<StoreType[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingStore, setEditingStore] = useState<StoreType | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [planInfo, setPlanInfo] = useState<PlanInfo>({ name: 'free', max_stores: 1, current_stores: 0 })

  const loadStores = async () => {
    setLoading(true)
    try {
      const res = await storesApi.getAll()
      setStores(res.data.stores)
      if (res.data.plan) {
        setPlanInfo(res.data.plan)
      }
    } catch {
      toast.error('店舗一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStores()
    // Check for checkout result
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') === 'success') {
      toast.success('プランのアップグレードが完了しました！')
      window.history.replaceState({}, '', '/stores')
    } else if (params.get('checkout') === 'cancel') {
      toast('決済がキャンセルされました', { icon: '⚠️' })
      window.history.replaceState({}, '', '/stores')
    }
  }, [])

  const handleAddStore = () => {
    if (planInfo.current_stores >= planInfo.max_stores) {
      setUpgradeOpen(true)
    } else {
      setEditingStore(null)
      setModalOpen(true)
    }
  }

  const handleDelete = async (store: StoreType) => {
    if (!confirm(`「${store.name}」を削除してもよいですか？`)) return
    try {
      await storesApi.delete(store.id)
      toast.success('店舗を削除しました')
      loadStores()
    } catch (err: any) {
      toast.error(err.response?.data?.error || '削除に失敗しました')
    }
  }

  const atLimit = planInfo.current_stores >= planInfo.max_stores

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">店舗管理</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {stores.length}店舗登録中
            {planInfo.name === 'free' && (
              <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                無料プラン（最大{planInfo.max_stores}店舗）
              </span>
            )}
            {planInfo.name === 'pro' && (
              <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                プロプラン（最大{planInfo.max_stores}店舗）
              </span>
            )}
          </p>
        </div>
        <button
          onClick={handleAddStore}
          className={`flex items-center gap-2 ${atLimit ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white py-2.5 px-4 rounded-lg font-medium hover:from-yellow-600 hover:to-orange-600' : 'btn-primary'}`}
        >
          {atLimit ? (
            <>
              <Crown className="w-4 h-4" />
              アップグレード
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              店舗追加
            </>
          )}
        </button>
      </div>

      {atLimit && planInfo.name === 'free' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-800">無料プランの上限に達しています</p>
            <p className="text-sm text-yellow-600 mt-1">
              2店舗目以降は月額980円/店舗でご利用いただけます。
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stores.map(store => (
            <div key={store.id} className="card">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Store className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setEditingStore(store); setModalOpen(true) }}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(store)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">{store.name}</h3>
              {store.address && (
                <p className="text-sm text-gray-500 mb-1">{store.address}</p>
              )}
              {store.phone && (
                <p className="text-sm text-gray-500">{store.phone}</p>
              )}
              <p className="text-xs text-gray-400 mt-3">
                登録日: {new Date(store.created_at).toLocaleDateString('ja-JP')}
              </p>
            </div>
          ))}
        </div>
      )}

      {stores.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400">
          <Store className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>店舗が登録されていません</p>
        </div>
      )}

      {modalOpen && (
        <StoreModal
          store={editingStore}
          onClose={() => { setModalOpen(false); setEditingStore(null) }}
          onSave={loadStores}
        />
      )}

      {upgradeOpen && (
        <UpgradeModal
          planInfo={planInfo}
          onClose={() => setUpgradeOpen(false)}
        />
      )}
    </div>
  )
}
