import { useEffect } from 'react';

/**
 * Adds a pulsing blue highlight to a DOM element by selector.
 * Automatically cleans up when `active` becomes false or component unmounts.
 */
export function useHighlight(selector: string | null, active: boolean) {
  useEffect(() => {
    if (!active || !selector) return;

    let el = document.querySelector(selector);
    if (!el) {
      // Element might not be rendered yet — retry with a short delay
      const timer = setTimeout(() => {
        el = document.querySelector(selector);
        if (el) el.classList.add('guide-highlight');
      }, 500);
      return () => {
        clearTimeout(timer);
        document.querySelector(selector)?.classList.remove('guide-highlight');
      };
    }

    el.classList.add('guide-highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    return () => {
      document.querySelector(selector)?.classList.remove('guide-highlight');
    };
  }, [selector, active]);
}
