"""
agent_platform_auth.py — Agent Platform OIDC 인증 모듈

개발자가 프로젝트에 복사해서 사용하는 단일 파일 모듈.
앱 시작 시 setup_auth()를 한 번 호출하면, 이후 모든 LLM API 호출에
사용자 인증 정보가 자동으로 주입된다.

사용법:
    from agent_platform_auth import setup_auth, set_user

    # CLI / 스크립트 — 앱 시작 시 한 번
    setup_auth("https://gateway.example.com")

    # 웹 서버 — 요청마다 사용자 지정 (async-safe)
    set_user("syngha.han")

요구 사항:
    - Python 3.9+
    - stdlib만 사용 (외부 패키지 불필요)
    - litellm이 설치되어 있으면 콜백 자동 등록
"""

from __future__ import annotations

import json
import os
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from contextvars import ContextVar
from functools import partial
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

_CREDENTIALS_DIR = Path.home() / ".agent-platform"
_CREDENTIALS_FILE = _CREDENTIALS_DIR / "credentials.json"
_CLIENT_ID = "cli-default"

# ---------------------------------------------------------------------------
# Context Variable — 웹 서버에서 요청별 사용자 지정용 (async-safe)
# ---------------------------------------------------------------------------

_current_user: ContextVar[Optional[str]] = ContextVar("_current_user", default=None)

# ---------------------------------------------------------------------------
# 모듈 수준 상태
# ---------------------------------------------------------------------------

_gateway_url: Optional[str] = None  # setup_auth()에서 설정


# ===================================================================
# 공개 API
# ===================================================================


def setup_auth(gateway_url: str) -> None:
    """메인 진입점. 앱 시작 시 한 번 호출한다.

    1. gateway URL을 모듈에 저장
    2. litellm이 설치되어 있으면 InjectUser 콜백을 등록
    3. 캐시된 인증 정보가 없으면 브라우저 OIDC 로그인을 시도
    """
    global _gateway_url
    _gateway_url = gateway_url.rstrip("/")

    # OpenAI SDK 패치 (LangChain, ADK string model, 직접 사용 전부 커버)
    _patch_openai_sdk()

    # litellm 콜백 등록 시도 (ADK LiteLlm 모델 커버)
    _register_litellm_callback()

    # 인증 정보 사전 확보 (CLI 환경이라면 여기서 브라우저 로그인)
    _resolve_user()


def set_user(loginid: str) -> None:
    """웹 서버 환경에서 요청별 사용자를 지정한다.

    FastAPI / Flask 미들웨어에서 헤더의 loginid를 꺼내
    이 함수로 설정하면, 같은 async context 안의 LLM 호출에
    해당 사용자가 자동 주입된다.
    """
    _current_user.set(loginid)


# ===================================================================
# 인증 정보 해석 (우선순위 체인)
# ===================================================================


def _resolve_user() -> Optional[str]:
    """현재 사용자 loginid를 우선순위에 따라 결정한다.

    우선순위:
        1. ContextVar (_current_user) — set_user()로 설정된 값
        2. 환경변수 PLATFORM_USER
        3. 로컬 캐시 (~/.agent-platform/credentials.json)
        4. 브라우저 OIDC 로그인
    """
    # 1) ContextVar
    user = _current_user.get()
    if user:
        return user

    # 2) 환경변수
    env_user = os.environ.get("PLATFORM_USER")
    if env_user:
        return env_user

    # 3) 로컬 캐시
    cred = _load_cached_credential()
    if cred:
        return cred["loginid"]

    # 4) 브라우저 OIDC 로그인
    if _gateway_url:
        cred = _do_oidc_login(_gateway_url)
        if cred:
            return cred["loginid"]

    return None


# ===================================================================
# 로컬 인증 정보 캐시
# ===================================================================


