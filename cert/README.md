# SSL 인증서 가이드

## 인증서 파일 목록

| 파일 | 용도 | 자동 생성 | 비고 |
|---|---|---|---|
| `server.crt` | Auth Server HTTPS 서버 인증서 | deploy.sh가 자동 생성 | 자체서명. 사내 CA로 교체 권장 |
| `server.key` | Auth Server HTTPS 서버 개인키 | deploy.sh가 자동 생성 | server.crt와 쌍 |
| `cert.cer` | 삼성 SSO 공개 인증서 (기존 API용) | 수동 배치 필요 | SSO팀에서 발급 |
| `sso.cer` | 삼성 SSO 공개 인증서 (Auth Server용) | cert.cer에서 자동 복사 | cert.cer과 동일 파일 |

## 두 인증서의 차이

### HTTPS 서버 인증서 (server.crt / server.key)
- 용도: Auth Server(:9050)가 HTTPS로 동작하기 위한 인증서
- 브라우저 <-> Auth Server 간 암호화 통신에 사용
- deploy.sh가 없으면 자체서명 인증서를 자동 생성 (SAN에 서버 IP 포함)
- 운영 환경에서는 사내 CA에서 발급받은 인증서로 교체 권장 (브라우저 경고 방지)

### SSO 검증 인증서 (sso.cer = cert.cer)
- 용도: 삼성 SSO가 발급한 id_token(JWT)의 RS256 서명을 검증하는 데 사용
- 삼성 SSO 서버의 공개키가 담긴 X.509 인증서
- SSO팀에서 발급받아야 함 -- 이 파일이 없으면 실제 SSO 로그인 불가
- cert.cer(기존)과 sso.cer(Auth Server용)은 동일한 파일. deploy.sh가 자동 복사

## 배포 전 체크리스트

1. `cert/cert.cer` 파일이 있는지 확인 (삼성 SSO 인증서)
2. `./deploy.sh` 실행 -- 나머지는 자동
   - server.crt/key 없으면 -> 자동 생성
   - sso.cer 없으면 -> cert.cer에서 자동 복사
   - OIDC_ISSUER -> 서버 IP 자동 감지

## 인증서 교체 방법

### HTTPS 서버 인증서 교체 (선택)
사내 CA에서 발급받은 인증서로 교체하면 브라우저 경고가 사라집니다.
cert/server.crt와 cert/server.key를 교체 후 ./deploy.sh 재실행

### SSO 인증서 갱신
SSO 인증서가 갱신되면 cert/cert.cer을 새 파일로 교체 후 ./deploy.sh 재실행
(sso.cer은 자동으로 cert.cer에서 복사됨)
