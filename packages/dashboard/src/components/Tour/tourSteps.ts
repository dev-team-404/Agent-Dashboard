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

export const tourSteps: TourStep[] = [
  // ─── Welcome ───
  {
    id: 'welcome',
    selector: null,
    route: null,
    popover: {
      title: 'Agent Registry에 오신 것을 환영합니다! 👋',
      description: '주요 기능을 빠르게 안내해 드릴게요. 언제든 건너뛸 수 있습니다.',
    },
    roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
  },

  // ─── Admin: 통합 대시보드 ───
  {
    id: 'nav-dashboard',
    selector: '[data-tour="nav-/"]',
    route: null,
    popover: {
      title: '통합 대시보드',
      description: '전체 서비스 현황과 사용량을 한눈에 파악할 수 있는 메인 화면입니다.',
      side: 'right',
    },
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },

  // ─── Admin: LLM 모델 관리 ───
  {
    id: 'nav-models',
    selector: '[data-tour="nav-/models"]',
    route: null,
    popover: {
      title: 'LLM 모델 관리',
      description: 'AI 모델을 등록하고 관리합니다. 새 모델을 추가하거나, 기존 모델의 상태를 확인할 수 있습니다.',
      side: 'right',
    },
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },
  {
    id: 'models-add-btn',
    selector: '[data-tour="models-add-btn"]',
    route: '/models',
    popover: {
      title: '새 모델 추가',
      description: '여기서 새 LLM 모델을 등록할 수 있습니다. 엔드포인트, API 키, 모델 유형 등을 설정합니다.',
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
      title: 'Saved M/M 관리',
      description: '서비스별 Saved Man-Month를 추적합니다. 부서별 M/M 절감 현황을 확인하고 관리할 수 있습니다.',
      side: 'right',
    },
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },

  // ─── Admin: 사용자 관리 ───
  {
    id: 'nav-users',
    selector: '[data-tour="nav-/users"]',
    route: null,
    popover: {
      title: '사용자 관리',
      description: '전체 사용자 목록을 확인하고, 관리자 권한을 부여하거나 서비스 접근 권한을 관리합니다.',
      side: 'right',
    },
    roles: ['SUPER_ADMIN', 'ADMIN'],
  },

  // ─── Super Admin: 레지스트리 LLM 설정 ───
  {
    id: 'nav-system-llm',
    selector: '[data-tour="nav-/system-llm"]',
    route: null,
    popover: {
      title: '레지스트리 LLM 관리',
      description: 'M/M 추적, 에러 분석, 로고 생성 등에 사용되는 시스템 LLM을 설정합니다.',
      side: 'right',
    },
    roles: ['SUPER_ADMIN'],
  },
  {
    id: 'system-llm-settings',
    selector: '[data-tour="system-llm-settings"]',
    route: '/system-llm',
    popover: {
      title: '시스템 LLM 설정',
      description: 'M/M 추적용 LLM, 에러 초도분석용 LLM, 로고 자동 생성 모델 등을 각각 지정합니다.',
      side: 'bottom',
    },
    roles: ['SUPER_ADMIN'],
  },

  // ─── All Users: 공개 대시보드 ───
  {
    id: 'nav-public-dashboard',
    selector: '[data-tour="nav-/public-dashboard"]',
    route: null,
    popover: {
      title: '공개 대시보드',
      description: '전체 서비스의 공개 통계를 확인할 수 있습니다.',
      side: 'right',
    },
    roles: ['USER'],
  },

  // ─── All Users: 서비스 마켓 ───
  {
    id: 'nav-services',
    selector: '[data-tour="nav-/services"]',
    route: null,
    popover: {
      title: '나에게 공개된 서비스',
      description: '사용 가능한 서비스를 탐색합니다. 서비스별 설명, 사용 모델, 연동 방법을 확인할 수 있습니다.',
      side: 'right',
    },
    roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
  },

  // ─── All Users: 내 서비스 ───
  {
    id: 'nav-my-services',
    selector: '[data-tour="nav-/my-services"]',
    route: null,
    popover: {
      title: '서비스 관리',
      description: '내 서비스를 생성하고 관리합니다. 서비스 등록, 모델 연동, 배포까지 한 곳에서 가능합니다.',
      side: 'right',
    },
    roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
  },
  {
    id: 'my-services-create-btn',
    selector: '[data-tour="my-services-create-btn"]',
    route: '/my-services',
    popover: {
      title: '새 서비스 만들기',
      description: '여기를 눌러 새 서비스를 등록하세요. 서비스 이름, 설명, 연동할 LLM 모델 등을 설정합니다.',
      side: 'bottom',
    },
    roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
  },

  // ─── All Users: 내 사용량 ───
  {
    id: 'nav-my-usage',
    selector: '[data-tour="nav-/my-usage"]',
    route: null,
    popover: {
      title: '내 사용량',
      description: '내 API 호출량과 토큰 사용량을 확인할 수 있습니다.',
      side: 'right',
    },
    roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
  },

  // ─── User only: 관리자 권한 신청 ───
  {
    id: 'nav-admin-request',
    selector: '[data-tour="nav-/admin-request"]',
    route: null,
    popover: {
      title: '관리자 권한 신청',
      description: '더 많은 기능이 필요하면 관리자 권한을 신청할 수 있습니다.',
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
      title: '안내 완료! 🎉',
      description: '이제 자유롭게 사용해 보세요. 우측 하단의 로봇 아이콘을 누르면 언제든 다시 안내를 받을 수 있습니다.',
    },
    roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
  },
];

/** Filter steps by user role */
export function getStepsForRole(adminRole: 'SUPER_ADMIN' | 'ADMIN' | null): TourStep[] {
  const role: TourRole = adminRole ?? 'USER';
  return tourSteps.filter(step => step.roles.includes(role));
}
