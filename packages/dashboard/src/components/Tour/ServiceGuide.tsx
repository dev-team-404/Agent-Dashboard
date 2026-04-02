import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    setError(detail?.error || t('tourGuides.service.saveFailed'));
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
      title={t('tourGuides.service.title')}
      currentStep={currentStep}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onPrev={handlePrev}
      onClose={onClose}
      nextLabel={
        phase === 'intro' ? t('tourGuides.service.startRegistration') :
        phase === 'success' ? t('tourGuides.service.goToDetailPage') :
        wizardStep === 3 ? t('tourGuides.service.registerService') : undefined
      }
      nextDisabled={false}
    >
      {/* ── intro: 시작 ── */}
      {phase === 'intro' && (
        <>
          <StepTitle>{t('tourGuides.service.intro.title')}</StepTitle>
          <StepDesc>
            <p>{t('tourGuides.service.intro.desc')}</p>
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1.5">
              <p className="font-semibold text-gray-800">{t('tourGuides.service.intro.afterTitle')}</p>
              <div dangerouslySetInnerHTML={{ __html: t('tourGuides.service.intro.dashboard') }} />
              <div dangerouslySetInnerHTML={{ __html: t('tourGuides.service.intro.modelLink') }} />
              <div dangerouslySetInnerHTML={{ __html: t('tourGuides.service.intro.memberMgmt') }} />
              <div dangerouslySetInnerHTML={{ __html: t('tourGuides.service.intro.rateLimit') }} />
              <div dangerouslySetInnerHTML={{ __html: t('tourGuides.service.intro.usageLogs') }} />
            </div>
          </StepDesc>
          <Tip>{t('tourGuides.service.intro.tip')}</Tip>
        </>
      )}

      {/* ── wizard step 0: 기본 정보 ── */}
      {phase === 'wizard' && wizardStep === 0 && (
        <>
          <StepTitle>{t('tourGuides.service.wizard0.title')}</StepTitle>
          <StepDesc>
            <p>{t('tourGuides.service.wizard0.desc')}</p>
            <FieldGuide label={t('tourGuides.service.wizard0.serviceCode')} desc={t('tourGuides.service.wizard0.serviceCodeDesc')} example={t('tourGuides.service.wizard0.serviceCodeExample')} />
            <FieldGuide label={t('tourGuides.service.wizard0.displayName')} desc={t('tourGuides.service.wizard0.displayNameDesc')} example={t('tourGuides.service.wizard0.displayNameExample')} />
            <FieldGuide label={t('tourGuides.service.wizard0.description')} desc={t('tourGuides.service.wizard0.descriptionDesc')} example={t('tourGuides.service.wizard0.descriptionExample')} />
          </StepDesc>
          <Warning><span dangerouslySetInnerHTML={{ __html: t('tourGuides.service.wizard0.warning') }} /></Warning>
          <Tip>{t('tourGuides.service.wizard0.tip')}</Tip>
        </>
      )}

      {/* ── wizard step 1: 서비스 분류 ── */}
      {phase === 'wizard' && wizardStep === 1 && (
        <>
          <StepTitle>{t('tourGuides.service.wizard1.title')}</StepTitle>
          <StepDesc>
            <div className="space-y-2">
              <div>
                <span className="font-semibold">{t('tourGuides.service.wizard1.serviceType')}</span>
                <div className="ml-3 mt-1 space-y-1">
                  <div dangerouslySetInnerHTML={{ __html: t('tourGuides.service.wizard1.standardDesc') }} />
                  <div dangerouslySetInnerHTML={{ __html: t('tourGuides.service.wizard1.backgroundDesc') }} />
                </div>
              </div>
              <div>
                <span className="font-semibold">{t('tourGuides.service.wizard1.apiOnly')}</span> — {t('tourGuides.service.wizard1.apiOnlyDesc')}
              </div>
              <div>
                <span className="font-semibold">{t('tourGuides.service.wizard1.category')}</span> — {t('tourGuides.service.wizard1.categoryDesc')}
              </div>
            </div>
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.service.wizard1.tip') }} /></Tip>
        </>
      )}

      {/* ── wizard step 2: 링크 설정 ── */}
      {phase === 'wizard' && wizardStep === 2 && (
        <>
          <StepTitle>{t('tourGuides.service.wizard2.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.service.wizard2.desc') }} />
            <FieldGuide label={t('tourGuides.service.wizard2.logoUrl')} desc={t('tourGuides.service.wizard2.logoUrlDesc')} example="https://example.com/logo.png" />
            <FieldGuide label={t('tourGuides.service.wizard2.serviceUrl')} desc={t('tourGuides.service.wizard2.serviceUrlDesc')} example="https://my-service.example.com" />
            <FieldGuide label={t('tourGuides.service.wizard2.apiDocUrl')} desc={t('tourGuides.service.wizard2.apiDocUrlDesc')} example="https://docs.example.com/api" />
            <FieldGuide label={t('tourGuides.service.wizard2.jiraTicket')} desc={t('tourGuides.service.wizard2.jiraTicketDesc')} />
          </StepDesc>
        </>
      )}

      {/* ── wizard step 3: 확인 및 등록 ── */}
      {phase === 'wizard' && wizardStep === 3 && (
        <>
          <StepTitle>{t('tourGuides.service.wizard3.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.service.wizard3.desc') }} />
            {error && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="font-semibold text-red-700">❌ {t('tourGuides.service.wizard3.registrationFailed')}</p>
                <p className="text-red-600 mt-1">{error}</p>
                <div className="mt-2 text-red-600">
                  <p className="font-medium">{t('tourGuides.service.wizard3.resolution')}</p>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {error.includes('이미 존재') && <li>{t('tourGuides.service.wizard3.alreadyExists')}</li>}
                    {error.includes('형식') && <li>{t('tourGuides.service.wizard3.formatError')}</li>}
                    <li>{t('tourGuides.service.wizard3.retryInfo')}</li>
                  </ul>
                </div>
              </div>
            )}
            {!error && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1">
                <p className="font-medium text-gray-700">{t('tourGuides.service.wizard3.checklist')}</p>
                <div>✅ {t('tourGuides.service.wizard3.checkCode')}</div>
                <div>✅ {t('tourGuides.service.wizard3.checkCategory')}</div>
                <div>✅ {t('tourGuides.service.wizard3.checkInfo')}</div>
              </div>
            )}
          </StepDesc>
        </>
      )}

      {/* ── success: 등록 완료 ── */}
      {phase === 'success' && (
        <>
          <StepTitle>🎉 {t('tourGuides.service.success.title')}</StepTitle>
          <StepDesc>
            {savedService && (
              <div className="p-3 bg-green-50 rounded-lg border border-green-200 space-y-1">
                <div><span className="font-medium text-green-800">{t('tourGuides.service.success.serviceLabel')}</span> {savedService.displayName} (<code>{savedService.name}</code>)</div>
                <div><span className="font-medium text-green-800">{t('tourGuides.service.success.typeLabel')}</span> {savedService.type === 'BACKGROUND' ? t('tourGuides.service.success.typeBackground') : t('tourGuides.service.success.typeStandard')}</div>
              </div>
            )}
            <p className="mt-3">{t('tourGuides.service.success.moveDesc')}</p>
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.service.success.tip') }} /></Tip>
        </>
      )}
    </GuidePanel>
  );
}
