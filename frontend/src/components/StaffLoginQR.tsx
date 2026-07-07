import { QRCodeSVG } from 'qrcode.react'

// 会社PINはスタッフ全員共通のため、店舗に1枚貼っておけば全スタッフが使い回せる。
// ?pin= を踏むとログイン画面が会社PIN入力を自動スキップし、名前選択まで進む。
export function staffLoginUrl(companyPin: string): string {
  return `https://shiftlog-production.up.railway.app/login?pin=${companyPin}`
}

export default function StaffLoginQR({ companyPin, size = 132 }: { companyPin: string; size?: number }) {
  if (!companyPin) return null
  return (
    <div className="inline-flex flex-col items-center gap-2 bg-white border border-gray-200 rounded-xl p-3">
      <QRCodeSVG value={staffLoginUrl(companyPin)} size={size} />
      <p className="text-[11px] text-gray-500 text-center leading-snug">
        店舗に貼っておくと、スタッフはPIN入力なしで<br />スマホをかざすだけでログインできます
      </p>
    </div>
  )
}
