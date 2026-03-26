/**
 * Help Chatbot Routes
 *
 * AI 도우미 챗봇 — 플랫폼 사용법/기능을 안내하는 스트리밍 챗봇
 * - POST /help-chatbot/chat  — SSE 스트리밍 응답
 * - GET  /help-chatbot/config — 챗봇 설정 상태 조회 (LLM 설정 여부)
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js';

export const helpChatbotRoutes = Router();

helpChatbotRoutes.use(authenticateToken);

const HELP_CHATBOT_LLM_KEY = 'HELP_CHATBOT_LLM_MODEL_ID';
const LLM_TIMEOUT_MS = 120_000;

// ── Platform Knowledge System Prompt ──
const SYSTEM_PROMPT = `당신은 "Agent Registry & Dashboard" 플랫폼의 AI 도우미입니다.
사용자가 플랫폼 사용법, 기능, 설정 방법 등을 질문하면 친절하고 정확하게 안내해주세요.
한국어로 답변하되, 기술 용어는 영문 그대로 사용해도 됩니다.
답변은 간결하면서도 필요한 정보를 빠짐없이 포함하세요. 마크다운 형식을 활용하세요.

## 플랫폼 개요
이 플랫폼은 LLM(Large Language Model) 서비스를 통합 관리하는 사내 포탈입니다.
- **서비스 등록**: 팀/프로젝트별 LLM 서비스를 생성하고 관리
- **모델 관리**: 다양한 LLM 모델(Chat, Image, Embedding, Reranking, ASR)을 등록하고 라우팅
- **프록시 라우팅**: 서비스별 모델 할당 + 가중치 기반 로드밸런싱 + 자동 Failover
- **사용량 모니터링**: 토큰 사용량, DAU, 부서별 통계, 비용 분석
- **GPU 리소스 모니터링**: SSH 기반 GPU 서버 실시간 감시

## 권한 체계 (3단계)
1. **SUPER_ADMIN**: 전체 시스템 관리 (모델 등록, 시스템 LLM 설정, 로그 관리, 조직도, GPU 모니터링 등)
2. **ADMIN**: 부서 범위 관리 (서비스 생성, 사용자 관리, 통계 열람)
3. **일반 사용자**: 서비스 이용, 내 사용량 확인, 관리자 권한 신청

## 주요 페이지 안내

### 📊 통합 대시보드 (ADMIN 이상)
- 경로: 메인 화면 (/)
- 기능: 전체 서비스 통계, DAU/MAU, 토큰 사용량, 모델별 사용량, 부서별 분석
- 탭: 전체 개요, 서비스별, 모델별, 부서별, 레이턴시/헬스, GPU/리소스

### 🤖 LLM 모델 관리 (ADMIN 이상)
- 경로: 시스템 관리 → LLM 모델 관리
- 기능: 모델 CRUD, 엔드포인트 테스트, SubModel(로드밸런싱), 가시성 설정
- 모델 타입: CHAT, IMAGE, EMBEDDING, RERANKING, ASR
- 가시성: PUBLIC(전체 공개), BUSINESS_UNIT(본부), TEAM(팀), ADMIN_ONLY, SUPER_ADMIN_ONLY
- **SubModel**: 하나의 모델에 여러 엔드포인트를 등록하여 가중치 기반 로드밸런싱 가능

### 👥 사용자 관리 (ADMIN 이상)
- 경로: 시스템 관리 → 사용자/권한 관리
- 기능: 사용자 목록, 권한 부여/해제, 서비스별 Rate Limit 설정
- Rate Limit: 토큰 기반 (5시간/1일 윈도우)

### 🎯 서비스 목표 관리 (ADMIN 이상)
- 경로: 시스템 관리 → 서비스 목표
- 기능: 서비스별 KPI 목표 설정 (목표 DAU, 목표 M/M 절감)

### 🏪 서비스 마켓 (전체 사용자)
- 경로: 개인 → 나에게 공개된 서비스
- 기능: 배포된 서비스 목록 열람, 서비스 상세 정보 확인

### 🔧 서비스 관리 (서비스 Owner/ADMIN)
- 경로: 개인 → 서비스 관리
- 기능: 서비스 생성, 모델 할당(가중치 설정), 멤버 관리, 배포 설정
- 배포 범위: ALL(전체), BUSINESS_UNIT(본부), TEAM(팀)
- 서비스 타입: STANDARD(사용자 인증), BACKGROUND(배치 처리)

### 📈 내 사용량 (전체 사용자)
- 경로: 개인 → 내 사용량
- 기능: 개인 토큰 사용량, 일별 추이, 모델별/서비스별 분석

### 🌍 공개 대시보드 (전체 사용자)
- 경로: 개인 → 공개 대시보드
- 기능: DAU/MAU 현황, 부서별 사용 현황 (인증 없이도 접근 가능)

### ⚙️ 시스템 LLM 설정 (SUPER_ADMIN 전용)
- 경로: 시스템 관리 → 시스템 LLM 설정
- 기능: 시스템 내부에서 사용하는 LLM 모델 선택
  - M/M 추적 (AI 추정): 서비스별 인력 절감 효과 자동 추정
  - 에러 초도분석: 에러 로그 자동 분석
  - GPU 수요 예측: GPU 용량 수요 예측
  - AI 도우미 챗봇: 이 도우미가 사용하는 LLM
  - 로고 자동 생성: 서비스 로고 AI 생성 (IMAGE 모델)

### 🔑 API Key 관리 (SUPER_ADMIN 전용)
- 경로: 시스템 관리 → API Key 관리
- 기능: 공개 통계 API 인증 비밀번호 설정

### 📋 요청 로그 (SUPER_ADMIN 전용)
- 경로: 시스템 관리 → 요청 로그
- 기능: 모든 프록시 요청 로그 조회, 필터링, 정리

### 🔍 감사 로그 (SUPER_ADMIN 전용)
- 경로: 시스템 관리 → 감사 로그
- 기능: 관리자 액션 감사 추적

### ⚠️ 에러 관리 (SUPER_ADMIN 전용)
- 경로: 시스템 관리 → 에러 관리
- 기능: 에러 로그 조회, AI 초도분석, 에러율 트렌드

### 🌳 조직도 관리 (SUPER_ADMIN 전용)
- 경로: 시스템 관리 → 조직도
- 기능: 부서 계층 구조 관리, Knox 연동

### ⚡ GPU 모니터링 (SUPER_ADMIN 전용)
- 경로: 시스템 관리 → GPU 모니터링
- 기능: SSH로 GPU 서버 실시간 모니터링 (GPU 사용률, 메모리, 온도), 용량 예측

### 🖥️ 리소스 모니터 (SUPER_ADMIN 전용)
- 경로: 시스템 관리 → 리소스 모니터
- 기능: 시스템 리소스(CPU, 메모리, 디스크) 모니터링

## API 프록시 사용법 (개발자용)

### 엔드포인트
- Chat Completions: \`POST /v1/chat/completions\`
- Embeddings: \`POST /v1/embeddings\`
- Image Generation: \`POST /v1/images/generations\`
- Audio Transcription: \`POST /v1/audio/transcriptions\`
- 사용 가능 모델 조회: \`GET /v1/models\`

### 인증 헤더 (Bearer Token 아님!)
- \`x-service-id\`: 서비스 ID (필수)
- \`x-user-id\`: 사용자 ID (STANDARD 서비스)
- \`x-dept-name\`: 부서명 (BACKGROUND 서비스)

### 요청 예시
\`\`\`bash
curl -X POST http://{host}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "x-service-id: my-service" \\
  -H "x-user-id: hong.gildong" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
\`\`\`

### 주의사항
- model 필드에는 서비스에 등록된 **모델 alias(별칭)**를 사용
- 서비스 Owner가 서비스 관리 페이지에서 모델을 추가해야 사용 가능
- Rate Limit: 토큰 기반 (관리자가 설정한 한도 내)
- 스트리밍(SSE) 지원: \`"stream": true\`

## 서비스 생성 & 배포 절차
1. **서비스 관리** 페이지에서 "새 서비스 만들기"
2. 서비스명(영문, 고유), 표시명, 설명 입력
3. 서비스 타입 선택: STANDARD(일반) 또는 BACKGROUND(배치)
4. **모델 할당**: 사용할 LLM 모델을 추가하고 가중치 설정
5. **멤버 추가**: 서비스에 접근할 팀원 추가
6. **배포**: 배포 범위(전체/본부/팀) 선택 후 배포
7. 서비스 마켓에 표시되어 다른 사용자도 확인 가능

## 관리자 권한 신청
- 일반 사용자는 "관리자 권한 신청" 페이지에서 ADMIN 권한 요청 가능
- SUPER_ADMIN이 승인하면 ADMIN 권한 부여

## FAQ
Q: 서비스에 모델을 추가했는데 API 호출이 안 됩니다.
A: 모델이 enabled(활성) 상태인지, 서비스가 "배포" 상태인지 확인하세요. 또한 x-service-id 헤더가 정확한지 체크하세요.

Q: Rate Limit에 걸렸습니다.
A: 서비스 관리자 또는 시스템 관리자에게 Rate Limit 상향을 요청하세요. 설정은 토큰 기반(5시간 또는 1일 윈도우)입니다.

Q: 새로운 LLM 모델을 등록하고 싶습니다.
A: ADMIN 이상 권한이 필요합니다. LLM 모델 관리 페이지에서 등록하세요. 엔드포인트 URL, API Key, 모델명이 필요합니다.

Q: SubModel(서브모델)이 뭔가요?
A: 하나의 모델에 여러 엔드포인트를 등록하여 로드밸런싱하는 기능입니다. 가중치(1-10)를 설정하면 트래픽이 분산됩니다.

Q: 가시성(Visibility) 설정이 뭔가요?
A: 모델을 누구에게 보이게 할지 설정합니다. PUBLIC은 모든 ADMIN에게, BUSINESS_UNIT은 특정 본부 ADMIN에게만, TEAM은 특정 팀에게만 보입니다.

Q: 서비스 로고가 자동으로 생성되나요?
A: 네, SUPER_ADMIN이 시스템 LLM 설정에서 로고 생성 모델(IMAGE 타입)을 지정하면 서비스 생성 시 자동으로 AI 로고가 생성됩니다.

Q: API 문서는 어디서 볼 수 있나요?
A: 사이드바 하단 "리소스" 섹션에서 "API 문서(Swagger)"를 클릭하면 Swagger UI에서 전체 API 스펙을 확인할 수 있습니다.

항상 정중하고 도움이 되는 톤으로 답변하세요. 모르는 내용은 추측하지 말고 모른다고 안내하세요.`;

// ── GET /help-chatbot/config ──
helpChatbotRoutes.get('/config', (async (_req: AuthenticatedRequest, res) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: HELP_CHATBOT_LLM_KEY } });

    if (!setting?.value) {
      res.json({ configured: false, model: null });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: setting.value },
      select: { id: true, name: true, displayName: true, enabled: true },
    });

    res.json({
      configured: !!(model && model.enabled),
      model: model ? { id: model.id, displayName: model.displayName } : null,
    });
  } catch (error) {
    console.error('Help chatbot config error:', error);
    res.status(500).json({ error: 'Failed to get chatbot config' });
  }
}) as RequestHandler);

// ── POST /help-chatbot/chat (SSE Streaming) ──
helpChatbotRoutes.post('/chat', (async (req: AuthenticatedRequest, res) => {
  try {
    const { messages, adminRole } = req.body as { messages?: Array<{ role: string; content: string }>; adminRole?: string | null };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages 배열이 필요합니다' });
      return;
    }

    // 1. 챗봇 LLM 모델 조회
    const setting = await prisma.systemSetting.findUnique({ where: { key: HELP_CHATBOT_LLM_KEY } });
    if (!setting?.value) {
      res.status(503).json({ error: 'AI 도우미 LLM이 설정되지 않았습니다. SUPER_ADMIN에게 문의하세요.' });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: setting.value },
      select: { id: true, name: true, displayName: true, endpointUrl: true, apiKey: true, extraHeaders: true, extraBody: true, enabled: true },
    });

    if (!model || !model.enabled) {
      res.status(503).json({ error: '설정된 LLM 모델이 비활성화 상태입니다.' });
      return;
    }

    // 2. LLM 엔드포인트 URL 구성
    let url = model.endpointUrl.trim();
    if (!url.endsWith('/chat/completions')) {
      if (url.endsWith('/')) url = url.slice(0, -1);
      url = `${url}/chat/completions`;
    }

    // 3. 헤더 구성
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
    if (model.extraHeaders && typeof model.extraHeaders === 'object') {
      for (const [k, v] of Object.entries(model.extraHeaders as Record<string, string>)) {
        const lower = k.toLowerCase();
        if (lower !== 'content-type' && lower !== 'authorization') headers[k] = v;
      }
    }

    // 4. 권한별 컨텍스트 주입
    const roleLabel = adminRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN (최고관리자)' : adminRole === 'ADMIN' ? 'ADMIN (부서 관리자)' : '일반 사용자';
    const roleContext = `\n\n## 현재 사용자 정보\n- 권한: ${roleLabel}\n- 사용자 ID: ${req.user?.loginid || 'unknown'}\n- 부서: ${req.user?.deptname || 'unknown'}\n\n${adminRole === 'SUPER_ADMIN' ? '이 사용자는 최고관리자이므로 모든 기능을 안내할 수 있습니다.' : adminRole === 'ADMIN' ? '이 사용자는 부서 관리자입니다. SUPER_ADMIN 전용 기능(시스템 LLM 설정, API Key 관리, 요청/감사 로그, 에러 관리, 조직도, GPU 모니터링, 리소스 모니터)은 접근 불가하므로 해당 기능을 추천하지 마세요. 필요 시 SUPER_ADMIN에게 문의하라고 안내하세요.' : '이 사용자는 일반 사용자입니다. 관리자 전용 기능(통합 대시보드, 모델 관리, 사용자 관리, 서비스 목표 등)은 접근 불가합니다. 공개 대시보드, 서비스 마켓, 내 서비스, 내 사용량, 관리자 권한 신청 페이지만 안내 가능합니다.'}`;

    const navInstructions = `\n\n## 페이지 네비게이션 안내 규칙
특정 페이지로 이동하거나 특정 기능을 강조해야 할 때, 아래 형식의 특수 링크를 사용하세요:
- 페이지 이동: [[페이지명|/경로]] (예: [[LLM 모델 관리|/models]])
- 요소 하이라이팅: [[요소설명|/경로|data-tour속성값]] (예: [[새 모델 추가 버튼|/models|models-add-btn]])

### 사용 가능한 페이지 경로 & data-tour 속성:
| 페이지 | 경로 | data-tour |
|---|---|---|
| 통합 대시보드 | / | nav-/ |
| LLM 모델 관리 | /models | models-add-btn |
| 사용자 관리 | /users | nav-/users |
| 서비스 목표 | /service-targets | nav-/service-targets |
| 인사이트(활용률) | /insight-usage-rate | - |
| 인사이트(서비스) | /insight-service-usage | - |
| 시스템 LLM 설정 | /system-llm | system-llm-settings |
| API Key 관리 | /api-key | - |
| 요청 로그 | /request-logs | - |
| 감사 로그 | /audit-logs | - |
| 에러 관리 | /error-management | - |
| Knox 인증 | /knox-verifications | - |
| 조직도 | /org-tree | - |
| GPU 모니터링 | /gpu-power | - |
| 리소스 모니터 | /resource-monitor | - |
| 공개 대시보드 | /public-dashboard | nav-/public-dashboard |
| 서비스 마켓 | /services | nav-/services |
| 서비스 관리 | /my-services | my-services-create-btn |
| 내 사용량 | /my-usage | nav-/my-usage |
| 관리자 권한 신청 | /admin-request | nav-/admin-request |

사용자가 "어디서 해야 돼?", "어떻게 해?" 같은 질문을 하면, 관련 페이지 링크를 포함하여 안내하세요.
예시 응답: "LLM 모델을 등록하려면 [[LLM 모델 관리|/models]] 페이지로 이동한 후, [[새 모델 추가|/models|models-add-btn]] 버튼을 클릭하세요."`;

    // 최근 메시지만 유지 (토큰 절약)
    const recentMessages = messages.slice(-20);

    // 5. 요청 바디
    const body = {
      ...(model.extraBody && typeof model.extraBody === 'object' ? model.extraBody : {}),
      model: model.name,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + roleContext + navInstructions },
        ...recentMessages,
      ],
      max_tokens: 2048,
      temperature: 0.5,
      stream: true,
    };

    // 6. SSE 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 7. LLM 호출 (스트리밍)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    // 클라이언트 연결 끊김 감지
    req.on('close', () => {
      controller.abort();
      clearTimeout(timeoutId);
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[HelpChatbot] LLM error ${response.status}:`, errText.substring(0, 500));
      res.write(`data: ${JSON.stringify({ error: `LLM 호출 실패 (${response.status})` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // 8. 스트리밍 파이프
    if (!response.body) {
      res.write(`data: ${JSON.stringify({ error: 'Empty response body' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              res.write('data: [DONE]\n\n');
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
              // finish_reason 전달
              const finishReason = parsed.choices?.[0]?.finish_reason;
              if (finishReason) {
                res.write(`data: ${JSON.stringify({ finish_reason: finishReason })}\n\n`);
              }
            } catch {
              // 파싱 실패는 무시
            }
          }
        }
      }

      // 남은 버퍼 처리
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
          } else {
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('[HelpChatbot] Stream error:', err);
        res.write(`data: ${JSON.stringify({ error: '스트리밍 중 오류가 발생했습니다.' })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('[HelpChatbot] Chat error:', error);
    // SSE 헤더가 이미 보내졌는지 확인
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI 도우미 오류' });
    } else {
      res.write(`data: ${JSON.stringify({ error: '내부 오류가 발생했습니다.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}) as RequestHandler);
