import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Calendar, Sun, Building2, Tag, X, Upload, CalendarDays, AlertCircle } from 'lucide-react';
import { holidaysApi, Holiday, CreateHolidayData } from '../services/api';

// 한국 공휴일 프리셋 (2024-2027)
const KOREAN_HOLIDAYS_PRESET: Record<number, CreateHolidayData[]> = {
  2024: [
    { date: '2024-01-01', name: '신정', type: 'NATIONAL' },
    { date: '2024-02-09', name: '설날 연휴', type: 'NATIONAL' },
    { date: '2024-02-10', name: '설날', type: 'NATIONAL' },
    { date: '2024-02-11', name: '설날 연휴', type: 'NATIONAL' },
    { date: '2024-02-12', name: '대체공휴일(설날)', type: 'NATIONAL' },
    { date: '2024-03-01', name: '삼일절', type: 'NATIONAL' },
    { date: '2024-04-10', name: '국회의원선거일', type: 'NATIONAL' },
    { date: '2024-05-05', name: '어린이날', type: 'NATIONAL' },
    { date: '2024-05-06', name: '대체공휴일(어린이날)', type: 'NATIONAL' },
    { date: '2024-05-15', name: '부처님오신날', type: 'NATIONAL' },
    { date: '2024-06-06', name: '현충일', type: 'NATIONAL' },
    { date: '2024-08-15', name: '광복절', type: 'NATIONAL' },
    { date: '2024-09-16', name: '추석 연휴', type: 'NATIONAL' },
    { date: '2024-09-17', name: '추석', type: 'NATIONAL' },
    { date: '2024-09-18', name: '추석 연휴', type: 'NATIONAL' },
    { date: '2024-10-03', name: '개천절', type: 'NATIONAL' },
    { date: '2024-10-09', name: '한글날', type: 'NATIONAL' },
    { date: '2024-12-25', name: '크리스마스', type: 'NATIONAL' },
  ],
  2025: [
    { date: '2025-01-01', name: '신정', type: 'NATIONAL' },
    { date: '2025-01-28', name: '설날 연휴', type: 'NATIONAL' },
    { date: '2025-01-29', name: '설날', type: 'NATIONAL' },
    { date: '2025-01-30', name: '설날 연휴', type: 'NATIONAL' },
    { date: '2025-03-01', name: '삼일절', type: 'NATIONAL' },
    { date: '2025-05-05', name: '부처님오신날/어린이날', type: 'NATIONAL' },
    { date: '2025-05-06', name: '대체공휴일', type: 'NATIONAL' },
    { date: '2025-06-06', name: '현충일', type: 'NATIONAL' },
    { date: '2025-08-15', name: '광복절', type: 'NATIONAL' },
    { date: '2025-10-03', name: '개천절', type: 'NATIONAL' },
    { date: '2025-10-05', name: '추석 연휴', type: 'NATIONAL' },
    { date: '2025-10-06', name: '추석', type: 'NATIONAL' },
    { date: '2025-10-07', name: '추석 연휴', type: 'NATIONAL' },
    { date: '2025-10-08', name: '대체공휴일(추석)', type: 'NATIONAL' },
    { date: '2025-10-09', name: '한글날', type: 'NATIONAL' },
    { date: '2025-12-25', name: '크리스마스', type: 'NATIONAL' },
  ],
  2026: [
    { date: '2026-01-01', name: '신정', type: 'NATIONAL' },
    { date: '2026-02-16', name: '설날 연휴', type: 'NATIONAL' },
    { date: '2026-02-17', name: '설날', type: 'NATIONAL' },
    { date: '2026-02-18', name: '설날 연휴', type: 'NATIONAL' },
    { date: '2026-03-01', name: '삼일절', type: 'NATIONAL' },
    { date: '2026-03-02', name: '대체공휴일(삼일절)', type: 'NATIONAL' },
    { date: '2026-05-05', name: '어린이날', type: 'NATIONAL' },
    { date: '2026-05-24', name: '부처님오신날', type: 'NATIONAL' },
    { date: '2026-05-25', name: '대체공휴일(부처님오신날)', type: 'NATIONAL' },
    { date: '2026-06-06', name: '현충일', type: 'NATIONAL' },
    { date: '2026-08-15', name: '광복절', type: 'NATIONAL' },
    { date: '2026-08-17', name: '대체공휴일(광복절)', type: 'NATIONAL' },
    { date: '2026-09-24', name: '추석 연휴', type: 'NATIONAL' },
    { date: '2026-09-25', name: '추석', type: 'NATIONAL' },
    { date: '2026-09-26', name: '추석 연휴', type: 'NATIONAL' },
    { date: '2026-10-03', name: '개천절', type: 'NATIONAL' },
    { date: '2026-10-05', name: '대체공휴일(개천절)', type: 'NATIONAL' },
    { date: '2026-10-09', name: '한글날', type: 'NATIONAL' },
    { date: '2026-12-25', name: '크리스마스', type: 'NATIONAL' },
  ],
  2027: [
    { date: '2027-01-01', name: '신정', type: 'NATIONAL' },
    { date: '2027-02-06', name: '설날 연휴', type: 'NATIONAL' },
    { date: '2027-02-07', name: '설날', type: 'NATIONAL' },
    { date: '2027-02-08', name: '설날 연휴', type: 'NATIONAL' },
    { date: '2027-02-09', name: '대체공휴일(설날)', type: 'NATIONAL' },
    { date: '2027-03-01', name: '삼일절', type: 'NATIONAL' },
    { date: '2027-05-05', name: '어린이날', type: 'NATIONAL' },
    { date: '2027-05-13', name: '부처님오신날', type: 'NATIONAL' },
    { date: '2027-06-06', name: '현충일', type: 'NATIONAL' },
    { date: '2027-06-07', name: '대체공휴일(현충일)', type: 'NATIONAL' },
    { date: '2027-08-15', name: '광복절', type: 'NATIONAL' },
    { date: '2027-08-16', name: '대체공휴일(광복절)', type: 'NATIONAL' },
    { date: '2027-09-14', name: '추석 연휴', type: 'NATIONAL' },
    { date: '2027-09-15', name: '추석', type: 'NATIONAL' },
    { date: '2027-09-16', name: '추석 연휴', type: 'NATIONAL' },
    { date: '2027-10-03', name: '개천절', type: 'NATIONAL' },
    { date: '2027-10-04', name: '대체공휴일(개천절)', type: 'NATIONAL' },
    { date: '2027-10-09', name: '한글날', type: 'NATIONAL' },
    { date: '2027-10-11', name: '대체공휴일(한글날)', type: 'NATIONAL' },
    { date: '2027-12-25', name: '크리스마스', type: 'NATIONAL' },
  ],
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

type HolidayType = 'NATIONAL' | 'COMPANY' | 'CUSTOM';

const TYPE_LABELS: Record<HolidayType, string> = {
  NATIONAL: '공휴일',
  COMPANY: '회사 휴일',
  CUSTOM: '사용자 정의',
};

const TYPE_COLORS: Record<HolidayType, { bg: string; text: string; border: string }> = {
  NATIONAL: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' },
  COMPANY: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  CUSTOM: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
};

const TYPE_ICONS: Record<HolidayType, React.ReactNode> = {
  NATIONAL: <Sun className="w-3 h-3" />,
  COMPANY: <Building2 className="w-3 h-3" />,
  CUSTOM: <Tag className="w-3 h-3" />,
};

// Helper function to format date as YYYY-MM-DD in local timezone
const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function Holidays() {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [newHoliday, setNewHoliday] = useState<CreateHolidayData>({ date: '', name: '', type: 'NATIONAL' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHolidays();
  }, [currentYear]);

  const loadHolidays = async () => {
    try {
      setLoading(true);
      const res = await holidaysApi.getByYear(currentYear);
      setHolidays(res.data.holidays);
    } catch (err) {
      console.error('Failed to load holidays:', err);
      setError('휴일 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // Create a map of date string to holidays
  const holidayMap = useMemo(() => {
    const map = new Map<string, Holiday[]>();
    holidays.forEach(h => {
      const dateStr = h.date.split('T')[0];
      if (!map.has(dateStr)) {
        map.set(dateStr, []);
      }
      map.get(dateStr)!.push(h);
    });
    return map;
  }, [holidays]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startPadding = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const days: Array<{ date: Date | null; dateStr: string; isCurrentMonth: boolean }> = [];

    // Previous month padding
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = startPadding - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1, prevMonthLastDay - i);
      days.push({
        date: d,
        dateStr: formatLocalDate(d),
        isCurrentMonth: false,
      });
    }

    // Current month
    for (let i = 1; i <= totalDays; i++) {
      const d = new Date(currentYear, currentMonth, i);
      days.push({
        date: d,
        dateStr: formatLocalDate(d),
        isCurrentMonth: true,
      });
    }

    // Next month padding
    const endPadding = 42 - days.length; // 6 rows * 7 days
    for (let i = 1; i <= endPadding; i++) {
      const d = new Date(currentYear, currentMonth + 1, i);
      days.push({
        date: d,
        dateStr: formatLocalDate(d),
        isCurrentMonth: false,
      });
    }

    return days;
  }, [currentYear, currentMonth]);

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const handleDateClick = (dateStr: string) => {
    setNewHoliday({ date: dateStr, name: '', type: 'NATIONAL' });
    setShowAddModal(true);
  };

  const handleAddHoliday = async () => {
    if (!newHoliday.date || !newHoliday.name.trim()) {
      setError('날짜와 이름을 입력해주세요.');
      return;
    }

    try {
      await holidaysApi.create(newHoliday);
      setShowAddModal(false);
      setNewHoliday({ date: '', name: '', type: 'NATIONAL' });
      loadHolidays();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || '휴일 추가에 실패했습니다.');
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!confirm('이 휴일을 삭제하시겠습니까?')) return;

    try {
      await holidaysApi.delete(id);
      loadHolidays();
    } catch (err) {
      console.error('Failed to delete holiday:', err);
      setError('휴일 삭제에 실패했습니다.');
    }
  };

  const handleBulkImport = async (year: number) => {
    const preset = KOREAN_HOLIDAYS_PRESET[year];
    if (!preset) {
      setError(`${year}년 프리셋이 없습니다.`);
      return;
    }

    try {
      const res = await holidaysApi.bulkCreate(preset);
      setShowBulkModal(false);
      loadHolidays();
      alert(`${res.data.created.length}개 휴일이 추가되었습니다. (${res.data.skipped.length}개 건너뜀)`);
    } catch (err) {
      console.error('Failed to bulk import:', err);
      setError('일괄 추가에 실패했습니다.');
    }
  };

  const isToday = (dateStr: string) => {
    return dateStr === formatLocalDate(today);
  };

  const isWeekend = (date: Date | null) => {
    if (!date) return false;
    const day = date.getDay();
    return day === 0 || day === 6;
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
            <CalendarDays className="w-6 h-6 text-gray-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">휴일 관리</h1>
            <p className="text-pastel-500 text-sm mt-0.5">주말 및 휴일을 관리하여 일 평균 활성 사용자 통계에 반영합니다.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200/80 text-pastel-700 rounded-lg hover:border-gray-300 transition-all duration-200 font-medium text-sm"
          >
            <Upload className="w-4 h-4" />
            프리셋 가져오기
          </button>
          <button
            onClick={() => {
              setNewHoliday({ date: '', name: '', type: 'NATIONAL' });
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            휴일 추가
          </button>
        </div>
      </div>

      {/* Error notification */}
      {error && (
        <div className="flex items-center justify-between px-5 py-4 bg-rose-50 border border-rose-200 rounded-lg animate-slide-down">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-rose-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4 text-rose-500" />
            </div>
            <span className="text-sm font-medium text-rose-700">{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Calendar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        {/* Calendar Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100/80">
          <button
            onClick={handlePrevMonth}
            className="p-2.5 hover:bg-pastel-50 rounded-xl transition-all duration-200 active:scale-95"
            title="이전 달"
          >
            <ChevronLeft className="w-5 h-5 text-pastel-500" />
          </button>
          <div className="flex items-center gap-3">
            {/* Year Dropdown */}
            <select
              value={currentYear}
              onChange={(e) => setCurrentYear(parseInt(e.target.value))}
              className="px-4 py-2.5 text-lg font-semibold text-pastel-800 bg-pastel-50/80 border border-pastel-200/60 rounded-xl cursor-pointer hover:bg-pastel-100 hover:border-pastel-300 focus:outline-none focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue transition-all duration-200 appearance-none"
            >
              {Array.from({ length: 10 }, (_, i) => today.getFullYear() - 3 + i).map((year) => (
                <option key={year} value={year}>{year}년</option>
              ))}
            </select>
            {/* Month Dropdown */}
            <select
              value={currentMonth}
              onChange={(e) => setCurrentMonth(parseInt(e.target.value))}
              className="px-4 py-2.5 text-lg font-semibold text-pastel-800 bg-pastel-50/80 border border-pastel-200/60 rounded-xl cursor-pointer hover:bg-pastel-100 hover:border-pastel-300 focus:outline-none focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue transition-all duration-200 appearance-none"
            >
              {MONTHS.map((month, idx) => (
                <option key={idx} value={idx}>{month}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNextMonth}
              className="p-2.5 hover:bg-pastel-50 rounded-xl transition-all duration-200 active:scale-95"
              title="다음 달"
            >
              <ChevronRight className="w-5 h-5 text-pastel-500" />
            </button>
            <button
              onClick={() => {
                setCurrentYear(today.getFullYear());
                setCurrentMonth(today.getMonth());
              }}
              className="px-4 py-2.5 text-sm font-semibold text-samsung-blue bg-samsung-blue/[0.06] border border-samsung-blue/20 rounded-xl hover:bg-samsung-blue/[0.1] hover:border-samsung-blue/30 transition-all duration-200"
            >
              오늘
            </button>
          </div>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-gray-100/80 bg-pastel-50/40">
          {WEEKDAYS.map((day, idx) => (
            <div
              key={day}
              className={`py-3 text-center text-xs font-semibold uppercase tracking-wider ${
                idx === 0 ? 'text-red-500' : idx === 6 ? 'text-blue-500' : 'text-pastel-400'
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        {loading ? (
          <div className="h-96 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map(({ date, dateStr, isCurrentMonth }, idx) => {
              const dayHolidays = holidayMap.get(dateStr) || [];
              const weekend = isWeekend(date);
              const todayClass = isToday(dateStr);
              const dayOfWeek = date?.getDay();

              return (
                <div
                  key={idx}
                  onClick={() => isCurrentMonth && handleDateClick(dateStr)}
                  className={`min-h-[100px] p-2 border-b border-r border-gray-100/60 cursor-pointer transition-all duration-150 ${
                    isCurrentMonth ? 'bg-white hover:bg-samsung-blue/[0.02]' : 'bg-pastel-50/30'
                  } ${idx % 7 === 6 ? 'border-r-0' : ''} ${todayClass ? 'ring-1 ring-inset ring-samsung-blue/20 bg-samsung-blue/[0.015]' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                        todayClass
                          ? 'bg-gray-900 text-white shadow-sm'
                          : !isCurrentMonth
                          ? 'text-pastel-300'
                          : dayOfWeek === 0 || dayHolidays.some(h => h.type === 'NATIONAL')
                          ? 'text-red-500'
                          : dayOfWeek === 6
                          ? 'text-blue-500'
                          : 'text-pastel-700'
                      }`}
                    >
                      {date?.getDate()}
                    </span>
                    <div className="flex items-center gap-1">
                      {todayClass && (
                        <span className="text-[10px] text-samsung-blue font-semibold tracking-wide">오늘</span>
                      )}
                      {weekend && isCurrentMonth && (
                        <span className="text-[10px] text-pastel-300 font-medium">주말</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {dayHolidays.slice(0, 3).map((h) => (
                      <div
                        key={h.id}
                        className={`group flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
                          TYPE_COLORS[h.type].bg
                        } ${TYPE_COLORS[h.type].text} transition-all duration-150`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {TYPE_ICONS[h.type]}
                        <span className="truncate flex-1">{h.name}</span>
                        <button
                          onClick={() => handleDeleteHoliday(h.id)}
                          className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-all duration-150 -mr-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {dayHolidays.length > 3 && (
                      <div className="text-[11px] text-pastel-400 pl-2 font-medium">
                        +{dayHolidays.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white border border-gray-100/80 rounded-lg text-sm text-pastel-600">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <span className="font-medium">공휴일</span>
        </div>
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white border border-gray-100/80 rounded-lg text-sm text-pastel-600">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
          <span className="font-medium">회사 휴일</span>
        </div>
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white border border-gray-100/80 rounded-lg text-sm text-pastel-600">
          <div className="w-2.5 h-2.5 rounded-full bg-purple-400" />
          <span className="font-medium">사용자 정의</span>
        </div>
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white border border-gray-100/80 rounded-lg text-sm text-pastel-400 ml-1">
          <span className="text-red-500 font-semibold">일</span>
          <span className="text-blue-500 font-semibold">토</span>
          <span>= 주말 (자동 제외)</span>
        </div>
      </div>

      {/* Holiday List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-100 rounded-xl flex items-center justify-center">
                <Calendar className="w-4 h-4 text-samsung-blue" />
              </div>
              <h3 className="font-semibold text-pastel-800 text-base">{currentYear}년 휴일 목록</h3>
            </div>
            <span className="text-sm font-medium text-pastel-400 bg-pastel-50 px-3 py-1 rounded-xl">{holidays.length}개</span>
          </div>
        </div>
        <div className="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
          {holidays.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="w-12 h-12 bg-pastel-50 rounded-lg flex items-center justify-center mx-auto mb-3">
                <CalendarDays className="w-6 h-6 text-pastel-300" />
              </div>
              <p className="text-pastel-400 font-medium">등록된 휴일이 없습니다.</p>
            </div>
          ) : (
            holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between px-6 py-3.5 hover:bg-pastel-50/50 transition-colors duration-150 group">
                <div className="flex items-center gap-4">
                  <div className="text-sm text-pastel-400 w-24 font-mono tracking-tight">
                    {h.date.split('T')[0]}
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
                    TYPE_COLORS[h.type].bg
                  } ${TYPE_COLORS[h.type].text}`}>
                    {TYPE_ICONS[h.type]}
                    {TYPE_LABELS[h.type]}
                  </span>
                  <span className="font-medium text-pastel-700">{h.name}</span>
                </div>
                <button
                  onClick={() => handleDeleteHoliday(h.id)}
                  className="p-2 text-pastel-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all duration-200 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Holiday Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-modal w-full max-w-md mx-4 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100/80">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gray-900 rounded-xl flex items-center justify-center">
                  <Plus className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-pastel-800">휴일 추가</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 text-pastel-300 hover:text-pastel-600 hover:bg-pastel-50 rounded-xl transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-pastel-700 mb-2">날짜</label>
                <input
                  type="date"
                  value={newHoliday.date}
                  onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200/80 rounded-lg bg-pastel-50/30 focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue focus:bg-white transition-all duration-200 text-pastel-800 placeholder:text-pastel-300"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-pastel-700 mb-2">휴일 이름</label>
                <input
                  type="text"
                  value={newHoliday.name}
                  onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                  placeholder="예: 설날, 추석"
                  className="w-full px-4 py-3 border border-gray-200/80 rounded-lg bg-pastel-50/30 focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue focus:bg-white transition-all duration-200 text-pastel-800 placeholder:text-pastel-300"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-pastel-700 mb-2">유형</label>
                <select
                  value={newHoliday.type}
                  onChange={(e) => setNewHoliday({ ...newHoliday, type: e.target.value as HolidayType })}
                  className="w-full px-4 py-3 border border-gray-200/80 rounded-lg bg-pastel-50/30 focus:ring-2 focus:ring-samsung-blue/30 focus:border-samsung-blue focus:bg-white transition-all duration-200 text-pastel-800 appearance-none cursor-pointer"
                >
                  <option value="NATIONAL">공휴일</option>
                  <option value="COMPANY">회사 휴일</option>
                  <option value="CUSTOM">사용자 정의</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-5 border-t border-gray-100/80 bg-gray-50">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-5 py-2.5 text-pastel-600 font-medium hover:bg-pastel-100 rounded-lg transition-all duration-200"
              >
                취소
              </button>
              <button
                onClick={handleAddHoliday}
                className="px-5 py-2.5 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in"
          onClick={() => setShowBulkModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-modal w-full max-w-md mx-4 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100/80">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gray-900 rounded-xl flex items-center justify-center">
                  <Upload className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-pastel-800">공휴일 프리셋 가져오기</h3>
              </div>
              <button
                onClick={() => setShowBulkModal(false)}
                className="p-2 text-pastel-300 hover:text-pastel-600 hover:bg-pastel-50 rounded-xl transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-pastel-500 text-sm mb-5 leading-relaxed">
                한국 공휴일 프리셋을 선택하여 일괄 추가합니다. 이미 등록된 날짜는 건너뜁니다.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {Object.keys(KOREAN_HOLIDAYS_PRESET).map((year) => (
                  <button
                    key={year}
                    onClick={() => handleBulkImport(parseInt(year))}
                    className="group flex items-center justify-center gap-2.5 px-4 py-4 bg-white border border-gray-200/80 rounded-lg hover:border-samsung-blue hover:shadow-depth hover:bg-samsung-blue/[0.02] transition-all duration-200 active:scale-[0.98]"
                  >
                    <Calendar className="w-4 h-4 text-pastel-400 group-hover:text-samsung-blue transition-colors duration-200" />
                    <span className="font-semibold text-pastel-700 group-hover:text-samsung-blue transition-colors duration-200">{year}년</span>
                    <span className="text-xs text-pastel-400 font-medium bg-pastel-50 px-2 py-0.5 rounded-lg">
                      ({KOREAN_HOLIDAYS_PRESET[parseInt(year)]?.length}개)
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end px-6 py-5 border-t border-gray-100/80 bg-gray-50">
              <button
                onClick={() => setShowBulkModal(false)}
                className="px-5 py-2.5 text-pastel-600 font-medium hover:bg-pastel-100 rounded-lg transition-all duration-200"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
