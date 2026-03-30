import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

export const config = {
  hostIp: process.env['HOST_IP'] || '0.0.0.0',
  authPort: parseInt(process.env['AUTH_PORT'] || '9050'),
  mockSsoPort: parseInt(process.env['MOCK_SSO_PORT'] || '9999'),

  ssl: {
    enabled: process.env['SSL_ENABLED'] === 'true',
    certFile: process.env['SSL_CERT_FILE'] || './cert/server.crt',
    keyFile: process.env['SSL_KEY_FILE'] || './cert/server.key',
  },

  mockSso: {
    enabled: process.env['ENABLE_MOCK_SSO'] === 'true',
    url: process.env['MOCK_SSO_URL'] || 'http://localhost:9999',
  },

  sso: {
    enabled: process.env['SSO_ENABLED'] === 'true',
    clientId: process.env['SSO_CLIENT_ID'] || '',
    idpEntityId: process.env['IDP_ENTITY_ID'] || '',
    certFile: process.env['SSO_CERT_FILE'] || './cert/sso.cer',
    scope: process.env['SSO_SCOPE'] || 'openid profile',
    responseType: process.env['SSO_RESPONSE_TYPE'] || 'code id_token',
    responseMode: process.env['SSO_RESPONSE_MODE'] || 'form_post',
    logoutUrl: process.env['SP_LOGOUT_URL'] || '',
  },

  jwt: {
    secret: process.env['JWT_SECRET'] || 'agent-platform-auth-dev-secret-change-in-production',
    algorithm: (process.env['JWT_ALGORITHM'] || 'HS256') as 'HS256' | 'RS256',
    expiresIn: process.env['JWT_EXPIRES_IN'] || '12h',
  },

  oidc: {
    issuer: process.env['OIDC_ISSUER'] || 'http://a2g.samsungds.net:8090',
    // SSO 콜백 URL — 삼성 SSO에 등록한 redirect_uri의 base (OIDC_ISSUER와 다를 수 있음)
    ssoCallbackBase: process.env['OIDC_SSO_CALLBACK_BASE'] || process.env['OIDC_ISSUER'] || 'http://a2g.samsungds.net:8090',
  },
};
