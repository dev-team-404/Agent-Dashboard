import { useBusinessDayToggle } from '../hooks/useBusinessDayToggle';
import { useTranslation } from 'react-i18next';
import { CalendarOff, CalendarDays } from 'lucide-react';

export default function BusinessDayToggle() {
  const { t } = useTranslation();
  const { exclude, toggle } = useBusinessDayToggle();

  return (
    <button
      onClick={toggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
        exclude
          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
      }`}
      title={exclude ? t('components.businessDayToggle.excludeTitle') : t('components.businessDayToggle.includeTitle')}
    >
      {exclude ? (
        <CalendarOff className="w-3.5 h-3.5" />
      ) : (
        <CalendarDays className="w-3.5 h-3.5" />
      )}
      {exclude ? t('components.businessDayToggle.businessDaysOnly') : t('components.businessDayToggle.allDays')}
    </button>
  );
}
