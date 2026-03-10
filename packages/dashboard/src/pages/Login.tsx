import { useState, useEffect } from 'react';
import { LogIn, AlertCircle, ArrowRight, Cpu, Shield, BarChart3, Zap } from 'lucide-react';
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
      if (!ssoData.loginid || !ssoData.username) throw new Error('Invalid SSO data');

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
      <div className="min-h-screen bg-pastel-50 flex items-center justify-center p-4">
        <div className="text-center animate-fade-in">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-samsung-blue/10 animate-ping" />
            <div className="relative w-20 h-20 border-[3px] border-samsung-blue/20 border-t-samsung-blue rounded-full animate-spin" />
          </div>
          <p className="text-lg font-semibold text-pastel-800">인증 처리 중</p>
          <p className="mt-1.5 text-sm text-pastel-500">잠시만 기다려주세요</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pastel-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-[440px]">
          {/* Logo Section */}
          <div className="text-center mb-10 animate-fade-in">
            <div className="inline-flex items-center justify-center w-[88px] h-[88px] bg-white rounded-xl mb-6 shadow-sm overflow-hidden ring-1 ring-black/[0.03]">
              <img src="/logo.png" alt="Agent Stats" className="w-16 h-16 object-contain" />
            </div>
            <h1 className="text-[32px] font-extrabold text-pastel-800 tracking-tight leading-none">
              <span className="text-samsung-blue">Agent</span> Stats
            </h1>
            <p className="text-pastel-400 text-sm mt-1">사용량 집계 시스템</p>
            <p className="text-pastel-500 mt-2 text-[15px] font-medium">
              AI-Powered LLM Gateway & Analytics
            </p>
          </div>

          {/* Login Card */}
          <div className="animate-slide-up">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
              {error && (
                <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-lg flex items-start gap-3 animate-scale-in">
                  <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-rose-600 leading-relaxed">{error}</p>
                </div>
              )}

              <button
                onClick={handleSSOLogin}
                disabled={loading}
                className="w-full group relative py-4 px-6 bg-gray-900 text-white font-semibold rounded-2xl
                           focus:outline-none focus:ring-4 focus:ring-samsung-blue/20
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-300
                           transform active:scale-[0.98]
                           flex items-center justify-center gap-3 text-[15px] overflow-hidden"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>SSO 페이지로 이동 중...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-5 h-5" />
                    <span>SSO로 로그인</span>
                    <ArrowRight className="w-4 h-4 ml-auto opacity-60 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              {/* Feature cards */}
              <div className="mt-8 pt-7 border-t border-gray-100/80">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: Cpu, label: 'LLM 게이트웨이', desc: '멀티모델 프록시', color: 'text-samsung-blue', bg: 'bg-blue-50' },
                    { icon: Shield, label: '3-Tier 권한', desc: '세분화된 접근제어', color: 'text-accent-indigo', bg: 'bg-indigo-50' },
                    { icon: BarChart3, label: '실시간 통계', desc: '토큰 사용량 분석', color: 'text-accent-emerald', bg: 'bg-emerald-50' },
                    { icon: Zap, label: '멀티 서비스', desc: '서비스별 독립 관리', color: 'text-accent-amber', bg: 'bg-amber-50' },
                  ].map(({ icon: Icon, label, desc, color, bg }, i) => (
                    <div
                      key={label}
                      className="group p-3.5 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-300 cursor-default"
                      style={{ animationDelay: `${i * 0.05 + 0.2}s` }}
                    >
                      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-2.5`}>
                        <Icon className={`w-[18px] h-[18px] ${color}`} />
                      </div>
                      <p className="text-[13px] font-semibold text-pastel-800 leading-tight">{label}</p>
                      <p className="text-[11px] text-pastel-500 mt-0.5">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-8 space-y-1.5 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <p className="text-[12px] text-pastel-400 font-medium">Samsung DS 계정으로 로그인됩니다</p>
            <p className="text-[11px] text-pastel-300">&copy; 2026 Agent Stats &middot; All rights reserved</p>
          </div>
        </div>
      </div>
    </div>
  );
}
