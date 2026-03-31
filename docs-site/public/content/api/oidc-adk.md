# Google ADK / Python SDK 연동 가이드

Google ADK(Agent Development Kit) 및 Python SDK에서 Agent Platform OIDC 인증을 연동하여 사용자별 사용량을 자동 추적하는 방법을 안내합니다.

## 개요

ADK나 Python 기반 에이전트에서 LLM을 호출할 때, 각 호출이 **어떤 사용자의 요청인지** 추적해야 합니다. `agent_platform_auth` 모듈을 사용하면 `body.user` 필드가 자동으로 주입되어 사용자별 사용량이 집계됩니다.

> **ADK 버전**: 이 가이드는 ADK **1.x** (최신 1.28.0)과 **2.0 Alpha** (2.0.0a1) 모두 지원합니다. 아래 예제는 1.x/2.0 공통으로 동작하도록 작성되었습니다. 2.0 전용 기능(SequentialAgent, ParallelAgent, LoopAgent)은 별도 섹션에서 다룹니다.

### 연동 방식 비교

| 방식 | 사용 케이스 | 사용자 식별 |
|------|-----------|-----------|
| `setup_auth` (자동 로그인) | 모든 Python 앱 (ADK, LangChain, OpenAI SDK) | 브라우저 OIDC 로그인 → 자동 주입 |
| `set_user` (웹 서비스) | FastAPI + ADK/LangChain 등 | 요청별 사용자 자동 전환 |
| 환경변수 | 배치 작업, CI/CD | 고정 사용자 ID |

> **핵심**: `setup_auth()` 한 번 호출하면 OpenAI SDK, LangChain, ADK 등 **어떤 프레임워크를 쓰든** 모든 LLM 호출에 `body.user`가 자동 주입됩니다. 개발자가 `user=` 파라미터를 수동으로 넣을 필요가 없습니다.

## SDK 다운로드

**[예제 코드 + SDK 전체 다운로드 (zip)](/docs/agent-platform-examples.zip)**

zip에 포함된 파일:

| 파일 | 설명 |
|---|---|
| `agent_platform_auth.py` | OIDC 인증 SDK (프로젝트에 복사) |
| `example_openai.py` | OpenAI SDK 예제 |
| `example_langchain.py` | LangChain 예제 |
| `example_adk.py` | Google ADK 예제 (1.x / 2.0 공용) |
| `example_fastapi.py` | FastAPI 웹 서비스 예제 |

> 외부 패키지 설치 불필요 — Python 표준 라이브러리만 사용합니다. `openai`나 `litellm`이 설치되어 있으면 body.user 자동 주입이 연동됩니다.

## 방법 1: setup_auth (자동 로그인)

모든 Python 앱에서 권장하는 방식입니다. 브라우저를 통해 OIDC 로그인하고, 이후 **모든 LLM 호출에 사용자 정보가 자동으로 주입**됩니다.

### 사용법

```python
# 앱 시작 시 1회 호출
from agent_platform_auth import setup_auth
setup_auth(gateway_url="http://a2g.samsungds.net:8090")

# 이후 모든 LLM 호출에 자동으로 user 주입
```

### 동작 방식

```
① setup_auth() 호출
   └→ 로컬 캐시(~/.agent-platform/credential.json) 확인

② 캐시에 유효한 토큰이 있으면
   └→ 캐시된 사용자 ID 사용 (로그인 생략)

③ 캐시에 토큰이 없거나 만료되었으면
   └→ 로컬 HTTP 서버 시작 (localhost:임의포트)
   └→ 브라우저에서 Auth Server 로그인 페이지 열기
   └→ 사용자 로그인 완료
   └→ Auth Server가 localhost로 Authorization Code 전달
   └→ Code를 Token으로 교환
   └→ 토큰을 로컬 캐시에 저장

④ LiteLLM 콜백(InjectUser) 등록
   └→ 이후 모든 LLM 호출 시 body.user에 사용자 ID 자동 주입
```

### 전체 예시

```python
from agent_platform_auth import setup_auth
from google.adk import Agent

# 1. 인증 설정 (첫 실행 시 브라우저 로그인)
setup_auth(gateway_url="http://a2g.samsungds.net:8090")

# 2. ADK 에이전트 생성 및 실행
agent = Agent(
    model="gpt-4o",
    name="my-agent",
    instruction="You are a helpful assistant.",
)

# 3. 에이전트 실행 — body.user가 자동으로 포함됨
response = agent.run("안녕하세요, 오늘 일정을 알려주세요.")
print(response)
```