def _load_cached_credential() -> Optional[dict]:
    """~/.agent-platform/credentials.json을 읽어 반환한다.

    파일이 없거나 토큰이 만료되었으면 None을 반환한다.
    캐시 형식:
        {
            "loginid": "syngha.han",
            "username": "한승하",
            "deptname": "S/W혁신팀(S.LSI)",
            "access_token": "eyJ...",
            "refresh_token": "...",
            "expires_at": 1234567890.0
        }
    """
    if not _CREDENTIALS_FILE.exists():
        return None

    try:
        with open(_CREDENTIALS_FILE, "r", encoding="utf-8") as f:
            cred = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    # 만료 확인 — 30초 여유를 둔다
    expires_at = cred.get("expires_at", 0)
    if time.time() >= expires_at - 30:
        return None

    return cred


def _save_credential(cred: dict) -> None:
    """인증 정보를 로컬 캐시에 저장한다."""
    _CREDENTIALS_DIR.mkdir(parents=True, exist_ok=True)
    with open(_CREDENTIALS_FILE, "w", encoding="utf-8") as f:
        json.dump(cred, f, ensure_ascii=False, indent=2)
    # 파일 권한을 소유자만 읽기/쓰기로 제한
    try:
        _CREDENTIALS_FILE.chmod(0o600)
    except OSError:
        pass  # Windows 등 chmod 미지원 환경


# ===================================================================
# OIDC 브라우저 로그인 흐름
# ===================================================================


def _do_oidc_login(gateway_url: str) -> Optional[dict]:
    """브라우저 기반 OIDC Authorization Code 흐름을 수행한다.

    1. 로컬 임시 HTTP 서버를 랜덤 포트로 시작
    2. 브라우저에서 authorize 엔드포인트를 열기
    3. 콜백으로 authorization code 수신
    4. code → token 교환 (POST /oidc/token)
    5. userinfo 조회 (GET /oidc/userinfo)
    6. ~/.agent-platform/credentials.json에 저장
    7. credential dict 반환
    """
    gateway_url = gateway_url.rstrip("/")

    print("\n\U0001f510 사용자 인증이 필요합니다. 브라우저에서 로그인 페이지를 여는 중...")

    # ---- 1) 콜백 수신용 임시 HTTP 서버 ----
    auth_code_holder: dict[str, Optional[str]] = {"code": None}
    server_ready = threading.Event()
    code_received = threading.Event()

    class _CallbackHandler(BaseHTTPRequestHandler):
        """OIDC redirect_uri 콜백을 수신하는 핸들러."""

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            code = params.get("code", [None])[0]
            if code:
                auth_code_holder["code"] = code
                # 사용자에게 성공 페이지 표시
                body = (
                    "<html><body style='font-family:sans-serif;text-align:center;"
                    "padding-top:80px'>"
                    "<h2>인증 완료</h2>"
                    "<p>이 창을 닫아도 됩니다.</p>"
                    "</body></html>"
                )
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body.encode("utf-8"))
            else:
                error = params.get("error", ["unknown"])[0]
                body = f"<html><body><h2>인증 실패: {error}</h2></body></html>"
                self.send_response(400)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body.encode("utf-8"))
            code_received.set()

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            """콘솔 로그 억제."""
            pass

    # 랜덤 포트로 서버 바인딩
    server = HTTPServer(("127.0.0.1", 0), _CallbackHandler)
    port = server.server_address[1]
    redirect_uri = f"http://localhost:{port}/callback"

    def _serve() -> None:
        server_ready.set()
        server.handle_request()  # 콜백 1회만 처리

    server_thread = threading.Thread(target=_serve, daemon=True)
    server_thread.start()
    server_ready.wait()

    # ---- 2) 브라우저에서 authorize 엔드포인트 열기 ----
    authorize_params = urllib.parse.urlencode({
        "client_id": _CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid profile",
    })
    authorize_url = f"{gateway_url}/oidc/authorize?{authorize_params}"
    webbrowser.open(authorize_url)

    # ---- 3) authorization code 수신 대기 (최대 120초) ----
    if not code_received.wait(timeout=120):
        server.server_close()
        print("  인증 시간이 초과되었습니다.")
        return None

    server.server_close()
    code = auth_code_holder["code"]
    if not code:
        print("  인증 코드를 받지 못했습니다.")
        return None

    # ---- 4) code → token 교환 ----
    token_data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": _CLIENT_ID,
        "redirect_uri": redirect_uri,
    }).encode("utf-8")

    token_req = urllib.request.Request(
        f"{gateway_url}/oidc/token",
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(token_req, timeout=30) as resp:
            token_resp = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"  토큰 교환 실패: {e}")
        return None

    access_token = token_resp.get("access_token", "")
    refresh_token = token_resp.get("refresh_token", "")
    expires_in = token_resp.get("expires_in", 3600)

    # ---- 5) userinfo 조회 ----
    userinfo_req = urllib.request.Request(
        f"{gateway_url}/oidc/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )

    try:
        with urllib.request.urlopen(userinfo_req, timeout=30) as resp:
            userinfo = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"  사용자 정보 조회 실패: {e}")
        return None

    # ---- 6) 인증 정보 저장 ----
    cred: dict[str, Any] = {
        "loginid": userinfo.get("loginid", userinfo.get("sub", "")),
        "username": userinfo.get("username", userinfo.get("name", "")),
        "deptname": userinfo.get("deptname", userinfo.get("department", "")),
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": time.time() + expires_in,
    }
    _save_credential(cred)

    loginid = cred["loginid"]
    print(f"\n\u2705 {loginid}으로 인증되었습니다. (~/.agent-platform/credentials.json)")

    return cred


