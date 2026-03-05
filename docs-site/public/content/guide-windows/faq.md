# FAQ

## 설치 및 실행

### 다운로드가 안 됩니다
- 사내망에 연결되어 있는지 확인하세요
- MinIO 브라우저에서 직접 다운로드: [http://a2g.samsungds.net:13001/browser/nexus-coder-for-windows](http://a2g.samsungds.net:13001/browser/nexus-coder-for-windows)
- 프록시 설정에서 `a2g.samsungds.net`이 차단되고 있지 않은지 확인

### 설치 후 앱이 실행되지 않습니다
- Windows 10/11 (x64) 환경인지 확인하세요
- 백신 프로그램이 앱을 차단하고 있지 않은지 확인하세요
- 앱을 삭제 후 재설치해보세요

### SSO 로그인이 안 됩니다
- 사내망에 연결되어 있는지 확인하세요
- `genai.samsungds.net`에 접속이 가능한지 브라우저에서 확인해보세요
- NO_PROXY 환경변수에 `genai.samsungds.net`이 포함되어 있는지 확인:
  ```powershell
  echo $env:NO_PROXY
  ```

## 네트워크

### NO_PROXY 설정이 필요한가요?

프록시 환경에서 사용하는 경우, 다음 주소를 NO_PROXY에 추가해야 합니다:

| 주소 | 용도 |
|------|------|
| `10.229.95.228` | API 서버 |
| `10.229.95.220` | API 서버 |
| `a2g.samsungds.net` | A2G 서비스 (LLM, 업데이트) |
| `genai.samsungds.net` | GenAI SSO 인증 |

**Windows 환경변수 설정:**

```powershell
# PowerShell (현재 사용자에 영구 설정)
[Environment]::SetEnvironmentVariable("NO_PROXY", "10.229.95.228,10.229.95.220,a2g.samsungds.net,genai.samsungds.net", "User")
```

설정 후 앱을 재시작하세요.

### API 호출 시 연결 오류가 발생합니다
- NO_PROXY 설정 확인 (위 참조)
- 사내망 VPN이 연결되어 있는지 확인
- 방화벽에서 `a2g.samsungds.net:4090` 포트가 열려있는지 확인

## 업데이트

### 자동 업데이트가 동작하지 않습니다
- 앱 시작 후 5초 뒤에 업데이트를 확인합니다
- `a2g.samsungds.net:13000`에 접속이 가능한지 확인하세요
- 수동 업데이트: [다운로드 페이지](/nexus-bot)에서 최신 버전을 다운로드하여 덮어 설치

### 현재 버전을 확인하려면?
앱 하단 상태바에서 현재 버전을 확인할 수 있습니다.

## CLI 버전과의 차이

| 항목 | CLI (WSL) | Windows |
|------|-----------|---------|
| **실행 환경** | Linux / WSL | Windows 10/11 |
| **인터페이스** | 터미널 (TUI) | GUI (채팅형) |
| **설치 방법** | 바이너리 다운로드 | 설치 파일 (.exe) |
| **업데이트** | 자동 (바이너리 교체) | 자동 (인스톨러) |
| **AI 엔진** | 동일 | 동일 |
| **도구** | 동일 | 동일 |
| **SSO** | 브라우저 → CLI 콜백 | 브라우저 → 앱 콜백 |

## 문의

문제가 해결되지 않으면 **syngha.han**에게 문의하거나 [Feedback 페이지](/feedback)를 이용해주세요.
