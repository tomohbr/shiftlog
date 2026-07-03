import { Link } from 'react-router-dom'
import { Calendar } from 'lucide-react'

// 特定商取引法に基づく表記
// 個人事業のため、住所・電話番号は請求開示方式（消費者庁ガイドラインに沿った運用）
export default function TokushohoPage() {
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: '販売事業者', value: '芝原 朋弥（個人事業主）' },
    { label: '運営責任者', value: '芝原 朋弥' },
    {
      label: '所在地',
      value: '請求があった場合、遅滞なく開示いたします。開示をご希望の方は下記メールアドレスまでご連絡ください。',
    },
    {
      label: '電話番号',
      value: '請求があった場合、遅滞なく開示いたします。お問い合わせは原則メールにて承ります。',
    },
    { label: 'メールアドレス', value: 'shibahara.724@gmail.com' },
    {
      label: '販売価格',
      value: (
        <div className="space-y-1">
          <p>Freeプラン: 無料（1店舗・スタッフ30名まで）</p>
          <p>Proプラン: 月額980円（税込）</p>
          <p>追加店舗: 1店舗あたり月額980円（税込）</p>
        </div>
      ),
    },
    { label: '商品代金以外の必要料金', value: 'インターネット接続にかかる通信費（お客様のご負担となります）' },
    { label: 'お支払い方法', value: 'クレジットカード決済（Stripe）' },
    { label: 'お支払い時期', value: '初回はお申し込み時、以降は毎月の契約更新日に自動課金されます。' },
    { label: 'サービス提供時期', value: '決済完了後、直ちにご利用いただけます。' },
    {
      label: '解約について',
      value: (
        <div className="space-y-1">
          <p>設定ページの「お支払い・解約の管理」からいつでも解約できます。解約後は現在の請求期間の終了日までご利用いただけます。</p>
          <p>解約後もアカウントと登録データは削除されず、Freeプランとして引き続きご利用いただけます。</p>
        </div>
      ),
    },
    {
      label: '返品・キャンセルについて',
      value: 'サービスの性質上、決済完了後の返金は原則としてお受けしておりません。サービスに不具合がある場合は、メールにてお問い合わせください。',
    },
    {
      label: '動作環境',
      value: 'インターネットに接続されたPC・スマートフォン・タブレットの最新のウェブブラウザ（Chrome / Safari / Edge 等）',
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">シフトログ</span>
          </Link>
          <Link to="/login" className="text-sm text-blue-600 hover:text-blue-700 font-medium">ログイン</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">特定商取引法に基づく表記</h1>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {rows.map(row => (
            <div key={row.label} className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4 px-5 py-4">
              <div className="text-sm font-semibold text-gray-700">{row.label}</div>
              <div className="sm:col-span-2 text-sm text-gray-600 leading-relaxed">{row.value}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-6">最終更新日: 2026年7月3日</p>
      </main>
    </div>
  )
}
