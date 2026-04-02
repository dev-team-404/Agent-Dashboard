import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GuidePanel, { StepTitle, StepDesc, Tip, Warning } from './GuidePanel';

interface SavedMMGuideProps {
  onClose: () => void;
}

const TOTAL_STEPS = 6;

export default function SavedMMGuide({ onClose }: SavedMMGuideProps) {
  const { t } = useTranslation();
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
      title={t('tourGuides.savedMM.title')}
      currentStep={step}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onPrev={handlePrev}
      onClose={onClose}
    >
      {/* ── Step 0: 개요 ── */}
      {step === 0 && (
        <>
          <StepTitle>{t('tourGuides.savedMM.step0.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step0.desc') }} />
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1.5">
              <p className="font-semibold text-gray-800">{t('tourGuides.savedMM.step0.manageTitle')}</p>
              <div dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step0.manage1') }} />
              <div dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step0.manage2') }} />
              <div dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step0.manage3') }} />
            </div>
          </StepDesc>
          <Tip>{t('tourGuides.savedMM.step0.tip')}</Tip>
        </>
      )}

      {/* ── Step 1: 서비스 목록 이해 ── */}
      {step === 1 && (
        <>
          <StepTitle>{t('tourGuides.savedMM.step1.title')}</StepTitle>
          <StepDesc>
            <p>{t('tourGuides.savedMM.step1.desc')}</p>
            <div className="mt-2 space-y-2">
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">{t('tourGuides.savedMM.step1.mauLabel')}</span>
                <p className="text-xs mt-0.5">{t('tourGuides.savedMM.step1.mauDesc')}</p>
              </div>
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">{t('tourGuides.savedMM.step1.savedMMLabel')}</span>
                <p className="text-xs mt-0.5">{t('tourGuides.savedMM.step1.savedMMDesc')}</p>
              </div>
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">{t('tourGuides.savedMM.step1.aiEstLabel')}</span>
                <p className="text-xs mt-0.5">{t('tourGuides.savedMM.step1.aiEstDesc')}</p>
              </div>
              <div className="p-2.5 bg-gray-50 rounded-lg">
                <span className="font-semibold">{t('tourGuides.savedMM.step1.goalLabel')}</span>
                <p className="text-xs mt-0.5">{t('tourGuides.savedMM.step1.goalDesc')}</p>
              </div>
            </div>
          </StepDesc>
          <Tip>{t('tourGuides.savedMM.step1.tip')}</Tip>
        </>
      )}

      {/* ── Step 2: 부서별 Saved M/M 입력 ── */}
      {step === 2 && (
        <>
          <StepTitle>{t('tourGuides.savedMM.step2.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step2.desc1') }} />
            <p className="mt-2">{t('tourGuides.savedMM.step2.desc2')}</p>
            <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="font-semibold text-blue-800">{t('tourGuides.savedMM.step2.inputTitle')}</p>
              <ol className="list-decimal pl-4 mt-1.5 space-y-1 text-blue-700">
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step2.inputStep1') }} />
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step2.inputStep2') }} />
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step2.inputStep3') }} />
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step2.inputStep4') }} />
              </ol>
            </div>
          </StepDesc>
          <Warning>{t('tourGuides.savedMM.step2.warning')}</Warning>
        </>
      )}

      {/* ── Step 3: AI 추정치 이해 ── */}
      {step === 3 && (
        <>
          <StepTitle>{t('tourGuides.savedMM.step3.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step3.desc') }} />
            <div className="mt-2 space-y-2">
              <div className="p-2.5 bg-violet-50 rounded-lg">
                <span className="font-semibold text-violet-800">{t('tourGuides.savedMM.step3.criteriaTitle')}</span>
                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-violet-700 text-xs">
                  <li>{t('tourGuides.savedMM.step3.criteria1')}</li>
                  <li>{t('tourGuides.savedMM.step3.criteria2')}</li>
                  <li>{t('tourGuides.savedMM.step3.criteria3')}</li>
                </ul>
              </div>
              <div className="p-2.5 bg-violet-50 rounded-lg">
                <span className="font-semibold text-violet-800">{t('tourGuides.savedMM.step3.confidenceTitle')}</span>
                <div className="mt-1 space-y-0.5 text-xs text-violet-700">
                  <div dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step3.confidenceHigh') }} />
                  <div dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step3.confidenceMedium') }} />
                  <div dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step3.confidenceLow') }} />
                </div>
              </div>
            </div>
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.savedMM.step3.tip') }} /></Tip>
        </>
      )}

      {/* ── Step 4: 활용 팁 ── */}
      {step === 4 && (
        <>
          <StepTitle>{t('tourGuides.savedMM.step4.title')}</StepTitle>
          <StepDesc>
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-semibold text-gray-800">{t('tourGuides.savedMM.step4.tip1Title')}</p>
                <p className="text-xs mt-1">{t('tourGuides.savedMM.step4.tip1Desc')}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-semibold text-gray-800">{t('tourGuides.savedMM.step4.tip2Title')}</p>
                <p className="text-xs mt-1">{t('tourGuides.savedMM.step4.tip2Desc')}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-semibold text-gray-800">{t('tourGuides.savedMM.step4.tip3Title')}</p>
                <p className="text-xs mt-1">{t('tourGuides.savedMM.step4.tip3Desc')}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="font-semibold text-gray-800">{t('tourGuides.savedMM.step4.tip4Title')}</p>
                <p className="text-xs mt-1">{t('tourGuides.savedMM.step4.tip4Desc')}</p>
              </div>
            </div>
          </StepDesc>
        </>
      )}

      {/* ── Step 5: 완료 ── */}
      {step === 5 && (
        <>
          <StepTitle>{t('tourGuides.savedMM.step5.title')} 🎉</StepTitle>
          <StepDesc>
            <p>{t('tourGuides.savedMM.step5.desc')}</p>
            <div className="mt-3 p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="font-semibold text-violet-800">{t('tourGuides.savedMM.step5.summaryTitle')}</p>
              <ol className="list-decimal pl-4 mt-1.5 space-y-1 text-violet-700">
                <li>{t('tourGuides.savedMM.step5.summary1')}</li>
                <li>{t('tourGuides.savedMM.step5.summary2')}</li>
                <li>{t('tourGuides.savedMM.step5.summary3')}</li>
                <li>{t('tourGuides.savedMM.step5.summary4')}</li>
              </ol>
            </div>
          </StepDesc>
          <Tip>{t('tourGuides.savedMM.step5.tip')}</Tip>
        </>
      )}
    </GuidePanel>
  );
}