## 방법 2: 웹 서비스에서 사용 (FastAPI + ADK)

FastAPI 등 웹 프레임워크와 ADK를 함께 사용할 때, 각 HTTP 요청의 로그인 사용자를 LLM 호출에 연결하는 방식입니다.

### 사용법

```python
from agent_platform_auth import setup_auth, set_user
from fastapi import FastAPI, Request
from google.adk import Agent

app = FastAPI()
agent = Agent(
    model="gpt-4o",
    name="web-agent",
    instruction="You are a helpful assistant.",
)

# 앱 시작 시 1회
setup_auth(gateway_url="http://a2g.samsungds.net:8090")

@app.post("/chat")
async def chat(request: Request):
    # 세션에서 로그인 사용자 가져오기
    user = get_session_user(request)

    # 현재 요청의 사용자 설정 (thread-local)
    set_user(user.loginid)

    # 에이전트 실행 — body.user에 user.loginid가 주입됨
    response = await agent.run(request.json().get("message"))
    return {"response": response}
```

### 동작 방식

```
클라이언트 → FastAPI 서버
           → get_session_user()로 현재 사용자 확인
           → set_user("syngha.han")로 thread-local에 사용자 설정
           → agent.run() 호출
           → LiteLLM 콜백이 thread-local에서 사용자 ID 읽기
           → body.user = "syngha.han" 주입
           → Gateway가 사용자별 사용량 집계
```

> `set_user()`는 thread-local 변수를 사용하므로 동시 요청에서도 사용자가 혼동되지 않습니다.

## 방법 3: 환경변수 (배치/CI)

배치 작업이나 CI/CD 파이프라인처럼 브라우저 로그인이 불가능한 환경에서 사용합니다.

```bash
export PLATFORM_USER=syngha.han
python batch_job.py
```

```python
# batch_job.py
from agent_platform_auth import setup_auth
from google.adk import Agent

# 환경변수 PLATFORM_USER가 설정되어 있으면 브라우저 로그인 생략
setup_auth(gateway_url="http://a2g.samsungds.net:8090")

agent = Agent(
    model="gpt-4o",
    name="batch-agent",
    instruction="Summarize the given data.",
)

# body.user = "syngha.han" (환경변수에서 읽은 값)
response = agent.run("이번 주 사용량 데이터를 요약해주세요.")
```

## agent_platform_auth.py 다운로드

아래 명령어로 SDK를 다운로드하여 프로젝트에 배치합니다.

```bash
curl http://a2g.samsungds.net:8090/sdk/agent_platform_auth.py -o agent_platform_auth.py
```

> **주의**: 아래 내장 코드는 참고용입니다. **반드시 위 명령어로 최신 버전을 다운로드**하세요. SDK는 Python 표준 라이브러리만 사용하며 외부 패키지 설치가 필요 없습니다. `litellm`이나 `openai`가 설치되어 있으면 자동으로 body.user 주입이 연동됩니다.

<details>
<summary>SDK 주요 API 요약 (클릭하여 펼치기)</summary>

| 함수 | 설명 |
|------|------|
| `setup_auth(gateway_url)` | 앱 시작 시 1회 호출. OIDC 로그인 + LiteLLM/OpenAI SDK 자동 패치 |
| `set_user(loginid)` | 웹 서버에서 요청별 사용자 지정 (async-safe, ContextVar 사용) |
| `get_credential()` | 현재 인증 정보 dict 반환 (access_token 포함) |
| `get_headers()` | Gateway 호출용 인증 헤더 반환 (x-user-id, x-service-id, Authorization) |

**인증 우선순위**: ContextVar (`set_user`) → 환경변수 `PLATFORM_USER` → 로컬 캐시 (`~/.agent-platform/credentials.json`) → 브라우저 OIDC 로그인

</details>

<!--
아래 코드는 참고용 스냅샷입니다. 실제 사용 시 반드시 curl로 최신 버전을 다운로드하세요.
-->

