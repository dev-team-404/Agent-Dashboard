import { useState, useEffect } from 'react';

const STORAGE_KEY = 'excludeNonBusinessDays';
const EVENT_NAME = 'businessday-toggle';

/**
 * 주말/휴일 제외 토글 (localStorage 동기화)
 * 여러 컴포넌트에서 사용해도 상태가 동기화됨
 */
export function useBusinessDayToggle() {
  const [exclude, setExclude] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) !== 'false'; // 기본값: 제외
  });

  useEffect(() => {
    const handler = () => {
      setExclude(localStorage.getItem(STORAGE_KEY) !== 'false');
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const toggle = () => {
    const next = !exclude;
    localStorage.setItem(STORAGE_KEY, String(next));
    setExclude(next);
    window.dispatchEvent(new Event(EVENT_NAME));
  };

  return { exclude, toggle };
}
