export interface GuideItem {
  path: string;
  label: string;
  description: string;
}

export interface GuideSection {
  id: string;
  title: string;
  description: string;
  icon: string;
  gradient: string;
  items: GuideItem[];
}

export const guideSections: GuideSection[] = [
  {
    id: 'admin',
    title: 'Admin Guide',
    description: 'LLM 관리, 사용자 권한, 통계 등 시스템 관리자(System Admin) 기능을 안내합니다.',
    icon: '🛡️',
    gradient: 'from-blue-500 to-cyan-400',
    items: [
      { path: '/admin/getting-started', label: '시스템 관리자 시작하기', description: 'System Admin 첫 설정 순서' },
      { path: '/admin/service-management', label: '서비스 관리', description: 'dept 내 서비스 조회, 수정, 삭제' },
      { path: '/admin/llm-management', label: 'LLM 관리', description: 'LLM 등록 및 공개 범위 설정' },
      { path: '/admin/user-management', label: '사용자/권한 관리', description: '사용자 목록 및 시스템 관리자 지정' },
      { path: '/admin/stats', label: '통계 활용', description: '대시보드 통계 보기 및 활용' },
    ],
  },
  {
    id: 'service',
    title: 'Service Guide',
    description: '서비스 등록, 모델 관리, 멤버 관리, Rate Limit 등 서비스 운영 가이드입니다.',
    icon: '⚙️',
    gradient: 'from-orange-500 to-amber-400',
    items: [
      { path: '/service/service-registration', label: '서비스 등록 가이드', description: '서비스 생성, 타입, 네이밍 규칙, 배포' },
      { path: '/service/service-models', label: '서비스 모델 관리', description: 'LLM 모델 추가/제거 및 프록시 인증' },
      { path: '/service/service-users', label: '서비스 사용자 관리', description: '멤버 역할(OWNER/ADMIN/USER) 및 관리' },
      { path: '/service/rate-limits', label: 'Rate Limit 설정', description: '서비스/사용자별 토큰 제한 설정' },
      { path: '/service/usage-analytics', label: '사용량 분석', description: 'Usage Analytics 탭별 분석 및 CSV 내보내기' },
    ],
  },
  {
    id: 'user',
    title: 'User Guide',
    description: '일반 사용자를 위한 Dashboard 사용법과 사용량 확인 방법을 안내합니다.',
    icon: '👤',
    gradient: 'from-violet-500 to-purple-400',
    items: [
      { path: '/user/getting-started', label: '사용자 시작하기', description: 'Dashboard 로그인 및 기본 사용법' },
      { path: '/user/service-registration', label: '서비스 등록 가이드', description: '서비스 생성, 모델/멤버/Rate Limit 관리, 배포' },
      { path: '/user/my-usage', label: '사용량 확인', description: '내 API 사용량 조회 방법' },
    ],
  },
  {
    id: 'api',
    title: 'API Guide',
    description: 'API 인증, 호출 방법 등 개발자를 위한 API 가이드입니다.',
    icon: '🔌',
    gradient: 'from-emerald-500 to-teal-400',
    items: [
      { path: '/api/authentication', label: 'API 인증', description: '헤더 기반 인증 방법' },
      { path: '/api/framework-integration', label: '프레임워크별 연동', description: 'Python/JS/Go + LangChain, ADK, Agno 등' },
      { path: '/api/chat-completions', label: 'Chat Completions API', description: 'POST /v1/chat/completions' },
      { path: '/api/models', label: 'Models API', description: 'GET /v1/models' },
    ],
  },
];
