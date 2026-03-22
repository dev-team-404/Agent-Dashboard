import { holidaysApi } from '../services/api';

let cachedHolidays: Set<string> | null = null;
let fetchPromise: Promise<Set<string>> | null = null;

export async function fetchHolidayDates(): Promise<Set<string>> {
  if (cachedHolidays) return cachedHolidays;
  if (fetchPromise) return fetchPromise;

  fetchPromise = holidaysApi
    .getDates(365)
    .then((res) => {
      cachedHolidays = new Set(res.data.dates);
      return cachedHolidays;
    })
    .catch(() => {
      cachedHolidays = new Set<string>();
      return cachedHolidays;
    });

  return fetchPromise;
}

export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr.split('T')[0] + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function isBusinessDay(
  dateStr: string,
  holidayDates: Set<string>,
): boolean {
  const dateOnly = dateStr.split('T')[0];
  return !isWeekend(dateOnly) && !holidayDates.has(dateOnly);
}

export function filterBusinessDays<T>(
  data: T[],
  getDate: (item: T) => string,
  holidayDates: Set<string>,
): T[] {
  return data.filter((item) => isBusinessDay(getDate(item), holidayDates));
}
