import { useState } from 'react';
import GuidePanel, { StepTitle, StepDesc, Tip, Warning } from './GuidePanel';

interface SavedMMGuideProps {
  onClose: () => void;
}

const TOTAL_STEPS = 6;

export default function SavedMMGuide({ onClose }: SavedMMGuideProps) {
  const [step, setStep] = useState(0);

  const handleNext = () => {
    if (step === TOTAL_STEPS - 1) {
      onClose();
    } else {
      setStep(s => s + 1);
    }
  };
  const handlePrev = () => setStep(s => Math.max(s - 1, 0));

  return (
    <GuidePanel
      title="Saved M/M 관리 가이드"
      currentStep={step}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onPrev={handlePrev}
      onClose={onClose}
    >
      {/* ── Step 0: 개요 ── */}
      {step === 0 && (
        <>
          <StepTitle>Saved M/M이란?</StepTitle>
          <StepDesc>
            <p><strong>Saved Man-Month</strong>는 AI 서비스 도입으로 절감된 인력 공수를 측정하는 지표입니다.</p>
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1.5">
              <p className="font-semibold text-gray-800">이 페이지에서 관리하는 것들:</p>
              <div>📊 <strong>서비스별 Saved M/M 집계</strong> — 전체 서비스의 절감 실적 현황</div>
              <div>🏢 <strong>부서별 Saved M/M 입력</strong> — 하단 탭에서 부서별로 직접 입력</div>
              <div>🤖 <strong>AI 추정치</strong> — 미입력 서비스에 AI가 자동 추정</div>
            </div>
          </StepDesc>
          <Tip>상단 테이블은 서비스 목록과 집계 현황, 하단 '부서별 Saved M/M 입력' 탭은 내 부서의 서비스별 M/M 입력 영역입니다.</Tip>
        </>
      )}

      {/* ── Step 1: 서비스 목록 이해 ── */}
      {step === 1 && (
        <>
          <StepTitle>1. 서비스 목록 이해하기</StepTitle>
          <StepDesc>
            <p>상단 테이블은 전체 서비스의 Saved M/M 현황을 보여줍니다.</p>
            <div className="mt-2 space-y-2">
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">MAU (Monthly Active Users)</span>
                <p className="text-xs mt-0.5">월간 활성 사용자 수. 서비스 사용 규모를 나타냅니다.</p>
              </div>
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">Saved M/M</span>
                <p className="text-xs mt-0.5">부서별 입력값을 합산한 실제 절감 실적입니다. 마우스를 올리면 부서별 내역이 보입니다.</p>
              </div>
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">AI 추정</span>
                <p className="text-xs mt-0.5">부서 입력이 없는 서비스에 대해 AI가 DAU, 사용 패턴 등으로 자동 추정합니다.</p>
              </div>
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">목표</span>
                <p className="text-xs mt-0.5">서비스별 M/M 절감 목표치입니다.</p>
              </div>
            </div>
          </StepDesc>
          <Tip>열 헤더를 클릭하면 정렬할 수 있습니다. 서비스 이름을 클릭하면 상세 페이지로 이동합니다.</Tip>
        </>
      )}

      {/* ── Step 2: 부서별 Saved M/M 입력 ── */}
      {step === 2 && (
        <>
          <StepTitle>2. 부서별 Saved M/M 입력하기</StepTitle>
          <StepDesc>
            <p>페이지 하단의 <strong>'부서별 Saved M/M 입력'</strong> 탭을 확인하세요.</p>
            <p className="mt-2">내 부서에서 사용하는 서비스 목록이 표시됩니다.</p>
            <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="font-semibold text-blue-800">입력 방법:</p>
              <ol className="list-decimal pl-4 mt-1.5 space-y-1 text-blue-700">
                <li>서비스 행에서 <strong>수정 아이콘(연필)</strong>을 클릭</li>
                <li><strong>Saved M/M 값</strong>을 숫자로 입력 (예: 2.5)</li>
                <li><strong>사유</strong>를 입력 (어떤 업무에서 절감되었는지)</li>
                <li><strong>저장</strong> 버튼 클릭</li>
              </ol>
            </div>
          </StepDesc>
          <Warning>M/M 값은 월 기준입니다. 1 M/M = 한 사람이 한 달간 일하는 분량입니다. 0.5 M/M = 약 반달 분량의 업무 절감.</Warning>
        </>
      )}

      {/* ── Step 3: AI 추정치 이해 ── */}
      {step === 3 && (
        <>
          <StepTitle>3. AI 추정치 이해하기</StepTitle>
          <StepDesc>
            <p>부서에서 직접 M/M을 입력하지 않은 서비스에는 <strong>AI 추정치</strong>가 자동으로 표시됩니다.</p>
            <div className="mt-2 space-y-2">
              <div className="p-2.5 bg-violet-50 rounded-lg">
                <span className="font-semibold text-violet-800">AI 추정 기준</span>
                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-violet-700 text-xs">
                  <li>5영업일 평균 DAU (일일 활성 사용자)</li>
                  <li>서비스 유형 (STANDARD vs BACKGROUND)</li>
                  <li>토큰 사용량 패턴</li>
                </ul>
              </div>
              <div className="p-2.5 bg-violet-50 rounded-lg">
                <span className="font-semibold text-violet-800">신뢰도 표시</span>
                <div className="mt-1 space-y-0.5 text-xs text-violet-700">
                  <div>🟢 <strong>HIGH</strong> — 충분한 데이터 기반 추정</div>
                  <div>🟡 <strong>MEDIUM</strong> — 제한된 데이터 기반</div>
                  <div>🔴 <strong>LOW</strong> — 데이터 부족, 참고용</div>
                </div>
              </div>
            </div>
          </StepDesc>
          <Tip>AI 추정치 옆의 <strong>펼치기 화살표</strong>를 클릭하면 추정 근거를 확인할 수 있습니다.</Tip>
        </>
      )}

      {/* ── Step 4: 활용 팁 ── */}
      {step === 4 && (
        <>
          <StepTitle>4. 효과적인 M/M 관리 팁</StepTitle>
          <StepDesc>
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-semibold text-gray-800">📅 월초에 지난달 실적을 입력하세요</p>
                <p className="text-xs mt-1">각 월의 데이터는 해당 월 기준으로 관리됩니다. 테이블 상단에 현재 집계 월이 표시됩니다.</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-semibold text-gray-800">📝 사유를 구체적으로 작성하세요</p>
                <p className="text-xs mt-1">예: "코드 리뷰 자동화로 리뷰어 1인 공수 절감" 처럼 어떤 업무에서 절감되었는지 명시하면 보고에 도움됩니다.</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-semibold text-gray-800">🤖 AI 추정치를 참고하세요</p>
                <p className="text-xs mt-1">직접 입력 전에 AI 추정치를 참고하면 적정 수준을 가늠할 수 있습니다. 추정치가 맞지 않으면 직접 값을 덮어쓰면 됩니다.</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-semibold text-gray-800">📊 목표 대비 실적 확인</p>
                <p className="text-xs mt-1">상단 테이블의 '목표' 열에서 서비스별 M/M 목표와 실적을 비교할 수 있습니다.</p>
              </div>
            </div>
          </StepDesc>
        </>
      )}

      {/* ── Step 5: 완료 ── */}
      {step === 5 && (
        <>
          <StepTitle>가이드 완료! 🎉</StepTitle>
          <StepDesc>
            <p>이제 Saved M/M 관리 방법을 알게 되셨습니다.</p>
            <div className="mt-3 p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="font-semibold text-violet-800">요약</p>
              <ol className="list-decimal pl-4 mt-1.5 space-y-1 text-violet-700">
                <li>상단 테이블에서 전체 현황 파악</li>
                <li>하단 '부서별 Saved M/M 입력' 탭에서 내 부서 실적 입력</li>
                <li>AI 추정치를 참고해 적정 수준 가늠</li>
                <li>사유를 구체적으로 작성</li>
              </ol>
            </div>
          </StepDesc>
          <Tip>언제든 이 가이드를 다시 열 수 있습니다.</Tip>
        </>
      )}
    </GuidePanel>
  );
}
