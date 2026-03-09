import { useState, useEffect } from 'react';
import { LogIn, AlertCircle, Shield, Cpu, ArrowRight } from 'lucide-react';
import { authApi } from '../services/api';

interface User {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
}

interface LoginProps {
  onLogin: (user: User, token: string, isAdmin: boolean, adminRole: string | null) => void;
}

const SSO_BASE_URL = import.meta.env.VITE_SSO_URL || 'https://genai.samsungds.net:36810';
const SSO_PATH = '/direct_sso';

export default function Login({ onLogin }: LoginProps) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [processingCallback, setProcessingCallback] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const data = urlParams.get('data');
    if (data) {
      setProcessingCallback(true);
      handleSSOCallback(data);
    }
  }, []);

  const handleSSOCallback = async (dataString: string) => {
    try {
      const decodedData = decodeURIComponent(dataString);
      const ssoData = JSON.parse(decodedData);

      if (!ssoData.loginid || !ssoData.username) {
        throw new Error('Invalid SSO data');
      }

      const jsonData = JSON.stringify({
        loginid: ssoData.loginid,
        username: ssoData.username,
        deptname: ssoData.deptname || '',
        timestamp: Date.now(),
      });
      const ssoToken = btoa(unescape(encodeURIComponent(jsonData)));

      const response = await authApi.login(`sso.${ssoToken}`);
      const { user, sessionToken, isAdmin, adminRole, isSuperAdmin } = response.data;

      window.history.replaceState({}, document.title, window.location.pathname);

      const resolvedRole: 'SUPER_ADMIN' | 'ADMIN' | null =
        adminRole ?? (isSuperAdmin ? 'SUPER_ADMIN' : isAdmin ? 'ADMIN' : null);

      onLogin(user, sessionToken, isAdmin, resolvedRole);
    } catch (err) {
      console.error('SSO callback error:', err);
      setError('SSO 인증 처리 중 오류가 발생했습니다.');
      window.history.replaceState({}, document.title, window.location.pathname);
    } finally {
      setProcessingCallback(false);
    }
  };

  const handleSSOLogin = () => {
    setLoading(true);
    setError('');
    const redirectUrl = window.location.origin + window.location.pathname;
    const ssoUrl = new URL(SSO_PATH, SSO_BASE_URL);
    ssoUrl.searchParams.set('redirect_url', redirectUrl);
    window.location.href = ssoUrl.toString();
  };

  if (processingCallback) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center p-4">
        <div className="text-center animate-fade-in">
          <div className="w-16 h-16 border-[3px] border-samsung-blue border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-6 text-lg font-medium text-gray-800">인증 처리 중</p>
          <p className="mt-1 text-sm text-gray-500">잠시만 기다려주세요</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col">
      {/* Top accent bar */}
      <div className="h-1 bg-gradient-to-r from-samsung-blue via-pastel-300 to-samsung-blue-dark" />

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-[420px] animate-slide-up">
          {/* Logo Section */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-white rounded-[22px] mb-5 shadow-ios-lg overflow-hidden">
              <img src="/logo.png" alt="AX Portal" className="w-16 h-16 object-contain" />
            </div>
            <h1 className="text-[28px] font-bold text-gray-900 tracking-tight leading-tight">
              AX Portal
            </h1>
            <p className="text-gray-500 mt-1.5 text-[15px]">LLM Gateway & Analytics</p>
          </div>

          {/* Login Card */}
          <div className="bg-white rounded-ios-xl shadow-ios-lg p-8">
            {error && (
              <div className="mb-5 p-3.5 bg-red-50 border border-red-100 rounded-ios flex items-start gap-2.5 animate-scale-in">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-[13px] text-red-600 leading-relaxed">{error}</p>
              </div>
            )}

            <button
              onClick={handleSSOLogin}
              disabled={loading}
              className="w-full py-3.5 px-5 bg-samsung-blue text-white font-semibold rounded-ios-lg
                         hover:bg-samsung-blue-dark
                         focus:outline-none focus:ring-4 focus:ring-samsung-blue/20
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-all duration-200 ease-ios
                         transform active:scale-[0.98]
                         flex items-center justify-center gap-2.5 text-[15px]
                         shadow-lg shadow-samsung-blue/25"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  SSO 페이지로 이동 중...
                </>
              ) : (
                <>
                  <LogIn className="w-[18px] h-[18px]" />
                  SSO로 로그인
                  <ArrowRight className="w-4 h-4 ml-auto opacity-60" />
                </>
              )}
            </button>

            {/* Features */}
            <div className="mt-7 pt-6 border-t border-gray-100">
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="w-10 h-10 rounded-ios bg-blue-50 flex items-center justify-center mx-auto mb-2">
                    <Cpu className="w-5 h-5 text-samsung-blue" />
                  </div>
                  <p className="text-[11px] text-gray-500 font-medium">LLM 관리</p>
                </div>
                <div className="text-center">
                  <div className="w-10 h-10 rounded-ios bg-purple-50 flex items-center justify-center mx-auto mb-2">
                    <Shield className="w-5 h-5 text-purple-500" />
                  </div>
                  <p className="text-[11px] text-gray-500 font-medium">3-Tier 권한</p>
                </div>
                <div className="text-center">
                  <div className="w-10 h-10 rounded-ios bg-green-50 flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <p className="text-[11px] text-gray-500 font-medium">실시간 통계</p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-8 space-y-1">
            <p className="text-[12px] text-gray-400">Samsung DS 계정으로 로그인됩니다</p>
            <p className="text-[11px] text-gray-400">&copy; 2026 AX Portal</p>
          </div>
        </div>
      </div>
    </div>
  );
}