```python
# 이 코드는 참고용 스냅샷입니다. 최신 버전은 위 curl 명령어로 다운로드하세요.
"""
Agent Platform Auth — OIDC 인증 및 사용자별 사용량 추적 모듈

사용법:
    from agent_platform_auth import setup_auth, set_user
    setup_auth(gateway_url="http://a2g.samsungds.net:8090")
"""

import json
import os
import threading
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs

import requests

# ---------- 설정 ----------

CACHE_DIR = Path.home() / ".agent-platform"
CACHE_FILE = CACHE_DIR / "credential.json"
CLIENT_ID = "cli-default"

# Thread-local storage for per-request user
_thread_local = threading.local()
_current_user: str | None = None


# ---------- Public API ----------

def setup_auth(gateway_url: str) -> str:
    """
    인증을 설정하고 사용자 ID를 반환합니다.

    1. 환경변수 PLATFORM_USER가 있으면 해당 값 사용
    2. 로컬 캐시에 유효한 토큰이 있으면 캐시된 사용자 사용
    3. 둘 다 없으면 브라우저 OIDC 로그인 수행

    Args:
        gateway_url: Auth Server URL (예: "http://a2g.samsungds.net:8090")

    Returns:
        사용자 ID (예: "syngha.han")
    """
    global _current_user

    # 1. 환경변수 확인
    env_user = os.environ.get("PLATFORM_USER")
    if env_user:
        _current_user = env_user
        _register_litellm_callback()
        print(f"[Agent Platform] 환경변수에서 사용자 설정: {env_user}")
        return env_user

    # 2. 캐시 확인
    cached = _load_cached_credential()
    if cached:
        _current_user = cached
        _register_litellm_callback()
        print(f"[Agent Platform] 캐시된 인증 사용: {cached}")
        return cached

    # 3. 브라우저 OIDC 로그인
    user_id = _do_oidc_login(gateway_url)
    _current_user = user_id
    _register_litellm_callback()
    print(f"[Agent Platform] OIDC 로그인 완료: {user_id}")
    return user_id


def set_user(user_id: str) -> None:
    """
    현재 스레드의 사용자를 설정합니다.
    웹 서비스에서 요청별로 다른 사용자를 지정할 때 사용합니다.

    Args:
        user_id: 사용자 ID (예: "syngha.han")
    """
    _thread_local.user_id = user_id


def get_current_user() -> str | None:
    """현재 스레드의 사용자 ID를 반환합니다."""
    return getattr(_thread_local, "user_id", None) or _current_user


# ---------- 내부 함수 ----------

def _load_cached_credential() -> str | None:
    """로컬 캐시에서 사용자 ID를 로드합니다."""
    if not CACHE_FILE.exists():
        return None
    try:
        data = json.loads(CACHE_FILE.read_text())
        # TODO: 토큰 만료 시간 확인
        return data.get("user_id")
    except (json.JSONDecodeError, KeyError):
        return None


def _save_credential(user_id: str, token: dict) -> None:
    """인증 정보를 로컬 캐시에 저장합니다."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps({
        "user_id": user_id,
        "token": token,
    }, ensure_ascii=False, indent=2))


def _do_oidc_login(gateway_url: str) -> str:
    """
    브라우저를 열어 OIDC 로그인을 수행하고 사용자 ID를 반환합니다.

    1. 로컬 HTTP 서버 시작 (콜백 수신용)
    2. 브라우저에서 Auth Server 로그인 페이지 열기
    3. 로그인 완료 후 Authorization Code 수신
    4. Code를 Token으로 교환
    5. Token에서 사용자 ID 추출
    """
    auth_code_holder = {"code": None}

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            query = parse_qs(urlparse(self.path).query)
            if "code" in query:
                auth_code_holder["code"] = query["code"][0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(
                    b"<html><body><h2>Login successful!</h2>"
                    b"<p>You can close this window.</p></body></html>"
                )
            else:
                self.send_response(400)
                self.end_headers()

        def log_message(self, format, *args):
            pass  # 로그 출력 억제

    # 로컬 콜백 서버 시작
    server = HTTPServer(("localhost", 0), CallbackHandler)
    callback_port = server.server_address[1]
    redirect_uri = f"http://localhost:{callback_port}/callback"

    # 브라우저에서 로그인 페이지 열기
    auth_params = urlencode({
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": "openid profile",
    })
    auth_url = f"{gateway_url}/oidc/authorize?{auth_params}"

    print(f"[Agent Platform] 브라우저에서 로그인해주세요...")
    webbrowser.open(auth_url)

    # Authorization Code 대기
    server.handle_request()
    server.server_close()

    if not auth_code_holder["code"]:
        raise RuntimeError("OIDC 로그인에 실패했습니다.")

    # Code → Token 교환
    token_resp = requests.post(
        f"{gateway_url}/oidc/token",
        data={
            "grant_type": "authorization_code",
            "code": auth_code_holder["code"],
            "redirect_uri": redirect_uri,
            "client_id": CLIENT_ID,
        },
    )
    token_resp.raise_for_status()
    token_data = token_resp.json()

    # UserInfo에서 사용자 ID 추출
    userinfo_resp = requests.get(
        f"{gateway_url}/oidc/userinfo",
        headers={"Authorization": f"Bearer {token_data['access_token']}"},
    )
    userinfo_resp.raise_for_status()
    userinfo = userinfo_resp.json()

    user_id = userinfo["sub"]
    _save_credential(user_id, token_data)

    return user_id


def _register_litellm_callback() -> None:
    """LiteLLM 콜백을 등록하여 모든 LLM 호출에 body.user를 주입합니다."""
    try:
        import litellm

        class InjectUser:
            def pre_call(self, model, messages, kwargs):
                user = get_current_user()
                if user:
                    kwargs.setdefault("user", user)
                return kwargs

        # 기존 콜백에 추가
        if not any(isinstance(cb, InjectUser) for cb in litellm.callbacks):
            litellm.callbacks.append(InjectUser())

    except ImportError:
        # litellm이 설치되지 않은 경우 환경변수로 대체
        user = get_current_user()
        if user:
            os.environ.setdefault("OPENAI_USER", user)
```

