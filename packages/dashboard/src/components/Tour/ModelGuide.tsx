import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import GuidePanel, { StepTitle, StepDesc, FieldGuide, Tip, Warning, CopyBlock } from './GuidePanel';
import { useHighlight } from '../../hooks/useHighlight';

interface ModelGuideProps {
  onClose: () => void;
  onOpenCreateModal: () => void;
  userId?: string;
  deptName?: string;
}

interface SavedModel {
  name: string;
  displayName: string;
  endpointUrl: string;
  type: string;
}

const TOTAL_STEPS = 9;

export default function ModelGuide({ onClose, onOpenCreateModal, userId }: ModelGuideProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  const [savedModel, setSavedModel] = useState<SavedModel | null>(null);

  // step 8: 새로 등록된 모델 카드 하이라이트
  useHighlight(
    savedModel ? `[data-model-name="${savedModel.name}"]` : null,
    step === 8,
  );
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail as SavedModel;
    setSavedModel(detail);
    setError(null);
    setStep(7); // 완료 스텝
  }, []);

  const handleError = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    setError(detail?.error || t('tourGuides.model.saveFailed'));
  }, []);

  useEffect(() => {
    window.addEventListener('model-guide-success', handleSuccess);
    window.addEventListener('model-guide-error', handleError);
    return () => {
      window.removeEventListener('model-guide-success', handleSuccess);
      window.removeEventListener('model-guide-error', handleError);
    };
  }, [handleSuccess, handleError]);

  const handleNext = () => {
    if (step === 0) {
      onOpenCreateModal();
      setStep(1);
    } else if (step === 6) {
      // 저장 스텝: "다음" 클릭 불가 — 저장 성공 이벤트로만 진행
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

  const origin = window.location.origin;

  return (
    <GuidePanel
      title={t('tourGuides.model.title')}
      currentStep={step}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onPrev={handlePrev}
      onClose={onClose}
      nextLabel={step === 0 ? t('tourGuides.model.openCreateModal') : step === 6 ? t('tourGuides.model.pleaseSave') : step === TOTAL_STEPS - 1 ? t('tourGuides.model.done') : undefined}
      nextDisabled={step === 6}
    >
      {/* ── Step 0: 시작 ── */}
      {step === 0 && (
        <>
          <StepTitle>{t('tourGuides.model.step0.title')}</StepTitle>
          <StepDesc>
            <p>{t('tourGuides.model.step0.desc1')}</p>
            <p className="mt-2">{t('tourGuides.model.step0.desc2')}</p>
            <ul className="list-disc pl-4 space-y-1 mt-1">
              <li>{t('tourGuides.model.step0.bullet1')}</li>
              <li>{t('tourGuides.model.step0.bullet2')}</li>
              <li>{t('tourGuides.model.step0.bullet3')}</li>
              <li>{t('tourGuides.model.step0.bullet4')}</li>
            </ul>
          </StepDesc>
          <Tip>{t('tourGuides.model.step0.tip')}</Tip>
        </>
      )}

      {/* ── Step 1: 모델 유형 ── */}
      {step === 1 && (
        <>
          <StepTitle>{t('tourGuides.model.step1.title')}</StepTitle>
          <StepDesc>
            <p>{t('tourGuides.model.step1.desc')}</p>
            <div className="mt-2 space-y-1.5">
              <div><span className="font-semibold text-blue-600">CHAT</span> — {t('tourGuides.model.step1.chatDesc')}</div>
              <div><span className="font-semibold text-pink-600">IMAGE</span> — {t('tourGuides.model.step1.imageDesc')}</div>
              <div><span className="font-semibold text-emerald-600">EMBEDDING</span> — {t('tourGuides.model.step1.embeddingDesc')}</div>
              <div><span className="font-semibold text-amber-600">RERANKING</span> — {t('tourGuides.model.step1.rerankingDesc')}</div>
              <div><span className="font-semibold text-sky-600">ASR</span> — {t('tourGuides.model.step1.asrDesc')}</div>
            </div>
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step1.tip') }} /></Tip>
        </>
      )}

      {/* ── Step 2: 기본 정보 ── */}
      {step === 2 && (
        <>
          <StepTitle>{t('tourGuides.model.step2.title')}</StepTitle>
          <StepDesc>
            <FieldGuide
              label={t('tourGuides.model.step2.modelId')}
              desc={t('tourGuides.model.step2.modelIdDesc')}
              example="gpt-4o, claude-3-5-sonnet"
            />
            <FieldGuide
              label={t('tourGuides.model.step2.displayName')}
              desc={t('tourGuides.model.step2.displayNameDesc')}
              example="GPT-4o, Claude 3.5 Sonnet"
            />
            <FieldGuide
              label={t('tourGuides.model.step2.endpointUrl')}
              desc={t('tourGuides.model.step2.endpointUrlDesc')}
              example="https://api.openai.com/v1"
            />
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step2.tip') }} /></Tip>
          <Warning>{t('tourGuides.model.step2.warning')}</Warning>
        </>
      )}

      {/* ── Step 3: API 키 & 옵션 ── */}
      {step === 3 && (
        <>
          <StepTitle>{t('tourGuides.model.step3.title')}</StepTitle>
          <StepDesc>
            <FieldGuide
              label={t('tourGuides.model.step3.apiKey')}
              desc={t('tourGuides.model.step3.apiKeyDesc')}
              example="sk-..."
            />
            <FieldGuide
              label={t('tourGuides.model.step3.maxTokens')}
              desc={t('tourGuides.model.step3.maxTokensDesc')}
              example={t('tourGuides.model.step3.maxTokensExample')}
            />
            <FieldGuide
              label={t('tourGuides.model.step3.scope')}
              desc={t('tourGuides.model.step3.scopeDesc')}
            />
            <div className="mt-2 space-y-1">
              <div><span className="font-semibold">{t('tourGuides.model.step3.scopePublic')}</span> — {t('tourGuides.model.step3.scopePublicDesc')}</div>
              <div><span className="font-semibold">{t('tourGuides.model.step3.scopeDept')}</span> — {t('tourGuides.model.step3.scopeDeptDesc')}</div>
              <div><span className="font-semibold">{t('tourGuides.model.step3.scopeAdmin')}</span> — {t('tourGuides.model.step3.scopeAdminDesc')}</div>
            </div>
          </StepDesc>
          <Tip>{t('tourGuides.model.step3.tip')}</Tip>
        </>
      )}

      {/* ── Step 4: 테스트 ── */}
      {step === 4 && (
        <>
          <StepTitle>{t('tourGuides.model.step4.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step4.desc') }} />
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1.5">
              <p className="font-semibold text-gray-800">{t('tourGuides.model.step4.chatTestTitle')}</p>
              <div>• <span className="text-green-600">{t('tourGuides.model.step4.chatCompletion')}</span> — {t('tourGuides.model.step4.chatCompletionDesc')}</div>
              <div>• <span className="text-green-600">{t('tourGuides.model.step4.toolCall')}</span> — {t('tourGuides.model.step4.toolCallDesc')}</div>
              <p className="text-xs text-gray-500 mt-2" dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step4.minPass') }} />
            </div>
          </StepDesc>
          <Warning>
            {t('tourGuides.model.step4.warningTitle')}
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              <li>{t('tourGuides.model.step4.warningUrl')}</li>
              <li>{t('tourGuides.model.step4.warningApiKey')}</li>
              <li>{t('tourGuides.model.step4.warningToolCall')}</li>
              <li>{t('tourGuides.model.step4.warningNetwork')}</li>
            </ul>
          </Warning>
          <Tip>{t('tourGuides.model.step4.tip')}</Tip>
        </>
      )}

      {/* ── Step 5: Vision 옵션 (해당 시) ── */}
      {step === 5 && (
        <>
          <StepTitle>{t('tourGuides.model.step5.title')}</StepTitle>
          <StepDesc>
            <p>{t('tourGuides.model.step5.desc')}</p>
            <div className="mt-2 space-y-2">
              <div>
                <span className="font-semibold">{t('tourGuides.model.step5.visionSupport')}</span> — {t('tourGuides.model.step5.visionDesc')}
                <div className="text-xs text-gray-500 mt-0.5">{t('tourGuides.model.step5.visionHint')}</div>
              </div>
              <div>
                <span className="font-semibold">{t('tourGuides.model.step5.activeLabel')}</span> — {t('tourGuides.model.step5.activeDesc')}
              </div>
              <div>
                <span className="font-semibold">{t('tourGuides.model.step5.sortOrder')}</span> — {t('tourGuides.model.step5.sortOrderDesc')}
              </div>
            </div>
          </StepDesc>
          <Tip>{t('tourGuides.model.step5.tip')}</Tip>
        </>
      )}

      {/* ── Step 6: 저장 ── */}
      {step === 6 && (
        <>
          <StepTitle>{t('tourGuides.model.step6.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step6.desc') }} />
            {error && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="font-semibold text-red-700">❌ {t('tourGuides.model.step6.saveFailed')}</p>
                <p className="text-red-600 mt-1">{error}</p>
                <div className="mt-2 text-red-600">
                  <p className="font-medium">{t('tourGuides.model.step6.resolution')}</p>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {error.includes('이미 존재') && <li>{t('tourGuides.model.step6.alreadyExists')}</li>}
                    {error.includes('필수') && <li>{t('tourGuides.model.step6.requiredField')}</li>}
                    {error.includes('test') && <li>{t('tourGuides.model.step6.testFirst')}</li>}
                    <li>{t('tourGuides.model.step6.retryInfo')}</li>
                  </ul>
                </div>
              </div>
            )}
            {!error && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1">
                <p className="font-medium text-gray-700">{t('tourGuides.model.step6.checklist')}</p>
                <div>✅ {t('tourGuides.model.step6.checkId')}</div>
                <div>✅ {t('tourGuides.model.step6.checkTest')}</div>
              </div>
            )}
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step6.tip') }} /></Tip>
        </>
      )}

      {/* ── Step 7: 완료 + curl ── */}
      {step === 7 && (
        <>
          <StepTitle>🎉 {t('tourGuides.model.step7.title')}</StepTitle>
          <StepDesc>
            {savedModel && (
              <div className="p-3 bg-green-50 rounded-lg border border-green-200 space-y-1">
                <div><span className="font-medium text-green-800">{t('tourGuides.model.step7.modelLabel')}</span> {savedModel.displayName} ({savedModel.name})</div>
                <div><span className="font-medium text-green-800">{t('tourGuides.model.step7.endpointLabel')}</span> {savedModel.endpointUrl}</div>
                <div><span className="font-medium text-green-800">{t('tourGuides.model.step7.typeLabel')}</span> {savedModel.type}</div>
              </div>
            )}

            <p className="mt-3 font-semibold text-gray-800">📋 {t('tourGuides.model.step7.curlDirect')}</p>
            <p className="text-xs text-gray-500 mb-1" dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step7.tokenHint') }} />
            <CopyBlock text={`curl -X POST ${origin}/api/admin/models/test \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    endpointUrl: savedModel?.endpointUrl || 'https://api.example.com/v1',
    modelName: savedModel?.name || 'your-model',
    apiKey: 'your-api-key',
  }, null, 2)}'`} />

            <p className="font-semibold text-gray-800">📋 {t('tourGuides.model.step7.curlProxy')}</p>
            <CopyBlock text={`curl -X POST ${origin}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-service-id: your-service-name" \\
  -H "x-user-id: ${userId || 'your-id'}" \\
  -d '${JSON.stringify({
    model: savedModel?.name || 'your-model',
    messages: [{ role: 'user', content: 'Hello' }],
  }, null, 2)}'`} />

            <div className="mt-3 p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="font-semibold text-violet-800">📌 {t('tourGuides.model.step7.nextStepsTitle')}</p>
              <ol className="list-decimal pl-4 mt-1.5 space-y-1 text-violet-700">
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step7.nextStep1') }} />
                <li dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step7.nextStep2') }} />
                <li>{t('tourGuides.model.step7.nextStep3')}</li>
              </ol>
            </div>
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step7.tip') }} /></Tip>
        </>
      )}

      {/* ── Step 8: 모델 행 하이라이트 ── */}
      {step === 8 && (
        <>
          <StepTitle>{t('tourGuides.model.step8.title')}</StepTitle>
          <StepDesc>
            <p dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step8.desc', { modelName: savedModel?.displayName }) }} />
            <div className="mt-3 space-y-2">
              <div className="p-2.5 bg-green-50 rounded-lg">
                <span className="font-semibold text-green-800">🟢 {t('tourGuides.model.step8.healthcheck')}</span>
                <p className="text-xs text-green-700 mt-0.5">{t('tourGuides.model.step8.healthcheckDesc')}</p>
              </div>
              <div className="p-2.5 bg-blue-50 rounded-lg">
                <span className="font-semibold text-blue-800">📋 {t('tourGuides.model.step8.clone')}</span>
                <p className="text-xs text-blue-700 mt-0.5" dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step8.cloneDesc') }} />
              </div>
              <div className="p-2.5 bg-violet-50 rounded-lg">
                <span className="font-semibold text-violet-800">⚡ {t('tourGuides.model.step8.test')}</span>
                <p className="text-xs text-violet-700 mt-0.5">{t('tourGuides.model.step8.testDesc')}</p>
              </div>
            </div>
          </StepDesc>
          <Tip><span dangerouslySetInnerHTML={{ __html: t('tourGuides.model.step8.tip') }} /></Tip>
        </>
      )}
    </GuidePanel>
  );
}
