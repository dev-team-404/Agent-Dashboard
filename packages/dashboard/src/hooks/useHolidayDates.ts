import { useState, useEffect } from 'react';
import { fetchHolidayDates } from '../utils/businessDayFilter';

export function useHolidayDates(): Set<string> {
  const [holidays, setHolidays] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchHolidayDates().then(setHolidays);
  }, []);

  return holidays;
}
