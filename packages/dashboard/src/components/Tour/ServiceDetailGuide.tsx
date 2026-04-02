import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GuidePanel, { StepTitle, StepDesc, Tip, CopyBlock } from './GuidePanel';
import { useHighlight } from '../../hooks/useHighlight';

interface ServiceDetailGuideProps {
  onClose: () => void;
  serviceName?: string;
  userId?: string;
  deptName?: string;
}

const TOTAL_STEPS = 6;

export default function ServiceDetailGuide({ onClose, serviceName, userId }: ServiceDetailGuideProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
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
      title={t('tourGuides.serviceDetail.title')}
      currentStep={step}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onPrev={handlePrev}
      onClose={onClose}
    >
      {/* ── Step 0: 대시보드 탭 ── */}
      {step === 0 && (
        <>
          <StepTitle>{t('tourGuides.serviceDetail.step0.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step0.desc') }} />
            <div className="mt-2 space-y-1.5">
              <div>• <span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step0.activeUsers') }} /></div>
              <div>• <span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step0.dauMau') }} /></div>
              <div>• <span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step0.todayRequests') }} /></div>
              <div>• <span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step0.todayTokens') }} /></div>
              <div>• <span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step0.charts') }} /></div>
            </div>
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step0.tip') }} /></Tip>
        </>
      )}

      {/* ── Step 1: 모델 관리 탭 ── */}
      {step === 1 && (
        <>
          <StepTitle>{t('tourGuides.serviceDetail.step1.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step1.desc') }} />
            <div className="mt-2 space-y-2">
              <div className="p-2.5 bg-blue-50 rounded-lg">
                <span className="font-semibold text-blue-800">{t('tourGuides.serviceDetail.step1.aliasLabel')}</span>
                <p className="text-xs text-blue-700 mt-0.5" dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step1.aliasDesc') }} />
              </div>
              <div className="p-2.5 bg-amber-50 rounded-lg">
                <span className="font-semibold text-amber-800">{t('tourGuides.serviceDetail.step1.fallbackLabel')}</span>
                <p className="text-xs text-amber-700 mt-0.5">{t('tourGuides.serviceDetail.step1.fallbackDesc')}</p>
              </div>
              <div className="p-2.5 bg-green-50 rounded-lg">
                <span className="font-semibold text-green-800">{t('tourGuides.serviceDetail.step1.weightLabel')}</span>
                <p className="text-xs text-green-700 mt-0.5">{t('tourGuides.serviceDetail.step1.weightDesc')}</p>
              </div>
            </div>
          </StepDesc>
          <Tip>{t('tourGuides.serviceDetail.step1.tip')}</Tip>
        </>
      )}

      {/* ── Step 2: 멤버 관리 탭 ── */}
      {step === 2 && (
        <>
          <StepTitle>{t('tourGuides.serviceDetail.step2.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step2.desc') }} />
            <div className="mt-2 space-y-1.5">
              <div>• <span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step2.owner') }} /></div>
              <div>• <span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step2.admin') }} /></div>
              <div>• <span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step2.user') }} /></div>
            </div>
            <p className="mt-2">{t('tourGuides.serviceDetail.step2.searchHint')}</p>
          </StepDesc>
        </>
      )}

      {/* ── Step 3: Rate Limit 탭 ── */}
      {step === 3 && (
        <>
          <StepTitle>{t('tourGuides.serviceDetail.step3.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step3.desc') }} />
            <div className="mt-2 space-y-2">
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">{t('tourGuides.serviceDetail.step3.commonLimit')}</span>
                <p className="text-xs mt-0.5">{t('tourGuides.serviceDetail.step3.commonLimitDesc')}</p>
              </div>
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">{t('tourGuides.serviceDetail.step3.perUserLimit')}</span>
                <p className="text-xs mt-0.5">{t('tourGuides.serviceDetail.step3.perUserLimitDesc')}</p>
              </div>
            </div>
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step3.tip') }} /></Tip>
        </>
      )}

      {/* ── Step 4: curl 테스트 ── */}
      {step === 4 && (
        <>
          <StepTitle>{t('tourGuides.serviceDetail.step4.title')}</StepTitle>
          <StepDesc>
            <p>{t('tourGuides.serviceDetail.step4.desc')}</p>
            <CopyBlock text={`curl -X POST ${origin}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-service-id: ${serviceName || 'your-service-code'}" \\
  -H "x-user-id: ${userId || 'your-id'}" \\
  -d '${JSON.stringify({
    model: 'your-model-alias',
    messages: [{ role: 'user', content: 'Hello' }],
  }, null, 2)}'`} />
            <p className="text-xs text-gray-500 mt-1" dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step4.curlHint') }} />
          </StepDesc>
        </>
      )}

      {/* ── Step 5: 완료 ── */}
      {step === 5 && (
        <>
          <StepTitle>{t('tourGuides.serviceDetail.step5.title')} 🎉</StepTitle>
          <StepDesc>
            <p>{t('tourGuides.serviceDetail.step5.desc')}</p>
            <div className="mt-3 p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="font-semibold text-violet-800">{t('tourGuides.serviceDetail.step5.summaryTitle')}</p>
              <ol className="list-decimal pl-4 mt-1.5 space-y-1 text-violet-700">
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step5.summary1') }} />
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step5.summary2') }} />
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step5.summary3') }} />
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.serviceDetail.step5.summary4') }} />
              </ol>
            </div>
          </StepDesc>
          <Tip>{t('tourGuides.serviceDetail.step5.tip')}</Tip>
        </>
      )}
    </GuidePanel>
  );
}
