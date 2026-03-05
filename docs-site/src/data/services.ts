export interface ServiceInfo {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  gradient: string;
  path: string;
  status: 'stable' | 'beta' | 'new';
  features: { icon: string; title: string; description: string }[];
  guides: { path: string; label: string }[];
  downloadUrl?: string;
  version?: string;
}

export const services: ServiceInfo[] = [
  {
    id: 'nexus-coder',
    name: 'Nexus Coder',
    tagline: 'AI Vibe Coding Agent for WSL',
    description: '자연어로 요구사항을 설명하면 AI가 코드를 작성합니다. Browser, Office 자동화까지 올인원 코딩 에이전트.',
    icon: '⚡',
    gradient: 'from-blue-500 to-cyan-400',
    path: '/nexus-coder',
    status: 'stable',
    version: '5.0.2',
    downloadUrl: 'http://a2g.samsungds.net:13000/nexus-coder/cli/nexus-5.0.2.gz',
    features: [
      { icon: '🎯', title: 'Vibe Coding', description: '자연어 대화로 코드 작성, 리팩토링, 디버깅을 모두 처리합니다.' },
      { icon: '🌐', title: 'Browser Automation', description: 'Chrome/Edge를 직접 제어하여 프론트엔드 개발을 자동화합니다.' },
      { icon: '📄', title: 'Office Automation', description: 'Word, Excel, PowerPoint를 AI가 직접 조작합니다.' },
      { icon: '🔒', title: 'Air-Gapped Ready', description: '폐쇄망 환경에서 완벽하게 동작하도록 설계되었습니다.' },
      { icon: '📋', title: 'Planning Mode', description: '복잡한 작업을 TODO 리스트로 분해하여 체계적으로 실행합니다.' },
      { icon: '🗜️', title: 'Context Compression', description: '긴 대화도 자동 압축으로 컨텍스트를 효율적으로 관리합니다.' },
    ],
    guides: [
      { path: '/guide/getting-started', label: '시작하기' },
      { path: '/guide/basic-usage', label: '기본 사용법' },
      { path: '/guide/advanced-usage', label: '고급 사용법' },
      { path: '/guide/browser-tools', label: 'Browser Tools' },
      { path: '/guide/office-tools', label: 'Office Tools' },
      { path: '/guide/compact', label: 'Context 관리' },
      { path: '/guide/wsl-setup', label: 'WSL 설정' },
    ],
  },
  {
    id: 'nexus-coder-windows',
    name: 'Nexus Coder for Windows',
    tagline: 'Windows Native AI Coding Agent',
    description: 'WSL 없이 Windows에서 바로 사용하는 GUI 기반 AI 코딩 에이전트. 설치 파일로 간편하게 시작하세요.',
    icon: '💻',
    gradient: 'from-violet-500 to-purple-400',
    path: '/nexus-coder-windows',
    status: 'stable',
    version: '5.0.2',
    downloadUrl: 'http://a2g.samsungds.net:13000/nexus-coder-for-windows/Nexus%20Coder%20(For%20Windows)-Setup-5.0.2.exe',
    features: [
      { icon: '💻', title: 'Native Windows', description: 'WSL 설치 없이 Windows 10/11에서 .exe로 바로 실행됩니다.' },
      { icon: '🔐', title: 'SSO 자동 로그인', description: 'Samsung DS GenAI Portal SSO를 통해 자동으로 인증됩니다.' },
      { icon: '🔄', title: '자동 업데이트', description: '앱 시작 시 자동으로 최신 버전을 확인하고 업데이트합니다.' },
      { icon: '🎯', title: 'Vibe Coding', description: 'CLI와 동일한 AI 엔진으로 GUI 채팅 인터페이스를 제공합니다.' },
    ],
    guides: [
      { path: '/guide-windows/getting-started', label: '시작하기' },
      { path: '/guide-windows/basic-usage', label: '기본 사용법' },
      { path: '/guide-windows/faq', label: 'FAQ' },
    ],
  },
  {
    id: 'once',
    name: 'ONCE',
    tagline: 'AI-Powered Knowledge Management',
    description: 'AI가 자동으로 정리·분류하는 차세대 노트·지식·할일 관리 서비스. 쓰기만 하면 AI가 구조화합니다.',
    icon: '📝',
    gradient: 'from-emerald-500 to-teal-400',
    path: '/once',
    status: 'beta',
    features: [
      { icon: '🤖', title: 'AI 자동 정리', description: '내용을 입력하면 AI가 제목, 태그, 카테고리를 자동 생성합니다.' },
      { icon: '🔍', title: '시맨틱 검색', description: '의미 기반 검색으로 원하는 노트를 빠르게 찾습니다.' },
      { icon: '📊', title: 'Todo & Gantt', description: '할일 관리와 간트 차트로 프로젝트를 체계적으로 관리합니다.' },
      { icon: '👥', title: '팀 협업', description: '팀 스페이스에서 블록 단위 코멘트와 실시간 공유가 가능합니다.' },
    ],
    guides: [
      { path: '/once/guide/getting-started', label: '시작하기' },
      { path: '/once/guide/basic-usage', label: '기본 사용법' },
      { path: '/once/guide/collaboration', label: '팀 협업' },
      { path: '/once/guide/advanced', label: '고급 기능' },
      { path: '/once/faq', label: 'FAQ' },
    ],
  },
  {
    id: 'free',
    name: 'FREE',
    tagline: 'AI Weekly Report Aggregation',
    description: '주간보고 작성의 고통을 끝냅니다. 개인 업무를 입력하면 AI가 팀·파트·그룹 보고서를 자동 생성합니다.',
    icon: '📊',
    gradient: 'from-amber-500 to-orange-400',
    path: '/free',
    status: 'beta',
    features: [
      { icon: '✍️', title: '간편 입력', description: 'Jira, 채팅, 이메일 등 다양한 소스에서 업무를 간편하게 입력합니다.' },
      { icon: '🤖', title: 'AI 자동 분류', description: '입력된 내용을 AI가 자동으로 항목별로 분리·정리합니다.' },
      { icon: '📋', title: '자동 보고서', description: '파트→그룹→팀 계층 구조에 맞춰 보고서를 자동 생성합니다.' },
      { icon: '📤', title: '다양한 내보내기', description: 'Word, Excel, Markdown 포맷으로 보고서를 내보낼 수 있습니다.' },
    ],
    guides: [
      { path: '/free/guide/getting-started', label: '시작하기' },
      { path: '/free/guide/basic-usage', label: '기본 사용법' },
      { path: '/free/guide/reports', label: '보고서 관리' },
      { path: '/free/guide/admin', label: '관리자 가이드' },
      { path: '/free/faq', label: 'FAQ' },
    ],
  },
];