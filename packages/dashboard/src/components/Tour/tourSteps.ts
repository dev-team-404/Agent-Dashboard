import i18n from '../../i18n';

export type TourRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

export interface TourStep {
  id: string;
  /** CSS selector for the target element. null = centered popover (no highlight) */
  selector: string | null;
  /** Route to navigate to before highlighting */
  route: string | null;
  popover: {
    title: string;
    description: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
  };
  /** Which roles should see this step */
  roles: TourRole[];
}

const t = (key: string) => i18n.t(key);

export function getTourSteps(): TourStep[] {
  return [
    // ─── Welcome ───
    {
      id: 'welcome',
      selector: null,
      route: null,
      popover: {
        title: t('tour.welcome.title'),
        description: t('tour.welcome.description'),
      },
      roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
    },

    // ─── Admin: Dashboard ───
    {
      id: 'nav-dashboard',
      selector: '[data-tour="nav-/"]',
      route: null,
      popover: {
        title: t('tour.navDashboard.title'),
        description: t('tour.navDashboard.description'),
        side: 'right',
      },
      roles: ['SUPER_ADMIN', 'ADMIN'],
    },

    // ─── Admin: LLM Models ───
    {
      id: 'nav-models',
      selector: '[data-tour="nav-/models"]',
      route: null,
      popover: {
        title: t('tour.navModels.title'),
        description: t('tour.navModels.description'),
        side: 'right',
      },
      roles: ['SUPER_ADMIN', 'ADMIN'],
    },
    {
      id: 'models-add-btn',
      selector: '[data-tour="models-add-btn"]',
      route: '/models',
      popover: {
        title: t('tour.modelsAddBtn.title'),
        description: t('tour.modelsAddBtn.description'),
        side: 'bottom',
      },
      roles: ['SUPER_ADMIN', 'ADMIN'],
    },

    // ─── Admin: Saved M/M ───
    {
      id: 'nav-service-targets',
      selector: '[data-tour="nav-/service-targets"]',
      route: null,
      popover: {
        title: t('tour.navServiceTargets.title'),
        description: t('tour.navServiceTargets.description'),
        side: 'right',
      },
      roles: ['SUPER_ADMIN', 'ADMIN'],
    },

    // ─── Super Admin: Users ───
    {
      id: 'nav-users',
      selector: '[data-tour="nav-/users"]',
      route: null,
      popover: {
        title: t('tour.navUsers.title'),
        description: t('tour.navUsers.description'),
        side: 'right',
      },
      roles: ['SUPER_ADMIN'],
    },

    // ─── Super Admin: Registry LLM ───
    {
      id: 'nav-system-llm',
      selector: '[data-tour="nav-/system-llm"]',
      route: null,
      popover: {
        title: t('tour.navSystemLlm.title'),
        description: t('tour.navSystemLlm.description'),
        side: 'right',
      },
      roles: ['SUPER_ADMIN'],
    },
    {
      id: 'system-llm-settings',
      selector: '[data-tour="system-llm-settings"]',
      route: '/system-llm',
      popover: {
        title: t('tour.systemLlmSettings.title'),
        description: t('tour.systemLlmSettings.description'),
        side: 'bottom',
      },
      roles: ['SUPER_ADMIN'],
    },

    // ─── All Users: Public Dashboard ───
    {
      id: 'nav-public-dashboard',
      selector: '[data-tour="nav-/public-dashboard"]',
      route: null,
      popover: {
        title: t('tour.navPublicDashboard.title'),
        description: t('tour.navPublicDashboard.description'),
        side: 'right',
      },
      roles: ['USER'],
    },

    // ─── All Users: Service Market ───
    {
      id: 'nav-services',
      selector: '[data-tour="nav-/services"]',
      route: null,
      popover: {
        title: t('tour.navServices.title'),
        description: t('tour.navServices.description'),
        side: 'right',
      },
      roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
    },

    // ─── All Users: My Services ───
    {
      id: 'nav-my-services',
      selector: '[data-tour="nav-/my-services"]',
      route: null,
      popover: {
        title: t('tour.navMyServices.title'),
        description: t('tour.navMyServices.description'),
        side: 'right',
      },
      roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
    },
    {
      id: 'my-services-create-btn',
      selector: '[data-tour="my-services-create-btn"]',
      route: '/my-services',
      popover: {
        title: t('tour.myServicesCreateBtn.title'),
        description: t('tour.myServicesCreateBtn.description'),
        side: 'bottom',
      },
      roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
    },

    // ─── All Users: My Usage ───
    {
      id: 'nav-my-usage',
      selector: '[data-tour="nav-/my-usage"]',
      route: null,
      popover: {
        title: t('tour.navMyUsage.title'),
        description: t('tour.navMyUsage.description'),
        side: 'right',
      },
      roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
    },

    // ─── User only: Admin Request ───
    {
      id: 'nav-admin-request',
      selector: '[data-tour="nav-/admin-request"]',
      route: null,
      popover: {
        title: t('tour.navAdminRequest.title'),
        description: t('tour.navAdminRequest.description'),
        side: 'right',
      },
      roles: ['USER'],
    },

    // ─── Completion ───
    {
      id: 'tour-complete',
      selector: null,
      route: null,
      popover: {
        title: t('tour.complete.title'),
        description: t('tour.complete.description'),
      },
      roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
    },
  ];
}

/** @deprecated Use getTourSteps() for i18n support */
export const tourSteps = getTourSteps();

/** Filter steps by user role */
export function getStepsForRole(adminRole: 'SUPER_ADMIN' | 'ADMIN' | null): TourStep[] {
  const role: TourRole = adminRole ?? 'USER';
  return getTourSteps().filter(step => step.roles.includes(role));
}
