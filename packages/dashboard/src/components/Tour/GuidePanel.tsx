import { BookOpen, X, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface GuidePanelProps {
  title: string;
  currentStep: number;
  totalSteps: number;
  children: React.ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  showPrev?: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  hideFooter?: boolean;
}

export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text for manual copy
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <div className="relative mt-2 mb-3">
      <pre className="bg-gray-900 text-gray-100 text-[11px] leading-relaxed rounded-lg p-3 pr-10 overflow-x-auto whitespace-pre-wrap break-all font-mono">
        {text}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
        title="복사"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 mt-3 p-2.5 bg-blue-50 rounded-lg text-xs text-blue-700 leading-relaxed">
      <span className="shrink-0 mt-0.5">💡</span>
      <div>{children}</div>
    </div>
  );
}

export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 mt-3 p-2.5 bg-amber-50 rounded-lg text-xs text-amber-700 leading-relaxed">
      <span className="shrink-0 mt-0.5">⚠️</span>
      <div>{children}</div>
    </div>
  );
}

export function StepTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[15px] font-bold text-gray-900 mb-2">{children}</h3>;
}

export function StepDesc({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] text-gray-600 leading-relaxed space-y-2">{children}</div>;
}

export function FieldGuide({ label, desc, example }: { label: string; desc: string; example?: string }) {
  return (
    <div className="py-1.5">
      <span className="font-semibold text-gray-800">{label}</span>
      <span className="text-gray-500"> — {desc}</span>
      {example && <div className="text-[12px] text-blue-600 mt-0.5 font-mono bg-blue-50/60 px-1.5 py-0.5 rounded inline-block">예: {example}</div>}
    </div>
  );
}

export default function GuidePanel({
  title, currentStep, totalSteps, children,
  onPrev, onNext, onClose,
  showPrev = true, nextLabel, nextDisabled = false, hideFooter = false,
}: GuidePanelProps) {
  return (
    <div className="fixed bottom-20 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[400px] max-h-[75vh] z-[9998] bg-white rounded-xl shadow-2xl border border-gray-200/80 flex flex-col overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-samsung-blue/10 rounded-lg">
            <BookOpen className="w-4 h-4 text-samsung-blue" />
          </div>
          <span className="text-sm font-bold text-gray-800">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {currentStep + 1} / {totalSteps}
          </span>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-gray-100 shrink-0">
        <div
          className="h-full bg-samsung-blue transition-all duration-300 ease-out"
          style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
        />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
        {children}
      </div>

      {/* Footer */}
      {!hideFooter && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
          {showPrev && currentStep > 0 ? (
            <button
              onClick={onPrev}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              이전
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={onNext}
            disabled={nextDisabled}
            className="inline-flex items-center gap-1 px-4 py-1.5 text-[13px] font-semibold text-white bg-samsung-blue rounded-lg hover:bg-samsung-blue-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {nextLabel || (currentStep === totalSteps - 1 ? '완료' : '다음')}
            {currentStep < totalSteps - 1 && !nextLabel && <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}