## 사용량 추적 원리

모든 방식의 핵심은 동일합니다: LLM API 호출 시 `body.user` 필드에 사용자 ID를 포함시킵니다.

```
LLM 호출 요청:
POST /v1/chat/completions
{
    "model": "gpt-4o",
    "messages": [...],
    "user": "syngha.han"    ← agent_platform_auth가 자동 주입
}

Gateway (:8090) 처리:
  → body.user = "syngha.han" 추출
  → 사용자별 토큰 사용량 기록
  → LLM 서버로 프록시

Dashboard에서 확인:
  → 사용량 분석 → 사용자별 탭에서 "syngha.han"의 사용량 확인
```

## 문제 해결

### 브라우저가 열리지 않는 환경 (SSH 등)

원격 서버에서 작업하는 경우 브라우저가 열리지 않을 수 있습니다.

**해결 방법**: 환경변수 방식을 사용합니다.

```bash
export PLATFORM_USER=syngha.han
python my_agent.py
```

### LiteLLM 콜백이 동작하지 않음

`litellm`이 설치되지 않은 경우 콜백 대신 환경변수 `OPENAI_USER`를 설정합니다. OpenAI SDK를 직접 사용하는 경우에는 수동으로 `user` 파라미터를 전달해야 합니다.

```python
from openai import OpenAI
from agent_platform_auth import get_current_user

client = OpenAI(base_url="http://a2g.samsungds.net:8090/v1", api_key="sk-placeholder")
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "안녕하세요"}],
    user=get_current_user(),  # 수동 주입
)
```

## ADK 2.0 Alpha 전용 기능

ADK 2.0에서 새로 추가된 멀티 에이전트 패턴(SequentialAgent, ParallelAgent, LoopAgent)에서도 동일한 인증 방식이 작동합니다.

> **설치**: `pip install "google-adk[extensions]==2.0.0a1"` (alpha — 운영 사용 주의)

### SequentialAgent (파이프라인)

```python
from google.adk.agents import Agent, SequentialAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from agent_platform_auth import setup_auth

# 1. 인증 (한 번만)
setup_auth(gateway_url="http://a2g.samsungds.net:8090")

# 2. Gateway 연결 LLM
llm = LiteLlm(model="openai/gpt-4o", api_base="http://a2g.samsungds.net:8090/v1")

# 3. 순차 파이프라인: 분석 → 응답
analyzer = Agent(name="analyzer", model=llm, instruction="사용자 요청을 분석합니다.")
responder = Agent(name="responder", model=llm, instruction="분석 결과를 바탕으로 응답합니다.")
pipeline = SequentialAgent(name="pipeline", sub_agents=[analyzer, responder])

# 4. 실행
runner = Runner(agent=pipeline, app_name="my_app", session_service=InMemorySessionService())
```

