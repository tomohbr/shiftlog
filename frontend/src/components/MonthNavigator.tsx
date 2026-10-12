import { format, addMonths, subMonths } from 'date-fns'
import { ja } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface MonthNavigatorProps {
  currentDate: Date
  onPrev: () => void
  onNext: () => void
  onToday: () => void
}

export default function MonthNavigator({ currentDate, onPrev, onNext, onToday }: MonthNavigatorProps) {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <button
        onClick={onToday}
        className="px-2.5 sm:px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
      >
        今月
      </button>
      <button
        onClick={onPrev}
        className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={onNext}
        className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
      <h2 className="text-lg sm:text-xl font-bold text-gray-900 whitespace-nowrap">
        {format(currentDate, 'yyyy年M月', { locale: ja })}
      </h2>
    </div>
  )
}