# ===================================================================
# 토큰 갱신 / 재인증
# ===================================================================


def _ensure_valid_credential() -> Optional[dict]:
    """유효한 인증 정보를 확보한다.

    캐시가 만료되었으면 자동으로 재인증을 시도한다.
    """
    cred = _load_cached_credential()
    if cred:
        return cred

    # 캐시가 없거나 만료됨 — 재인증
    if _gateway_url:
        print("\n\U0001f504 인증 토큰이 만료되었습니다. 재인증 중...")
        return _do_oidc_login(_gateway_url)

    return None


# ===================================================================
# LiteLLM 콜백 통합
# ===================================================================


def _register_litellm_callback() -> None:
    """litellm이 설치되어 있으면 InjectUser 콜백을 등록한다.

    litellm이 없으면 조용히 건너뛴다.
    """
    try:
        import litellm  # type: ignore[import-untyped]
    except ImportError:
        # litellm 미설치 — 콜백 등록 불필요
        return

    callback = InjectUser()

    # 중복 등록 방지
    if not hasattr(litellm, "callbacks"):
        litellm.callbacks = []
    for existing in litellm.callbacks:
        if isinstance(existing, InjectUser):
            return
    litellm.callbacks.append(callback)


def _patch_openai_sdk() -> None:
    """OpenAI SDK를 monkey-patch하여 모든 chat.completions.create 호출에
    body.user를 자동 주입한다.

    이 패치로 다음이 전부 자동:
      - OpenAI SDK 직접 사용
      - LangChain (langchain-openai → openai)
      - ADK (string model → openai)
      - 기타 openai 패키지를 사용하는 모든 라이브러리
    """
    try:
        from openai.resources.chat.completions import Completions  # type: ignore
    except ImportError:
        return  # openai 미설치

    if getattr(Completions.create, "_platform_patched", False):
        return  # 이미 패치됨

    _original_create = Completions.create

    def _patched_create(self: Any, *args: Any, **kwargs: Any) -> Any:
        user = _current_user.get() or os.environ.get("PLATFORM_USER")
        if not user:
            cred = _load_cached_credential()
            if cred:
                user = cred.get("loginid")
        if user and "user" not in kwargs:
            kwargs["user"] = user
        return _original_create(self, *args, **kwargs)

    _patched_create._platform_patched = True  # type: ignore
    Completions.create = _patched_create  # type: ignore

    # async 버전도 패치
    try:
        from openai.resources.chat.completions import AsyncCompletions  # type: ignore
        if not getattr(AsyncCompletions.create, "_platform_patched", False):
            _original_async = AsyncCompletions.create

            async def _patched_async_create(self: Any, *args: Any, **kwargs: Any) -> Any:
                user = _current_user.get() or os.environ.get("PLATFORM_USER")
                if not user:
                    cred = _load_cached_credential()
                    if cred:
                        user = cred.get("loginid")
                if user and "user" not in kwargs:
                    kwargs["user"] = user
                return await _original_async(self, *args, **kwargs)

            _patched_async_create._platform_patched = True  # type: ignore
            AsyncCompletions.create = _patched_async_create  # type: ignore
    except ImportError:
        pass


