/**
 * 통합 로딩 스피너 컴포넌트
 * - fullPage: 페이지 전체 로딩 (기본)
 * - inline: 섹션/카드 내부
 * - TableLoadingRow: 테이블 tbody 내 로딩 행
 */

interface LoadingSpinnerProps {
  /** 로딩 메시지 (null이면 숨김) */
  message?: string | null;
  /** 스피너 크기 */
  size?: 'sm' | 'md' | 'lg';
  /** 전체 페이지 높이 차지 여부 */
  fullPage?: boolean;
  className?: string;
}

const SIZES = {
  sm: { ring: 'w-7 h-7', border: 'border-[2.5px]', text: 'text-xs', gap: 'mt-2.5' },
  md: { ring: 'w-11 h-11', border: 'border-[3px]', text: 'text-[13px]', gap: 'mt-3.5' },
  lg: { ring: 'w-14 h-14', border: 'border-[3px]', text: 'text-sm', gap: 'mt-4' },
} as const;

export default function LoadingSpinner({
  message = '데이터를 불러오는 중...',
  size = 'md',
  fullPage = true,
  className = '',
}: LoadingSpinnerProps) {
  const s = SIZES[size];

  const spinner = (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="relative">
        {/* 배경 링 */}
        <div className={`${s.ring} rounded-full ${s.border} border-gray-200/60`} />
        {/* 회전 링 */}
        <div
          className={`absolute inset-0 ${s.ring} rounded-full ${s.border} border-samsung-blue border-t-transparent animate-spin`}
        />
      </div>
      {message && (
        <p className={`${s.gap} ${s.text} font-medium text-pastel-500`}>
          {message}
        </p>
      )}
    </div>
  );

  if (fullPage) {
    return (
      <div className="flex items-center justify-center h-[60vh] animate-fade-in">
        {spinner}
      </div>
    );
  }

  return spinner;
}

/** 테이블 tbody 안에서 사용하는 로딩 행 */
export function TableLoadingRow({
  colSpan,
  message = '데이터를 불러오는 중...',
}: {
  colSpan: number;
  message?: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-20 text-center">
        <LoadingSpinner fullPage={false} message={message} />
      </td>
    </tr>
  );
}