### ParallelAgent (병렬 처리)

```python
from google.adk.agents import Agent, ParallelAgent
from google.adk.models.lite_llm import LiteLlm
from agent_platform_auth import setup_auth

setup_auth(gateway_url="http://a2g.samsungds.net:8090")

llm = LiteLlm(model="openai/gpt-4o", api_base="http://a2g.samsungds.net:8090/v1")

# 검색과 요약을 동시에 실행
search = Agent(name="search", model=llm, instruction="관련 정보를 검색합니다")
summarize = Agent(name="summarize", model=llm, instruction="정보를 요약합니다")
parallel = ParallelAgent(name="research", sub_agents=[search, summarize])
```

### LoopAgent (반복 검증)

```python
from google.adk.agents import Agent, LoopAgent
from google.adk.models.lite_llm import LiteLlm
from agent_platform_auth import setup_auth

setup_auth(gateway_url="http://a2g.samsungds.net:8090")

llm = LiteLlm(model="openai/gpt-4o", api_base="http://a2g.samsungds.net:8090/v1")

# 결과가 만족스러울 때까지 최대 5회 반복
checker = Agent(name="checker", model=llm, instruction="결과를 검증하고 개선합니다")
loop = LoopAgent(name="verify", sub_agents=[checker], max_iterations=5)
```

### 웹 서비스에서 ADK 2.0 사용 (FastAPI)

```python
from fastapi import FastAPI, Request
from google.adk.agents import Agent, SequentialAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from agent_platform_auth import setup_auth, set_user

app = FastAPI()

# 앱 시작 시 1회
setup_auth(gateway_url="http://a2g.samsungds.net:8090")
llm = LiteLlm(model="openai/gpt-4o", api_base="http://a2g.samsungds.net:8090/v1")
agent = Agent(name="assistant", model=llm, instruction="친절한 AI 어시스턴트")
runner = Runner(agent=agent, app_name="web_app", session_service=InMemorySessionService())

@app.post("/chat")
async def chat(request: Request):
    user = request.headers.get("x-user-id", "anonymous")
    set_user(user)  # ← 이 요청의 사용자 설정 (body.user에 자동 주입)

    session = await runner.session_service.create_session(
        app_name="web_app", user_id=user
    )
    # ... runner.run_async() 호출
    return {"status": "ok"}
```

### ADK 1.x vs 2.0 호환성

| 항목 | ADK 1.x | ADK 2.0 Alpha | 호환 |
|---|---|---|---|
| `Agent(name=..., model=..., instruction=...)` | ✅ | ✅ | 동일 |
| `Runner(agent=..., app_name=..., session_service=...)` | ✅ | ✅ | 동일 |
| `InMemorySessionService` | ✅ | ✅ | 동일 |
| `LiteLlm(model=..., api_base=...)` | ✅ | ✅ (`[extensions]` 필요) | 동일 |
| `setup_auth` / `set_user` | ✅ | ✅ | 동일 |
| `SequentialAgent` | ❌ | ✅ | 2.0 전용 |
| `ParallelAgent` | ❌ | ✅ | 2.0 전용 |
| `LoopAgent` | ❌ | ✅ | 2.0 전용 |

> **핵심**: `agent_platform_auth`의 `setup_auth` / `set_user`는 LiteLLM 콜백 레벨에서 동작하므로 ADK 버전과 무관하게 동일하게 작동합니다.

## 다음 단계

- [OIDC 인증 개요](/docs/api/oidc-overview) — OIDC 인증 체계 전반
- [OIDC 연동 예제 코드](/docs/api/oidc-examples) — Python, JavaScript, LangChain, curl 예제
- [Open WebUI 연동 가이드](/docs/api/oidc-openwebui) — Open WebUI에서 OIDC 연동
- [프레임워크별 연동 가이드](/docs/api/framework-integration) — LangChain, Agno 등 연동
