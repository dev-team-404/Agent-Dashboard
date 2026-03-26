import { useState, useEffect, useCallback } from 'react';
import GuidePanel, { StepTitle, StepDesc, FieldGuide, Tip, Warning } from './GuidePanel';

interface ServiceGuideProps {
  onClose: () => void;
  onOpenCreateWizard: () => void;
  onNavigateToService?: (serviceId: string) => void;
}

interface SavedService {
  id?: string;
  name: string;
  displayName: string;
  description?: string;
  type: string;
}

const TOTAL_STEPS = 6;

export default function ServiceGuide({ onClose, onOpenCreateWizard, onNavigateToService }: ServiceGuideProps) {
  const [step, setStep] = useState(0);
  const [savedService, setSavedService] = useState<SavedService | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail as SavedService;
    setSavedService(detail);
    setError(null);
    setStep(5); // 성공 → 등록 후 안내 스텝으로
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

  const handleNext = () => {
    if (step === 0) {
      onOpenCreateWizard();
      setStep(1);
    } else if (step === 4) {
      // 등록 스텝: "다음" 클릭 불가 — 저장 성공 이벤트로만 진행
      return;
    } else if (step === 5) {
      // 성공 스텝 → 서비스 상세 페이지로 이동
      if (savedService?.id && onNavigateToService) {
        sessionStorage.setItem('service_detail_guide', savedService.id);
        onNavigateToService(savedService.id);
        onClose();
      } else {
        onClose();
      }
      return;
    } else if (step === TOTAL_STEPS - 1) {
      onClose();
    } else {
      setStep(s => Math.min(s + 1, TOTAL_STEPS - 1));
    }
  };
  const handlePrev = () => {
    setError(null);
    setStep(s => Math.max(s - 1, 0));
  };

  return (
    <GuidePanel
      title="서비스 등록 가이드"
      currentStep={step}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onPrev={handlePrev}
      onClose={onClose}
      nextLabel={step === 0 ? '서비스 등록 시작' : step === 4 ? '등록을 눌러주세요' : step === 5 ? '상세 페이지로 이동' : undefined}
      nextDisabled={step === 4}
    >
      {/* ── Step 0: 시작 ── */}
      {step === 0 && (
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

      {/* ── Step 1: 기본 정보 ── */}
      {step === 1 && (
        <>
          <StepTitle>1. 기본 정보를 입력하세요</StepTitle>
          <StepDesc>
            <p>마법사의 첫 번째 단계입니다.</p>
            <FieldGuide
              label="서비스 코드"
              desc="시스템 내부 식별자. 영문 소문자, 숫자, 하이픈만 가능"
              example="my-ai-chatbot"
            />
            <FieldGuide
              label="표시 이름"
              desc="사용자에게 보여질 서비스 이름"
              example="내 AI 챗봇"
            />
            <FieldGuide
              label="설명"
              desc="서비스에 대한 간단한 설명"
              example="사내 문서 검색 AI 챗봇"
            />
          </StepDesc>
          <Warning>서비스 코드는 등록 후 변경할 수 없습니다! curl 호출 시 <code>x-service-id</code> 헤더로 사용됩니다.</Warning>
          <Tip>마법사에서 '다음' 버튼을 눌러 다음 단계로 진행하세요.</Tip>
        </>
      )}

      {/* ── Step 2: 서비스 분류 ── */}
      {step === 2 && (
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

      {/* ── Step 3: 링크 설정 ── */}
      {step === 3 && (
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

      {/* ── Step 4: 확인 및 등록 ── */}
      {step === 4 && (
        <>
          <StepTitle>4. 확인하고 등록하세요</StepTitle>
          <StepDesc>
            <p>마법사의 마지막 단계입니다. 입력한 정보를 확인하고 <strong>'서비스 등록'</strong> 버튼을 클릭하세요.</p>
            {error && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="font-semibold text-red-700">❌ 등록 실패</p>
                <p className="text-red-600 mt-1">{error}</p>
                <div className="mt-2 text-red-600">
                  <p className="font-medium">해결 방법:</p>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {error.includes('이미 존재') && <li>다른 서비스 코드를 입력하세요</li>}
                    {error.includes('형식') && <li>서비스 코드: 영문 소문자, 숫자, 하이픈만 사용</li>}
                    <li>'이전' 버튼으로 돌아가서 수정한 후 다시 시도하세요</li>
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

      {/* ── Step 5: 등록 완료 ── */}
      {step === 5 && (
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
