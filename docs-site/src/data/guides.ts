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
    description: '서비스 등록, LLM 관리, 사용자 권한 등 관리자 기능을 안내합니다.',
    icon: '🛡️',
    gradient: 'from-blue-500 to-cyan-400',
    items: [
      { path: '/admin/getting-started', label: 'Admin 시작하기', description: 'Dashboard 접속 및 첫 설정 순서' },
      { path: '/admin/service-management', label: '서비스 관리', description: '서비스 등록, 수정, 삭제' },
      { path: '/admin/llm-management', label: 'LLM 관리', description: 'LLM 등록 및 공개 범위 설정' },
      { path: '/admin/user-management', label: '사용자/권한 관리', description: '사용자 목록 및 권한 관리' },
      { path: '/admin/stats', label: '통계 활용', description: '대시보드 통계 보기 및 활용' },
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
      { path: '/user/my-usage', label: '사용량 확인', description: '내 API 사용량 조회 방법' },
    ],
  },
  {
    id: 'api',
    title: 'API Guide',
    description: 'API 인증, 호출 방법, 서비스 등록 등 개발자를 위한 API 가이드입니다.',
    icon: '🔌',
    gradient: 'from-emerald-500 to-teal-400',
    items: [
      { path: '/api/authentication', label: 'API 인증', description: '헤더 기반 인증 방법' },
      { path: '/api/chat-completions', label: 'Chat Completions API', description: 'POST /v1/chat/completions' },
      { path: '/api/models', label: 'Models API', description: 'GET /v1/models' },
      { path: '/api/service-registration', label: '서비스 등록 가이드', description: 'Dashboard에서 서비스 등록하기' },
    ],
  },
];
