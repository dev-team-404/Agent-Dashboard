import { useState, useEffect, useCallback } from 'react';
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

function decodeUnicode(str?: string): string {
  if (!str) return '';
  try { return str.includes('\\u') ? JSON.parse(`"${str}"`) : str; } catch { return str; }
}

const TOTAL_STEPS = 9;

export default function ModelGuide({ onClose, onOpenCreateModal, userId, deptName }: ModelGuideProps) {
  const decodedDept = decodeUnicode(deptName);
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
    setError(detail?.error || '저장에 실패했습니다.');
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
      title="LLM 모델 등록 가이드"
      currentStep={step}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onPrev={handlePrev}
      onClose={onClose}
      nextLabel={step === 0 ? '모델 추가 창 열기' : step === 6 ? '저장을 눌러주세요' : step === TOTAL_STEPS - 1 ? '완료' : undefined}
      nextDisabled={step === 6}
    >
      {/* ── Step 0: 시작 ── */}
      {step === 0 && (
        <>
          <StepTitle>LLM 모델을 등록해봅시다</StepTitle>
          <StepDesc>
            <p>이 가이드는 새 LLM 모델을 등록하는 전 과정을 안내합니다.</p>
            <p className="mt-2">가이드가 진행되면:</p>
            <ul className="list-disc pl-4 space-y-1 mt-1">
              <li>모델 추가 창이 자동으로 열립니다</li>
              <li>각 필드에 무엇을 입력해야 하는지 알려드립니다</li>
              <li>테스트와 저장까지 안내합니다</li>
              <li>완료 후 curl 테스트 방법을 알려드립니다</li>
            </ul>
          </StepDesc>
          <Tip>이미 등록된 모델이 있다면, 모델 목록에서 복제 아이콘을 눌러 기존 설정을 복사한 뒤 API 키만 바꿔서 빠르게 추가할 수도 있습니다.</Tip>
        </>
      )}

      {/* ── Step 1: 모델 유형 ── */}
      {step === 1 && (
        <>
          <StepTitle>1. 모델 유형을 선택하세요</StepTitle>
          <StepDesc>
            <p>모달 상단의 유형 버튼 중 하나를 선택합니다.</p>
            <div className="mt-2 space-y-1.5">
              <div><span className="font-semibold text-blue-600">CHAT</span> — 텍스트 대화형 (GPT-4o, Claude 등). 가장 일반적인 유형입니다.</div>
              <div><span className="font-semibold text-pink-600">IMAGE</span> — 이미지 생성 (DALL-E, ComfyUI)</div>
              <div><span className="font-semibold text-emerald-600">EMBEDDING</span> — 텍스트 임베딩 (검색, RAG에 사용)</div>
              <div><span className="font-semibold text-amber-600">RERANKING</span> — 검색 결과 재정렬</div>
              <div><span className="font-semibold text-sky-600">ASR</span> — 음성 인식 (Speech to Text)</div>
            </div>
          </StepDesc>
          <Tip>처음이라면 <strong>CHAT</strong>을 선택하세요. 대부분의 LLM API가 이 유형입니다.</Tip>
        </>
      )}

      {/* ── Step 2: 기본 정보 ── */}
      {step === 2 && (
        <>
          <StepTitle>2. 기본 정보를 입력하세요</StepTitle>
          <StepDesc>
            <FieldGuide
              label="모델 ID"
              desc="시스템 내부에서 사용하는 고유 식별자"
              example="gpt-4o, claude-3-5-sonnet"
            />
            <FieldGuide
              label="표시 이름"
              desc="사용자에게 보여지는 이름"
              example="GPT-4o, Claude 3.5 Sonnet"
            />
            <FieldGuide
              label="엔드포인트 URL"
              desc="LLM API의 base URL (경로 제외)"
              example="https://api.openai.com/v1"
            />
          </StepDesc>
          <Tip><code>/chat/completions</code>, <code>/embeddings</code> 등의 경로는 모델 유형에 따라 <strong>자동으로 추가</strong>됩니다. base URL만 입력하세요.</Tip>
          <Warning>모델 ID는 등록 후 변경할 수 없습니다. 신중하게 입력하세요.</Warning>
        </>
      )}

      {/* ── Step 3: API 키 & 옵션 ── */}
      {step === 3 && (
        <>
          <StepTitle>3. API 키와 옵션을 설정하세요</StepTitle>
          <StepDesc>
            <FieldGuide
              label="API 키"
              desc="인증에 사용할 API 키 (선택사항)"
              example="sk-..."
            />
            <FieldGuide
              label="최대 토큰"
              desc="모델이 처리할 수 있는 최대 토큰 수"
              example="128000 (기본값)"
            />
            <FieldGuide
              label="공개 범위"
              desc="모델을 사용할 수 있는 범위"
            />
            <div className="mt-2 space-y-1">
              <div><span className="font-semibold">전체 공개</span> — 모든 사용자가 사용 가능</div>
              <div><span className="font-semibold">부서 선택</span> — 선택한 부서만 사용 가능</div>
              <div><span className="font-semibold">관리자</span> — 시스템 관리자만 사용 가능</div>
            </div>
          </StepDesc>
          <Tip>Extra Headers나 Extra Body는 커스텀 인증이 필요한 경우에만 사용합니다. 일반적으로는 비워두세요.</Tip>
        </>
      )}

      {/* ── Step 4: 테스트 ── */}
      {step === 4 && (
        <>
          <StepTitle>4. 엔드포인트를 테스트하세요</StepTitle>
          <StepDesc>
            <p>모달 하단의 <strong>'엔드포인트 테스트 실행'</strong> 버튼을 클릭하세요.</p>
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1.5">
              <p className="font-semibold text-gray-800">CHAT 모델 테스트 항목:</p>
              <div>• <span className="text-green-600">Chat Completion</span> — 기본 대화 응답</div>
              <div>• <span className="text-green-600">Tool Call A~D</span> — 함수 호출 능력</div>
              <p className="text-xs text-gray-500 mt-2">5개 중 <strong>최소 2개</strong> 통과해야 저장 가능합니다.</p>
            </div>
          </StepDesc>
          <Warning>
            테스트가 실패하면:
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              <li>엔드포인트 URL이 올바른지 확인</li>
              <li>API 키가 유효한지 확인</li>
              <li>모델이 tool call을 지원하는지 확인</li>
              <li>네트워크 접근이 가능한지 확인</li>
            </ul>
          </Warning>
          <Tip>IMAGE, EMBEDDING, RERANKING, ASR 모델은 각 유형에 맞는 별도 테스트가 실행됩니다.</Tip>
        </>
      )}

      {/* ── Step 5: Vision 옵션 (해당 시) ── */}
      {step === 5 && (
        <>
          <StepTitle>5. Vision 및 추가 옵션</StepTitle>
          <StepDesc>
            <p>CHAT 모델의 경우 추가 옵션을 설정할 수 있습니다.</p>
            <div className="mt-2 space-y-2">
              <div>
                <span className="font-semibold">Vision 지원</span> — 이미지 입력을 처리할 수 있는 모델이면 켜세요.
                <div className="text-xs text-gray-500 mt-0.5">GPT-4o, Claude 3.5 등 최신 모델은 대부분 지원합니다.</div>
              </div>
              <div>
                <span className="font-semibold">활성화</span> — 끄면 모델이 목록에서 숨겨집니다. 점검 시 사용하세요.
              </div>
              <div>
                <span className="font-semibold">정렬 순서</span> — 목록에서의 표시 순서 (숫자가 작을수록 위에 표시)
              </div>
            </div>
          </StepDesc>
          <Tip>Vision을 켜면 별도 Vision 테스트를 추가로 통과해야 합니다.</Tip>
        </>
      )}

      {/* ── Step 6: 저장 ── */}
      {step === 6 && (
        <>
          <StepTitle>6. 저장하세요</StepTitle>
          <StepDesc>
            <p>모든 필수 항목을 입력하고 테스트를 통과했으면, 모달 하단의 <strong>'저장'</strong> 버튼을 클릭하세요.</p>
            {error && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="font-semibold text-red-700">❌ 저장 실패</p>
                <p className="text-red-600 mt-1">{error}</p>
                <div className="mt-2 text-red-600">
                  <p className="font-medium">해결 방법:</p>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {error.includes('이미 존재') && <li>다른 모델 ID를 입력하세요</li>}
                    {error.includes('필수') && <li>빈 필드가 없는지 확인하세요</li>}
                    {error.includes('test') && <li>엔드포인트 테스트를 먼저 통과하세요</li>}
                    <li>입력 정보를 다시 확인하고 '저장'을 다시 눌러주세요</li>
                  </ul>
                </div>
              </div>
            )}
            {!error && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-1">
                <p className="font-medium text-gray-700">필수 확인 사항:</p>
                <div>✅ 모델 ID, 표시 이름, 엔드포인트 URL 입력 완료</div>
                <div>✅ 엔드포인트 테스트 통과 (CHAT: 2개 이상)</div>
              </div>
            )}
          </StepDesc>
          <Tip>저장 후 모델 목록에서 <strong>헬스체크 상태</strong>를 확인할 수 있습니다. 녹색 점이 보이면 정상입니다.</Tip>
        </>
      )}

      {/* ── Step 7: 완료 + curl ── */}
      {step === 7 && (
        <>
          <StepTitle>🎉 모델이 등록되었습니다!</StepTitle>
          <StepDesc>
            {savedModel && (
              <div className="p-3 bg-green-50 rounded-lg border border-green-200 space-y-1">
                <div><span className="font-medium text-green-800">모델:</span> {savedModel.displayName} ({savedModel.name})</div>
                <div><span className="font-medium text-green-800">엔드포인트:</span> {savedModel.endpointUrl}</div>
                <div><span className="font-medium text-green-800">유형:</span> {savedModel.type}</div>
              </div>
            )}

            <p className="mt-3 font-semibold text-gray-800">📋 엔드포인트 직접 테스트 (curl)</p>
            <p className="text-xs text-gray-500 mb-1">브라우저 개발자도구 → Application → localStorage → <code>agent_stats_token</code> 값을 복사하세요.</p>
            <CopyBlock text={`curl -X POST ${origin}/api/admin/models/test \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    endpointUrl: savedModel?.endpointUrl || 'https://api.example.com/v1',
    modelName: savedModel?.name || 'your-model',
    apiKey: 'your-api-key',
  }, null, 2)}'`} />

            <p className="font-semibold text-gray-800">📋 프록시를 통한 호출 (서비스 연동 후)</p>
            <CopyBlock text={`curl -X POST ${origin}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-service-id: your-service-name" \\
  -H "x-user-id: ${userId || 'your-id'}" \\
  -H "x-dept-name: ${decodedDept || 'your-dept'}" \\
  -d '${JSON.stringify({
    model: savedModel?.name || 'your-model',
    messages: [{ role: 'user', content: '안녕하세요' }],
  }, null, 2)}'`} />

            <div className="mt-3 p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="font-semibold text-violet-800">📌 다음 단계</p>
              <ol className="list-decimal pl-4 mt-1.5 space-y-1 text-violet-700">
                <li>모델 목록에서 <strong>헬스체크 초록불</strong>을 확인하세요</li>
                <li><strong>서비스 관리</strong>에서 서비스를 만들고 이 모델을 연동하세요</li>
                <li>연동 후 위 프록시 curl로 테스트하세요</li>
              </ol>
            </div>
          </StepDesc>
          <Tip>같은 엔드포인트에 다른 API 키를 사용하려면, 모델 목록에서 이 모델의 <strong>복제 버튼</strong>을 눌러 쉽게 복사할 수 있습니다.</Tip>
        </>
      )}

      {/* ── Step 8: 모델 행 하이라이트 ── */}
      {step === 8 && (
        <>
          <StepTitle>모델을 확인하세요</StepTitle>
          <StepDesc>
            <p>방금 등록한 <strong>{savedModel?.displayName}</strong> 모델이 목록에서 하이라이트되어 있습니다.</p>
            <div className="mt-3 space-y-2">
              <div className="p-2.5 bg-green-50 rounded-lg">
                <span className="font-semibold text-green-800">🟢 헬스체크</span>
                <p className="text-xs text-green-700 mt-0.5">모델 카드 좌측의 색깔 점이 초록색이면 정상입니다. 10분 간격으로 자동 점검됩니다.</p>
              </div>
              <div className="p-2.5 bg-blue-50 rounded-lg">
                <span className="font-semibold text-blue-800">📋 복제</span>
                <p className="text-xs text-blue-700 mt-0.5">모델 카드의 <strong>'복제'</strong> 버튼을 누르면 설정을 복사해서 API 키만 바꿔 빠르게 추가할 수 있습니다.</p>
              </div>
              <div className="p-2.5 bg-violet-50 rounded-lg">
                <span className="font-semibold text-violet-800">⚡ 테스트</span>
                <p className="text-xs text-violet-700 mt-0.5">재생 버튼(▶)을 눌러 언제든 수동 헬스체크를 실행할 수 있습니다.</p>
              </div>
            </div>
          </StepDesc>
          <Tip>이제 <strong>서비스 관리</strong>에서 서비스를 만들고 이 모델을 연동하면 프록시를 통해 호출할 수 있습니다.</Tip>
        </>
      )}
    </GuidePanel>
  );
}
