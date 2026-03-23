import { useBusinessDayToggle } from '../hooks/useBusinessDayToggle';
import { CalendarOff, CalendarDays } from 'lucide-react';

export default function BusinessDayToggle() {
  const { exclude, toggle } = useBusinessDayToggle();

  return (
    <button
      onClick={toggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
        exclude
          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
      }`}
      title={exclude ? '주말/휴일 제외 중 (클릭하여 전체 표시)' : '전체 날짜 표시 중 (클릭하여 주말/휴일 제외)'}
    >
      {exclude ? (
        <CalendarOff className="w-3.5 h-3.5" />
      ) : (
        <CalendarDays className="w-3.5 h-3.5" />
      )}
      {exclude ? '영업일만' : '전체 날짜'}
    </button>
  );
}
