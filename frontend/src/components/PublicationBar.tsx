import { useState } from 'react'
import { Eye, EyeOff, Send } from 'lucide-react'
import { shiftsApi } from '../api/client'
import toast from 'react-hot-toast'
import { track } from '../lib/analytics'

// 「この月のシフトがスタッフに見えているか」を、シフトを作っている画面のすぐ上に出す。
//
// 公開ボタンはダッシュボードの月送りの横にしか無く、シフト管理で組み終えた人がそのまま帰っていた。
// スタッフ側は公開されるまで何も表示されないので、管理者は「入れたのに誰も見ない」、
// スタッフは「開いても空」で、両方が離れる（25社中8社がシフト作成後・未公開で停止）。
// ここでは状態を言葉で言い切り、公開はその場の1タップで済ませる。

interface Props {
  year: number
  month: number
  shiftCount: number
  isPublished: boolean
  onChange: (published: boolean) => void
  /** 公開後にスタッフへ届く手段の説明（LINE 連携の有無で変える） */
  compact?: boolean
}

export default function PublicationBar({ year, month, shiftCount, isPublished, onChange, compact }: Props) {
  const [busy, setBusy] = useState(false)

  const toggle = async (next: boolean) => {
    if (busy) return
    if (!next && !confirm(`${month}月のシフトを非公開に戻します。スタッフの画面からは消えます。よろしいですか？`)) return
    setBusy(true)
    try {
      await shiftsApi.setPublication(year, month, next)
      onChange(next)
      track(next ? 'shift_publish' : 'shift_unpublish', { month: `${year}-${String(month).padStart(2, '0')}`, shifts: shiftCount })
      toast.success(next ? `${month}月のシフトをスタッフに公開しました。LINE・プッシュで知らせます` : `${month}月のシフトを非公開にしました`)
    } catch {
      toast.error('操作に失敗しました。もう一度お試しください')
    } finally {
      setBusy(false)
    }
  }

  // シフトがまだ無い月は、公開の話をしても意味がない
  if (shiftCount === 0 && !isPublished) return null

  if (isPublished) {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-green-200 bg-green-50 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <Eye className="w-4 h-4 text-green-700 shrink-0" />
        <p className="text-sm text-green-900 flex-1 min-w-[180px]">
          <b>{month}月のシフトは公開中。</b>スタッフの画面に表示されています。
        </p>
        <button
          type="button"
          onClick={() => toggle(false)}
          disabled={busy}
          className="text-xs text-green-800 underline underline-offset-2 hover:text-green-900 disabled:opacity-50"
        >
          非公開に戻す
        </button>
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
      <EyeOff className="w-5 h-5 text-amber-700 shrink-0" />
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-bold text-amber-900">{month}月のシフト{shiftCount}件は、まだスタッフに見えていません</p>
        <p className="text-xs text-amber-800 mt-0.5">下書きの状態です。公開すると、スタッフの「シフト」画面に出て、LINE・プッシュで知らせます。</p>
      </div>
      <button
        type="button"
        onClick={() => toggle(true)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold whitespace-nowrap shadow-sm disabled:opacity-60"
      >
        <Send className="w-4 h-4" />
        {busy ? '公開中...' : 'スタッフに公開する'}
      </button>
    </div>
  )
}
