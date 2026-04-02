import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { driver, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tourStyles.css';
import { getStepsForRole, type TourStep } from './tourSteps';

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

interface TourContextValue {
  startTour: () => void;
  isTourActive: boolean;
  isTourCompleted: boolean;
}

export const TourContext = createContext<TourContextValue>({
  startTour: () => {},
  isTourActive: false,
  isTourCompleted: false,
});

function getTourStorageKey(userId: string) {
  return `tour_completed_v1_${userId}`;
}

function waitForElement(selector: string, timeoutMs = 4000): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) { resolve(existing); return; }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

interface TourProviderProps {
  children: React.ReactNode;
  userId: string;
  adminRole: AdminRole;
}

export default function TourProvider({ children, userId, adminRole }: TourProviderProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const driverRef = useRef<Driver | null>(null);
  const stepsRef = useRef<TourStep[]>([]);
  const currentIndexRef = useRef(0);
  const isAdvancingRef = useRef(false); // Flag: intentional destroy (next/prev), not user close
  const [isTourActive, setIsTourActive] = useState(false);
  const [isTourCompleted, setIsTourCompleted] = useState(() => {
    return localStorage.getItem(getTourStorageKey(userId)) === 'true';
  });

  const ensureSidebarExpanded = useCallback(() => {
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
      window.dispatchEvent(new Event('expand-sidebar'));
      return new Promise<void>(r => setTimeout(r, 250));
    }
    return Promise.resolve();
  }, []);

  const completeTour = useCallback(() => {
    localStorage.setItem(getTourStorageKey(userId), 'true');
    setIsTourCompleted(true);
    setIsTourActive(false);
    if (driverRef.current) {
      isAdvancingRef.current = true;
      driverRef.current.destroy();
      driverRef.current = null;
    }
  }, [userId]);

  // Use a ref to always have the latest driveToStep without stale closures
  const driveToStepRef = useRef<(index: number) => Promise<void>>();

  const driveToStep = useCallback(async (index: number) => {
    const steps = stepsRef.current;
    if (index >= steps.length) {
      completeTour();
      return;
    }

    const step = steps[index];
    currentIndexRef.current = index;

    // Use window.location.pathname to avoid stale closure issues
    const currentPath = window.location.pathname;

    // Navigate if needed
    if (step.route && currentPath !== step.route) {
      navigate(step.route);
    }

    // Ensure sidebar is expanded for sidebar selectors
    if (step.selector?.startsWith('[data-tour="nav-')) {
      await ensureSidebarExpanded();
    }

    // Build driver step
    const driveStep: DriveStep = {
      popover: {
        title: step.popover.title,
        description: step.popover.description,
        side: step.popover.side,
        popoverClass: step.selector ? '' : 'driver-popover-center',
      },
    };
    if (step.selector) {
      const el = await waitForElement(step.selector);
      if (!el) {
        // Element not found — skip to next step
        driveToStepRef.current?.(index + 1);
        return;
      }
      driveStep.element = step.selector;
    }

    // Destroy previous driver instance
    if (driverRef.current) {
      isAdvancingRef.current = true;
      driverRef.current.destroy();
    }

    const totalSteps = steps.length;
    const d = driver({
      showProgress: true,
      showButtons: ['next', 'previous', 'close'],
      nextBtnText: index === totalSteps - 1 ? t('tourGuides.tourProvider.done') : t('tourGuides.tourProvider.next'),
      prevBtnText: t('tourGuides.tourProvider.prev'),
      doneBtnText: index === totalSteps - 1 ? t('tourGuides.tourProvider.done') : t('tourGuides.tourProvider.next'),
      progressText: `{{current}} / {{total}}`,
      allowClose: true,
      stagePadding: 8,
      stageRadius: 8,
      steps: [driveStep],
      onNextClick: () => {
        isAdvancingRef.current = true;
        d.destroy();
        driveToStepRef.current?.(index + 1);
      },
      onPrevClick: () => {
        if (index > 0) {
          isAdvancingRef.current = true;
          d.destroy();
          driveToStepRef.current?.(index - 1);
        }
      },
      onCloseClick: () => {
        isAdvancingRef.current = false;
        d.destroy();
        driverRef.current = null;
        setIsTourActive(false);
      },
      onDestroyed: () => {
        // Called after driver is fully destroyed.
        // If this wasn't an intentional advance (next/prev), it was an overlay click or escape key.
        if (!isAdvancingRef.current) {
          driverRef.current = null;
          setIsTourActive(false);
        }
        isAdvancingRef.current = false;
      },
    });

    driverRef.current = d;
    d.drive(0);

    // After driver renders, update progress text & prev button visibility
    requestAnimationFrame(() => {
      const progressEl = document.querySelector('.driver-popover-progress-text');
      if (progressEl) {
        progressEl.textContent = `${index + 1} / ${totalSteps}`;
      }
      const prevBtn = document.querySelector('.driver-popover-prev-btn') as HTMLElement;
      if (prevBtn) {
        prevBtn.style.display = index === 0 ? 'none' : '';
      }
    });
  }, [navigate, completeTour, ensureSidebarExpanded, t]);

  // Keep the ref in sync
  driveToStepRef.current = driveToStep;

  const startTour = useCallback(() => {
    const steps = getStepsForRole(adminRole);
    stepsRef.current = steps;
    currentIndexRef.current = 0;
    setIsTourActive(true);

    // Start from the right page based on role
    const startRoute = adminRole ? '/' : '/public-dashboard';
    if (window.location.pathname !== startRoute) {
      navigate(startRoute);
    }

    // Small delay to let navigation settle
    setTimeout(() => driveToStepRef.current?.(0), 300);
  }, [adminRole, navigate]);

  // Auto-start for first-time users (1.5s after mount)
  useEffect(() => {
    if (isTourCompleted) return;
    const timer = setTimeout(() => {
      startTour();
    }, 1500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        isAdvancingRef.current = true;
        driverRef.current.destroy();
      }
    };
  }, []);

  return (
    <TourContext.Provider value={{ startTour, isTourActive, isTourCompleted }}>
      {children}
    </TourContext.Provider>
  );
}