class InjectUser:
    """LiteLLM 커스텀 콜백 — 모든 LLM 호출에 사용자 정보를 자동 주입한다.

    litellm.callbacks에 등록하면, 매 API 호출 전에 log_pre_api_call이
    실행되어 kwargs["user"]에 현재 사용자 loginid를 설정한다.
    """

    def log_pre_api_call(
        self,
        model: str,
        messages: Any,
        kwargs: dict[str, Any],
    ) -> None:
        """API 호출 직전에 실행. kwargs["user"]에 사용자 loginid를 주입한다."""
        user = self._get_current_user()
        if user:
            kwargs["user"] = user

    def log_success_event(self, kwargs: dict, response_obj: Any, start_time: Any, end_time: Any) -> None:
        """성공 이벤트 — 현재는 아무 작업도 하지 않음."""
        pass

    def log_failure_event(self, kwargs: dict, response_obj: Any, start_time: Any, end_time: Any) -> None:
        """실패 이벤트 — 현재는 아무 작업도 하지 않음."""
        pass

    @staticmethod
    def _get_current_user() -> Optional[str]:
        """현재 사용자 loginid를 우선순위 체인에서 가져온다.

        우선순위:
            1. ContextVar (_current_user)
            2. 환경변수 PLATFORM_USER
            3. 로컬 캐시
            4. OIDC 재인증
        """
        # 1) ContextVar
        user = _current_user.get()
        if user:
            return user

        # 2) 환경변수
        env_user = os.environ.get("PLATFORM_USER")
        if env_user:
            return env_user

        # 3) 로컬 캐시 (만료 시 재인증 포함)
        cred = _ensure_valid_credential()
        if cred:
            return cred.get("loginid")

        return None


# ===================================================================
# 편의 함수
# ===================================================================


def get_credential() -> Optional[dict]:
    """현재 유효한 인증 정보 dict를 반환한다.

    외부에서 access_token 등을 직접 사용해야 할 때 호출한다.
    만료된 경우 자동 재인증을 시도한다.
    """
    return _ensure_valid_credential()


def get_headers() -> dict[str, str]:
    """LLM Gateway에 전달할 인증 헤더를 반환한다.

    반환 형식:
        {
            "x-user-id": "syngha.han",
            "x-service-id": "cli-default",
            "Authorization": "Bearer eyJ..."
        }
    """
    cred = _ensure_valid_credential()
    if not cred:
        return {}

    headers = {
        "x-user-id": cred.get("loginid", ""),
        "x-service-id": _CLIENT_ID,
    }
    token = cred.get("access_token")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    dept = cred.get("deptname")
    if dept:
        headers["x-dept-name"] = dept
    return headers


# ===================================================================
# 모듈 직접 실행 시 테스트
# ===================================================================

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("사용법: python agent_platform_auth.py <gateway_url>")
        print("예: python agent_platform_auth.py https://gateway.example.com")
        sys.exit(1)

    url = sys.argv[1]
    print(f"Agent Platform 인증 테스트 — Gateway: {url}")
    setup_auth(url)

    cred = get_credential()
    if cred:
        print(f"\n인증 정보:")
        print(f"  loginid : {cred.get('loginid')}")
        print(f"  username: {cred.get('username')}")
        print(f"  deptname: {cred.get('deptname')}")
        print(f"  만료시각: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(cred.get('expires_at', 0)))}")
    else:
        print("\n인증 실패.")
        sys.exit(1)
