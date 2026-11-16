import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { shiftsApi, FinalDay } from '../api/client'

// 短期のバイトの最終出勤日が近づいたら（3日前から当日まで）、給料の準備を知らせる。
// 時給を見られる人だけに出る（API が他の人には空で返す）
const WD = ['日', '月', '火', '水', '木', '金', '土']

function label(d: FinalDay) {
  const [y, m, day] = d.date.split('-').map(Number)
  const wd = WD[new Date(y, m - 1, day).getDay()]
  const when = d.days_left === 0 ? '今日' : d.days_left === 1 ? '明日' : `${d.days_left}日後`
  return { date: `${m}/${day}（${wd}）`, when }
}

export default function FinalDayBanner({ companyId }: { companyId?: number }) {
  const [days, setDays] = useState<FinalDay[]>([])
  useEffect(() => {
    if (!companyId) return
    shiftsApi.finalDays(3).then(r => setDays(r.data.days || [])).catch(() => setDays([]))
  }, [companyId])
  if (!days.length) return null
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
          <Wallet className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900">最終日のお給料の準備</p>
          <div className="mt-2 space-y-2">
            {days.map(d => {
              const l = label(d)
              return (
                <div key={d.date} className="text-sm">
                  <p className="font-semibold text-amber-800">
                    {l.date} <span className="ml-1 text-xs font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">{l.when}</span>
                  </p>
                  <ul className="mt-1 space-y-0.5 text-gray-800">
                    {d.people.map(p => (
                      <li key={p.user_id} className="flex flex-wrap gap-x-2">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-gray-600">
                          {p.shifts.map(s => `${s.store_name ? s.store_name + ' ' : ''}${s.start_time}〜${s.end_time}`).join(' / ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
