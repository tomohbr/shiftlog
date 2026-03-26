import { useMemo } from 'react'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
  parseISO,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import { Shift } from '../api/client'

interface ShiftCalendarProps {
  currentDate: Date
  shifts: Shift[]
  onDayClick?: (date: Date) => void
  onShiftClick?: (shift: Shift) => void
  isAdmin?: boolean
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export default function ShiftCalendar({
  currentDate,
  shifts,
  onDayClick,
  onShiftClick,
  isAdmin = false,
}: ShiftCalendarProps) {
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    return eachDayOfInterval({ start: calStart, end: calEnd })
  }, [currentDate])

  const shiftsByDate = useMemo(() => {
    const map: Record<string, Shift[]> = {}
    for (const shift of shifts) {
      if (!map[shift.date]) map[shift.date] = []
      map[shift.date].push(shift)
    }
    return map
  }, [shifts])

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {DAY_LABELS.map((day, i) => (
          <div
            key={day}
            className={`py-3 text-center text-xs font-semibold ${
              i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-600'
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {calendarDays.map((day, idx) => {
          const dateStr = format(day, 'yyyy-MM-dd')
          const dayShifts = shiftsByDate[dateStr] || []
          const isCurrentMonth = isSameMonth(day, currentDate)
          const isCurrentDay = isToday(day)
          const dayOfWeek = day.getDay()
          const isSunday = dayOfWeek === 0
          const isSaturday = dayOfWeek === 6

          return (
            <div
              key={idx}
              onClick={() => isAdmin && onDayClick?.(day)}
              className={`calendar-cell border-b border-r border-gray-100 p-1.5 transition-colors ${
                !isCurrentMonth ? 'bg-gray-50' : ''
              } ${isAdmin ? 'cursor-pointer hover:bg-blue-50' : ''}`}
              style={{ minHeight: '100px' }}
            >
              {/* Date number */}
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                    isCurrentDay
                      ? 'bg-blue-600 text-white'
                      : !isCurrentMonth
                      ? 'text-gray-300'
                      : isSunday
                      ? 'text-red-500'
                      : isSaturday
                      ? 'text-blue-500'
                      : 'text-gray-700'
                  }`}
                >
                  {format(day, 'd')}
                </span>
                {isAdmin && isCurrentMonth && (
                  <span className="text-gray-300 text-xs opacity-0 group-hover:opacity-100">+</span>
                )}
              </div>

              {/* Shift blocks */}
              <div className="space-y-0.5">
                {dayShifts.slice(0, 4).map(shift => (
                  <div
                    key={shift.id}
                    onClick={e => {
                      e.stopPropagation()
                      onShiftClick?.(shift)
                    }}
                    className="shift-block text-white cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ backgroundColor: shift.user_color || '#4A90E2' }}
                    title={`${shift.user_name}: ${shift.start_time}~${shift.end_time}`}
                  >
                    <span className="font-medium">{shift.user_name.split(' ')[0]}</span>
                    <span className="ml-1 opacity-90">
                      {shift.start_time.slice(0, 5)}-{shift.end_time.slice(0, 5)}
                    </span>
                  </div>
                ))}
                {dayShifts.length > 4 && (
                  <div className="text-xs text-gray-400 pl-1">
                    +{dayShifts.length - 4}件
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
