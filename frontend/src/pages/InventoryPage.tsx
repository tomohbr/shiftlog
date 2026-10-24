import { useMemo } from 'react'
import { invApi } from '../api/client'
import InventoryApp from '../components/inventory/InventoryApp'

// 管理画面の「催事の在庫」。LINE の画面と同じ中身に、設定（品目・メニュー・予想の土台）が加わる。
export default function InventoryPage() {
  const api = useMemo(() => invApi(), [])
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">催事の在庫</h1>
        <p className="text-sm text-gray-600">閉店の締め（残りの数え・レジ締め）、積み込みリスト、会社の在庫。スタッフはLINEのトークで「在庫」と送ると同じ画面が開きます。</p>
      </div>
      <InventoryApp api={api} inLine={false} />
    </div>
  )
}
