import { useState, useEffect, useCallback } from 'react';
import GuidePanel, { StepTitle, StepDesc, FieldGuide, Tip, Warning } from './GuidePanel';

interface ServiceGuideProps {
  onClose: () => void;
  onOpenCreateWizard: () => void;
  onNavigateToService?: (serviceId: string) => void;
  /** 마법사 현재 스텝 (0-3). 마법사가 닫혀있으면 -1 */
  wizardStep: number;
  wizardOpen: boolean;
}

interface SavedService {
  id?: string;
  name: string;
  displayName: string;
  description?: string;
  type: string;
}

const TOTAL_STEPS = 6; // 0: intro, 1-4: wizard steps, 5: success

export default function ServiceGuide({ onClose, onOpenCreateWizard, onNavigateToService, wizardStep, wizardOpen }: ServiceGuideProps) {
  const [phase, setPhase] = useState<'intro' | 'wizard' | 'success'>('intro');
  const [savedService, setSavedService] = useState<SavedService | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 가이드 스텝 계산: intro=0, wizard=wizardStep+1, success=5
  const currentStep = phase === 'intro' ? 0 : phase === 'success' ? 5 : wizardStep + 1;

  // 마법사 스텝이 변경되면 가이드도 wizard phase로 동기화
  useEffect(() => {
    if (wizardOpen && phase === 'intro') {
      setPhase('wizard');
    }
  }, [wizardOpen, phase]);

  const handleSuccess = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail as SavedService;
    setSavedService(detail);
    setError(null);
    setPhase('success');
  }, []);

  const handleError = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    setError(detail?.error || '저장에 실패했습니다.');
  }, []);

  useEffect(() => {
    window.addEventListener('service-guide-success', handleSuccess);
    window.addEventListener('service-guide-error', handleError);
    return () => {
      window.removeEventListener('service-guide-success', handleSuccess);
      window.removeEventListener('service-guide-error', handleError);
    };
  }, [handleSuccess, handleError]);

  // 마법사 "다음" 버튼 클릭 (validation 포함)
  const clickWizardNext = () => {
    const btn = document.querySelector('[data-tour="wizard-next-btn"]') as HTMLButtonElement;
    if (btn && !btn.disabled) btn.click();
  };

  // 마법사 "이전" 버튼 클릭
  const clickWizardPrev = () => {
    const prevBtns = document.querySelectorAll('[data-tour="wizard-prev-btn"]');
    const btn = (prevBtns.length > 0 ? prevBtns[0] : null) as HTMLButtonElement | null;
    if (btn) btn.click();
  };

  // 마법사 "서비스 등록" 버튼 클릭
  const clickWizardSave = () => {
    const btn = document.querySelector('[data-tour="wizard-save-btn"]') as HTMLButtonElement;
    if (btn && !btn.disabled) btn.click();
  };

  const handleNext = () => {
    if (phase === 'intro') {
      onOpenCreateWizard();
      setPhase('wizard');
    } else if (phase === 'wizard') {
      if (wizardStep < 3) {
        // 마법사 "다음" 클릭 — validation 통과하면 wizardStep이 올라감
        clickWizardNext();
      } else {
        // 마법사 마지막 스텝 → "서비스 등록" 클릭
        clickWizardSave();
      }
    } else if (phase === 'success') {
      if (savedService?.id && onNavigateToService) {
        sessionStorage.setItem('service_detail_guide', savedService.id);
        onNavigateToService(savedService.id);
        onClose();
      } else {
        onClose();
      }
    }
  };

  const handlePrev = () => {
    setError(null);
    if (phase === 'wizard' && wizardStep === 0) {
      // 마법사 첫 스텝에서 이전 → intro로
      setPhase('intro');
    } else if (phase === 'wizard') {
      clickWizardPrev();
    }
  };

  return (
    <GuidePanel
      title="서비스 등록 가이드"
      currentStep={currentStep}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onPrev={handlePrev}
      onClose={onClose}
      nextLabel={
        phase === 'intro' ? '서비스 등록 시작' :
        phase === 'success' ? '상세 페이지로 이동' :
        wizardStep === 3 ? '서비스 등록' : undefined
      }
      nextDisabled={false}
    >
      {/* ── intro: 시작 ── */}
      {phase === 'intro' && (
        <>
          <StepTitle>서비스를 등록해봅시다</StepTitle>
          <StepDesc>
            <p>서비스를 등록하면 LLM 모델을 연동하고, 사용량을 추적하고, 팀원을 관리할 수 있습니다.</p>
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1.5">
              <p className="font-semibold text-gray-800">서비스 등록 후 할 수 있는 것들:</p>
              <div>📊 <strong>전용 대시보드</strong> — 사용량, MAU, DAU 실시간 확인</div>
              <div>🤖 <strong>모델 연동</strong> — LLM 모델 연결 + Round Robin + Fallback</div>
              <div>👥 <strong>멤버 관리</strong> — Owner/Admin/User 역할 부여</div>
              <div>⚡ <strong>Rate Limit</strong> — 사용자별/공용 토큰 제한</div>
              <div>📈 <strong>사용 로그</strong> — 요청별 상세 기록</div>
            </div>
          </StepDesc>
          <Tip>다음을 누르면 서비스 등록 마법사가 열립니다.</Tip>
        </>
      )}

      {/* ── wizard step 0: 기본 정보 ── */}
      {phase === 'wizard' && wizardStep === 0 && (
        <>
          <StepTitle>1. 기본 정보를 입력하세요</StepTitle>
          <StepDesc>
            <p>마법사의 첫 번째 단계입니다.</p>
            <FieldGuide label="서비스 코드" desc="시스템 내부 식별자. 영문 소문자, 숫자, 하이픈만 가능" example="my-ai-chatbot" />
            <FieldGuide label="표시 이름" desc="사용자에게 보여질 서비스 이름" example="내 AI 챗봇" />
            <FieldGuide label="설명" desc="서비스에 대한 간단한 설명" example="사내 문서 검색 AI 챗봇" />
          </StepDesc>
          <Warning>서비스 코드는 등록 후 변경할 수 없습니다! curl 호출 시 <code>x-service-id</code> 헤더로 사용됩니다.</Warning>
          <Tip>입력 후 '다음'을 누르면 마법사와 가이드가 함께 다음 단계로 이동합니다.</Tip>
        </>
      )}

      {/* ── wizard step 1: 서비스 분류 ── */}
      {phase === 'wizard' && wizardStep === 1 && (
        <>
          <StepTitle>2. 서비스 유형과 카테고리를 선택하세요</StepTitle>
          <StepDesc>
            <div className="space-y-2">
              <div>
                <span className="font-semibold">서비스 유형</span>
                <div className="ml-3 mt-1 space-y-1">
                  <div><strong>표준</strong> — UI가 있는 대화형 서비스 (챗봇, 검색 등)</div>
                  <div><strong>백그라운드</strong> — UI 없이 자동 실행되는 서비스 (배치, 파이프라인)</div>
                </div>
              </div>
              <div>
                <span className="font-semibold">API Only</span> — 프록시를 거치지 않고 자체 API로 사용 기록을 전송하는 서비스. 일반적으로는 끄세요.
              </div>
              <div>
                <span className="font-semibold">카테고리</span> — 서비스 분류를 1개 이상 선택하세요.
              </div>
            </div>
          </StepDesc>
          <Tip>잘 모르겠으면 <strong>표준</strong> 유형에 가장 가까운 카테고리를 선택하세요. 나중에 수정 가능합니다.</Tip>
        </>
      )}

      {/* ── wizard step 2: 링크 설정 ── */}
      {phase === 'wizard' && wizardStep === 2 && (
        <>
          <StepTitle>3. 링크를 설정하세요 (선택사항)</StepTitle>
          <StepDesc>
            <p>아래 항목은 모두 <strong>선택사항</strong>입니다. 나중에 수정할 수 있으니 비워둬도 됩니다.</p>
            <FieldGuide label="로고 URL" desc="서비스 카드에 표시할 로고 이미지" example="https://example.com/logo.png" />
            <FieldGuide label="서비스 URL" desc="서비스 바로가기 링크" example="https://my-service.example.com" />
            <FieldGuide label="API 문서 URL" desc="API 문서 링크" example="https://docs.example.com/api" />
            <FieldGuide label="Jira 티켓" desc="관련 Jira 이슈 링크" />
          </StepDesc>
        </>
      )}

      {/* ── wizard step 3: 확인 및 등록 ── */}
      {phase === 'wizard' && wizardStep === 3 && (
        <>
          <StepTitle>4. 확인하고 등록하세요</StepTitle>
          <StepDesc>
            <p>입력한 정보를 확인하세요. 가이드의 <strong>'서비스 등록'</strong> 버튼을 누르면 등록됩니다.</p>
            {error && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="font-semibold text-red-700">❌ 등록 실패</p>
                <p className="text-red-600 mt-1">{error}</p>
                <div className="mt-2 text-red-600">
                  <p className="font-medium">해결 방법:</p>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {error.includes('이미 존재') && <li>다른 서비스 코드를 입력하세요</li>}
                    {error.includes('형식') && <li>서비스 코드: 영문 소문자, 숫자, 하이픈만 사용</li>}
                    <li>'이전'으로 돌아가서 수정한 후 다시 시도하세요</li>
                  </ul>
                </div>
              </div>
            )}
            {!error && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1">
                <p className="font-medium text-gray-700">등록 전 확인 사항:</p>
                <div>✅ 서비스 코드, 표시 이름 입력 완료</div>
                <div>✅ 카테고리 1개 이상 선택</div>
                <div>✅ 입력 정보 최종 확인</div>
              </div>
            )}
          </StepDesc>
        </>
      )}

      {/* ── success: 등록 완료 ── */}
      {phase === 'success' && (
        <>
          <StepTitle>🎉 서비스가 등록되었습니다!</StepTitle>
          <StepDesc>
            {savedService && (
              <div className="p-3 bg-green-50 rounded-lg border border-green-200 space-y-1">
                <div><span className="font-medium text-green-800">서비스:</span> {savedService.displayName} (<code>{savedService.name}</code>)</div>
                <div><span className="font-medium text-green-800">유형:</span> {savedService.type === 'BACKGROUND' ? '백그라운드' : '표준'}</div>
              </div>
            )}
            <p className="mt-3">'상세 페이지로 이동' 버튼을 누르면 서비스 상세 페이지에서 각 탭을 하이라이트하며 안내합니다.</p>
          </StepDesc>
          <Tip>서비스 상세 페이지에는 <strong>대시보드, 모델 관리, 멤버 관리, Rate Limit</strong> 탭이 있습니다.</Tip>
        </>
      )}
    </GuidePanel>
  );
}
