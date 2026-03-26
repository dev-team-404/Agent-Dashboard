import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageCircle, X, Send, Loader2, Bot, User, Sparkles,
  ChevronDown, Trash2, ArrowRight,
} from 'lucide-react';
import { api } from '../../services/api';

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// [[label|/path]] or [[label|/path|tour-id]] 패턴 파싱
interface NavAction {
  label: string;
  path: string;
  tourId?: string;
}

function parseNavActions(text: string): Array<string | NavAction> {
  const parts: Array<string | NavAction> = [];
  const regex = /\[\[([^|]+)\|([^|\]]+)(?:\|([^\]]+))?\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push({
      label: match[1],
      path: match[2],
      tourId: match[3] || undefined,
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

// HTML 이스케이프 (XSS 방지)
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 간단 마크다운 → HTML
function renderMarkdown(text: string): string {
  // 먼저 코드블록을 보호 (이스케이프 전에 추출)
  const codeBlocks: string[] = [];
  let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    codeBlocks.push(`<pre class="bg-gray-800 text-gray-100 rounded-lg p-3 text-xs overflow-x-auto my-2 font-mono"><code>${escapeHtml(code)}</code></pre>`);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });
  const inlineCodes: string[] = [];
  processed = processed.replace(/`([^`]+)`/g, (_m, code) => {
    inlineCodes.push(`<code class="bg-gray-100 text-pink-600 px-1 py-0.5 rounded text-xs font-mono">${escapeHtml(code)}</code>`);
    return `__INLINE_CODE_${inlineCodes.length - 1}__`;
  });

  // 나머지 텍스트 이스케이프
  processed = escapeHtml(processed);

  // 코드블록/인라인코드 복원
  processed = processed.replace(/__CODE_BLOCK_(\d+)__/g, (_m, i) => codeBlocks[parseInt(i)]);
  processed = processed.replace(/__INLINE_CODE_(\d+)__/g, (_m, i) => inlineCodes[parseInt(i)]);

  return processed
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // h3
    .replace(/^### (.+)$/gm, '<h3 class="font-semibold text-sm mt-3 mb-1">$1</h3>')
    // h2
    .replace(/^## (.+)$/gm, '<h2 class="font-semibold text-sm mt-3 mb-1">$1</h2>')
    // bullet list
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-sm leading-relaxed">$1</li>')
    // numbered list
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm leading-relaxed">$1</li>')
    // line breaks (double newlines → paragraphs)
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

// 하이라이팅 효과
function highlightElement(tourId: string) {
  const el = document.querySelector(`[data-tour="${tourId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ring-4', 'ring-cyan-400/60', 'ring-offset-2', 'rounded-lg', 'transition-all', 'duration-500');
  // 5초 후 하이라이트 제거
  setTimeout(() => {
    el.classList.remove('ring-4', 'ring-cyan-400/60', 'ring-offset-2', 'rounded-lg', 'transition-all', 'duration-500');
  }, 5000);
}

interface Props {
  adminRole: AdminRole;
}

export default function HelpChatbot({ adminRole }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [modelName, setModelName] = useState<string>('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  // 설정 상태 확인
  useEffect(() => {
    api.get('/help-chatbot/config').then(res => {
      setConfigured(res.data.configured);
      setModelName(res.data.model?.displayName || '');
    }).catch(() => setConfigured(false));
  }, []);

  // 스크롤 자동 하단
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen, scrollToBottom]);

  // 스크롤 위치 감지
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setShowScrollBtn(!isNearBottom);
  }, []);

  // 열릴 때 input focus
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleNavAction = useCallback((action: NavAction) => {
    navigate(action.path);
    // 페이지 이동 후 하이라이팅
    if (action.tourId) {
      setTimeout(() => highlightElement(action.tourId!), 500);
    }
  }, [navigate]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);

    const assistantMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const allMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

      const token = localStorage.getItem('agent_stats_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/help-chatbot/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: allMessages, adminRole }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: '연결 실패' }));
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: errData.error || `오류가 발생했습니다 (${response.status})` }
            : m
        ));
        setIsStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + parsed.content }
                  : m
              ));
            }
            if (parsed.error) {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + `\n\n**오류:** ${parsed.error}` }
                  : m
              ));
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id && !m.content
            ? { ...m, content: '연결이 중단되었습니다. 다시 시도해주세요.' }
            : m
        ));
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (isStreaming) {
      abortRef.current?.abort();
    }
    setMessages([]);
  };

  const suggestedQuestions = adminRole === 'SUPER_ADMIN'
    ? [
        '새 LLM 모델은 어떻게 등록하나요?',
        '서비스별 Rate Limit 설정 방법',
        'GPU 모니터링은 어떻게 사용하나요?',
      ]
    : adminRole === 'ADMIN'
    ? [
        '서비스를 만들고 배포하는 방법',
        '모델의 가시성(Visibility) 설정이란?',
        '사용자에게 Rate Limit을 설정하려면?',
      ]
    : [
        '이 플랫폼은 어떤 서비스인가요?',
        '내 서비스를 만들려면 어떻게 해야 하나요?',
        '관리자 권한은 어떻게 신청하나요?',
      ];

  // 메시지 렌더링 (nav action 파싱 포함)
  const renderMessageContent = (content: string) => {
    const parts = parseNavActions(content);
    const hasNavActions = parts.some(p => typeof p !== 'string');

    if (!hasNavActions) {
      return (
        <div
          className="prose prose-sm max-w-none text-[13px] leading-relaxed [&_pre]:my-2 [&_code]:text-xs [&_li]:my-0.5"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      );
    }

    return (
      <div className="text-[13px] leading-relaxed">
        {parts.map((part, idx) => {
          if (typeof part === 'string') {
            return (
              <span
                key={idx}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(part) }}
              />
            );
          }
          return (
            <button
              key={idx}
              onClick={() => handleNavAction(part)}
              className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 font-medium rounded-md border border-cyan-200 text-xs transition-colors"
              title={`${part.path} 페이지로 이동${part.tourId ? ' + 하이라이팅' : ''}`}
            >
              <ArrowRight className="w-3 h-3" />
              {part.label}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          fixed bottom-6 right-6 z-[9998]
          w-12 h-12 rounded-full
          ${isOpen ? 'bg-gray-600 hover:bg-gray-700' : 'bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700'}
          text-white shadow-lg hover:shadow-xl
          flex items-center justify-center
          transform hover:scale-105 active:scale-95
          transition-all duration-200
        `}
        title="AI 도우미"
      >
        {isOpen ? <X className="w-5 h-5" /> : <MessageCircle className="w-6 h-6" />}
        {/* 설정 안됨 뱃지 */}
        {configured === false && !isOpen && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-400 rounded-full border-2 border-white" />
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div
          className="fixed bottom-20 right-6 z-[9999] w-[420px] max-h-[600px] bg-white rounded-2xl shadow-2xl border border-gray-200/60 flex flex-col overflow-hidden animate-slide-up"
          style={{
            animation: 'slideUp 0.25s ease-out',
          }}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-4 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm">AI 도우미</h3>
                <p className="text-cyan-100 text-xs">
                  {configured ? modelName : '설정 필요'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={handleClear}
                  className="p-1.5 rounded-lg hover:bg-white/15 transition-colors"
                  title="대화 초기화"
                >
                  <Trash2 className="w-4 h-4 text-white/80" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/15 transition-colors"
              >
                <X className="w-4 h-4 text-white/80" />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0"
            style={{ maxHeight: 'calc(600px - 140px)' }}
          >
            {/* 설정 안됨 경고 */}
            {configured === false && (
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-700 text-center">
                <Sparkles className="w-4 h-4 mx-auto mb-1 text-amber-500" />
                AI 도우미 LLM이 아직 설정되지 않았습니다.<br />
                SUPER_ADMIN에게 시스템 LLM 설정에서 챗봇 모델을 지정해달라고 요청하세요.
              </div>
            )}

            {/* Welcome */}
            {messages.length === 0 && configured !== false && (
              <div className="text-center py-4">
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-cyan-50 to-blue-50 flex items-center justify-center">
                  <Bot className="w-7 h-7 text-cyan-500" />
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  무엇이든 물어보세요!
                </p>
                <p className="text-xs text-gray-400 mb-4">
                  플랫폼 사용법, 기능 안내, 설정 방법 등을 도와드립니다
                </p>
                <div className="space-y-2">
                  {suggestedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 0); }}
                      className="w-full text-left px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-cyan-50 border border-gray-100 hover:border-cyan-200 text-xs text-gray-600 hover:text-cyan-700 transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message List */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                {/* Avatar */}
                <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                  msg.role === 'user'
                    ? 'bg-blue-100'
                    : 'bg-gradient-to-br from-cyan-50 to-blue-50'
                }`}>
                  {msg.role === 'user'
                    ? <User className="w-3.5 h-3.5 text-blue-600" />
                    : <Bot className="w-3.5 h-3.5 text-cyan-600" />}
                </div>

                {/* Bubble */}
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-md'
                    : 'bg-gray-50 text-gray-700 border border-gray-100 rounded-tl-md'
                }`}>
                  {msg.role === 'user' ? (
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  ) : msg.content ? (
                    renderMessageContent(msg.content)
                  ) : (
                    <div className="flex items-center gap-1.5 py-1">
                      <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>

          {/* Scroll to bottom */}
          {showScrollBtn && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-[72px] left-1/2 -translate-x-1/2 p-1.5 bg-white rounded-full shadow-md border border-gray-200 hover:bg-gray-50 transition-colors z-10"
            >
              <ChevronDown className="w-4 h-4 text-gray-500" />
            </button>
          )}

          {/* Input Area */}
          <div className="border-t border-gray-100 px-4 py-3 flex-shrink-0 bg-white">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={configured === false ? 'LLM 설정이 필요합니다' : '메시지를 입력하세요...'}
                disabled={configured === false || isStreaming}
                rows={1}
                className="flex-1 resize-none px-3 py-2 bg-gray-50 border border-gray-200/60 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400/50 disabled:opacity-50 max-h-24 overflow-y-auto"
                style={{ minHeight: '38px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 96) + 'px';
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming || configured === false}
                className="p-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
              >
                {isStreaming
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS Animation */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
