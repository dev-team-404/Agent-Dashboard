import { useState } from 'react';
import GuidePanel, { StepTitle, StepDesc, Tip, CopyBlock } from './GuidePanel';
import { useHighlight } from '../../hooks/useHighlight';

interface ServiceDetailGuideProps {
  onClose: () => void;
  serviceName?: string;
  userId?: string;
  deptName?: string;
}

function decodeUnicode(str?: string): string {
  if (!str) return '';
  try { return str.includes('\\u') ? JSON.parse(`"${str}"`) : str; } catch { return str; }
}

const TOTAL_STEPS = 6;

export default function ServiceDetailGuide({ onClose, serviceName, userId, deptName }: ServiceDetailGuideProps) {
  const [step, setStep] = useState(0);
  const decodedDept = decodeUnicode(deptName);
  const origin = window.location.origin;

  // 각 스텝에서 해당 탭 하이라이트
  useHighlight('[data-tour="svc-tab-dashboard"]', step === 0);
  useHighlight('[data-tour="svc-tab-models"]', step === 1);
  useHighlight('[data-tour="svc-tab-members"]', step === 2);
  useHighlight('[data-tour="svc-tab-ratelimit"]', step === 3);

  // 해당 탭 자동 클릭
  const clickTab = (tabId: string) => {
    const btn = document.querySelector(`[data-tour="svc-tab-${tabId}"]`) as HTMLButtonElement;
    btn?.click();
  };

  const handleNext = () => {
    if (step === TOTAL_STEPS - 1) { onClose(); return; }
    const next = step + 1;
    setStep(next);
    // 스텝에 맞는 탭 자동 클릭
    if (next === 0) clickTab('dashboard');
    if (next === 1) clickTab('models');
    if (next === 2) clickTab('members');
    if (next === 3) clickTab('ratelimit');
    if (next === 4) clickTab('dashboard');
  };

  const handlePrev = () => {
    const prev = Math.max(step - 1, 0);
    setStep(prev);
    if (prev === 0) clickTab('dashboard');
    if (prev === 1) clickTab('models');
    if (prev === 2) clickTab('members');
    if (prev === 3) clickTab('ratelimit');
  };

  return (
    <GuidePanel
      title="서비스 상세 안내"
      currentStep={step}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onPrev={handlePrev}
      onClose={onClose}
    >
      {/* ── Step 0: 대시보드 탭 ── */}
      {step === 0 && (
        <>
          <StepTitle>📊 대시보드</StepTitle>
          <StepDesc>
            <p>서비스의 <strong>실시간 사용 현황</strong>을 보여줍니다.</p>
            <div className="mt-2 space-y-1.5">
              <div>• <strong>활성 사용자</strong> — 최근 30분 내 사용자 수</div>
              <div>• <strong>DAU / MAU</strong> — 일간/월간 활성 사용자</div>
              <div>• <strong>오늘의 요청 수</strong> — API 호출 횟수</div>
              <div>• <strong>오늘의 토큰</strong> — 입력 + 출력 토큰 합계</div>
              <div>• <strong>차트</strong> — 모델별/사용자별 사용량 추이</div>
            </div>
          </StepDesc>
          <Tip>하이라이트된 <strong>'대시보드'</strong> 탭이 현재 보고 있는 탭입니다.</Tip>
        </>
      )}

      {/* ── Step 1: 모델 관리 탭 ── */}
      {step === 1 && (
        <>
          <StepTitle>🤖 모델 관리</StepTitle>
          <StepDesc>
            <p>서비스에 <strong>LLM 모델을 연동</strong>하는 핵심 탭입니다.</p>
            <div className="mt-2 space-y-2">
              <div className="p-2.5 bg-blue-50 rounded-lg">
                <span className="font-semibold text-blue-800">모델 별칭(Alias)</span>
                <p className="text-xs text-blue-700 mt-0.5">하나의 별칭에 여러 모델을 등록하면 <strong>Round Robin</strong>으로 자동 분배됩니다.</p>
              </div>
              <div className="p-2.5 bg-amber-50 rounded-lg">
                <span className="font-semibold text-amber-800">Fallback</span>
                <p className="text-xs text-amber-700 mt-0.5">주 모델 장애 시 자동으로 대체 모델로 전환. 재시도 횟수 설정 가능.</p>
              </div>
              <div className="p-2.5 bg-green-50 rounded-lg">
                <span className="font-semibold text-green-800">가중치 (Weight)</span>
                <p className="text-xs text-green-700 mt-0.5">+/- 버튼으로 모델별 트래픽 비율을 조절합니다.</p>
              </div>
            </div>
          </StepDesc>
          <Tip>'새 모델 별칭 추가' 영역에서 별칭 이름을 입력하고 모델을 추가하세요.</Tip>
        </>
      )}

      {/* ── Step 2: 멤버 관리 탭 ── */}
      {step === 2 && (
        <>
          <StepTitle>👥 멤버 관리</StepTitle>
          <StepDesc>
            <p>서비스에 접근할 수 있는 <strong>팀원을 관리</strong>합니다.</p>
            <div className="mt-2 space-y-1.5">
              <div>• <strong>Owner</strong> — 서비스의 모든 설정을 관리 (생성자)</div>
              <div>• <strong>Admin</strong> — 멤버 추가/삭제, 설정 변경 가능</div>
              <div>• <strong>User</strong> — 서비스 사용만 가능</div>
            </div>
            <p className="mt-2">상단 검색으로 사용자를 찾아 추가하세요.</p>
          </StepDesc>
        </>
      )}

      {/* ── Step 3: Rate Limit 탭 ── */}
      {step === 3 && (
        <>
          <StepTitle>⚡ Rate Limit</StepTitle>
          <StepDesc>
            <p>사용자별 <strong>토큰 사용량을 제한</strong>합니다.</p>
            <div className="mt-2 space-y-2">
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">공용 제한 (Common)</span>
                <p className="text-xs mt-0.5">모든 사용자에게 동일하게 적용. 예: 100,000 토큰 / 24시간</p>
              </div>
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">개인별 제한 (Per-User)</span>
                <p className="text-xs mt-0.5">특정 사용자에게 별도 한도를 부여. 공용 제한보다 우선 적용됩니다.</p>
              </div>
            </div>
          </StepDesc>
          <Tip>시간 창은 <strong>5시간</strong> 또는 <strong>24시간</strong> 중 선택합니다.</Tip>
        </>
      )}

      {/* ── Step 4: curl 테스트 ── */}
      {step === 4 && (
        <>
          <StepTitle>📋 프록시 호출 테스트</StepTitle>
          <StepDesc>
            <p>모델을 연동했으면 아래 curl로 테스트하세요.</p>
            <CopyBlock text={`curl -X POST ${origin}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-service-id: ${serviceName || 'your-service-code'}" \\
  -H "x-user-id: ${userId || 'your-id'}" \\
  -H "x-dept-name: ${decodedDept || 'your-dept'}" \\
  -d '${JSON.stringify({
    model: 'your-model-alias',
    messages: [{ role: 'user', content: '안녕하세요' }],
  }, null, 2)}'`} />
            <p className="text-xs text-gray-500 mt-1">
              <code>x-service-id</code>에 서비스 코드, <code>model</code>에 모델 별칭을 넣으세요.
            </p>
          </StepDesc>
        </>
      )}

      {/* ── Step 5: 완료 ── */}
      {step === 5 && (
        <>
          <StepTitle>안내 완료! 🎉</StepTitle>
          <StepDesc>
            <p>서비스 상세 페이지의 주요 기능을 모두 살펴봤습니다.</p>
            <div className="mt-3 p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="font-semibold text-violet-800">요약</p>
              <ol className="list-decimal pl-4 mt-1.5 space-y-1 text-violet-700">
                <li><strong>모델 관리</strong> 탭에서 LLM 모델 연동 (RR + Fallback)</li>
                <li><strong>멤버 관리</strong> 탭에서 팀원 추가/역할 설정</li>
                <li><strong>Rate Limit</strong> 탭에서 사용량 제한</li>
                <li><strong>대시보드</strong>에서 실시간 사용 현황 확인</li>
              </ol>
            </div>
          </StepDesc>
          <Tip>각 탭을 직접 클릭해서 자유롭게 탐색해 보세요.</Tip>
        </>
      )}
    </GuidePanel>
  );
}
