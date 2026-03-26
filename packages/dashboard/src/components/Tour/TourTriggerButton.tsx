import { Bot } from 'lucide-react';
import { useTour } from '../../hooks/useTour';

export default function TourTriggerButton() {
  const { startTour, isTourActive, isTourCompleted } = useTour();

  if (isTourActive) return null;

  return (
    <button
      onClick={startTour}
      title="가이드 투어 시작"
      className={`
        fixed bottom-6 right-6 z-[9999]
        w-12 h-12 rounded-full
        bg-samsung-blue text-white
        shadow-lg hover:shadow-xl
        flex items-center justify-center
        hover:bg-samsung-blue-dark
        transform hover:scale-105 active:scale-95
        transition-all duration-200
        ${!isTourCompleted ? 'animate-bounce-gentle' : ''}
      `}
      style={{
        animation: !isTourCompleted ? undefined : 'none',
      }}
    >
      <Bot className="w-6 h-6" />

      {/* 미완료 시 알림 뱃지 */}
      {!isTourCompleted && (
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white" />
      )}
    </button>
  );
}
