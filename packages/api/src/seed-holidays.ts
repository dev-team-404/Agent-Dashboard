/**
 * 한국 공휴일 시드 데이터 (2024–2027)
 *
 * docker compose up --build 시 자동 실행되어 holidays 테이블에 시드 데이터를 삽입합니다.
 * createMany + skipDuplicates 를 사용하므로 여러 번 실행해도 안전합니다.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface HolidaySeed {
  date: string; // YYYY-MM-DD
  name: string;
  type: 'NATIONAL' | 'COMPANY' | 'CUSTOM';
}

const KOREAN_HOLIDAYS: HolidaySeed[] = [
  // ── 2024 ──
  { date: '2024-01-01', name: '신정', type: 'NATIONAL' },
  { date: '2024-02-09', name: '설날 연휴', type: 'NATIONAL' },
  { date: '2024-02-10', name: '설날', type: 'NATIONAL' },
  { date: '2024-02-11', name: '설날 연휴', type: 'NATIONAL' },
  { date: '2024-02-12', name: '대체공휴일(설날)', type: 'NATIONAL' },
  { date: '2024-03-01', name: '삼일절', type: 'NATIONAL' },
  { date: '2024-04-10', name: '국회의원선거일', type: 'NATIONAL' },
  { date: '2024-05-05', name: '어린이날', type: 'NATIONAL' },
  { date: '2024-05-06', name: '대체공휴일(어린이날)', type: 'NATIONAL' },
  { date: '2024-05-15', name: '부처님오신날', type: 'NATIONAL' },
  { date: '2024-06-06', name: '현충일', type: 'NATIONAL' },
  { date: '2024-08-15', name: '광복절', type: 'NATIONAL' },
  { date: '2024-09-16', name: '추석 연휴', type: 'NATIONAL' },
  { date: '2024-09-17', name: '추석', type: 'NATIONAL' },
  { date: '2024-09-18', name: '추석 연휴', type: 'NATIONAL' },
  { date: '2024-10-03', name: '개천절', type: 'NATIONAL' },
  { date: '2024-10-09', name: '한글날', type: 'NATIONAL' },
  { date: '2024-12-25', name: '크리스마스', type: 'NATIONAL' },

  // ── 2025 ──
  { date: '2025-01-01', name: '신정', type: 'NATIONAL' },
  { date: '2025-01-28', name: '설날 연휴', type: 'NATIONAL' },
  { date: '2025-01-29', name: '설날', type: 'NATIONAL' },
  { date: '2025-01-30', name: '설날 연휴', type: 'NATIONAL' },
  { date: '2025-03-01', name: '삼일절', type: 'NATIONAL' },
  { date: '2025-05-05', name: '부처님오신날/어린이날', type: 'NATIONAL' },
  { date: '2025-05-06', name: '대체공휴일', type: 'NATIONAL' },
  { date: '2025-06-06', name: '현충일', type: 'NATIONAL' },
  { date: '2025-08-15', name: '광복절', type: 'NATIONAL' },
  { date: '2025-10-03', name: '개천절', type: 'NATIONAL' },
  { date: '2025-10-05', name: '추석 연휴', type: 'NATIONAL' },
  { date: '2025-10-06', name: '추석', type: 'NATIONAL' },
  { date: '2025-10-07', name: '추석 연휴', type: 'NATIONAL' },
  { date: '2025-10-08', name: '대체공휴일(추석)', type: 'NATIONAL' },
  { date: '2025-10-09', name: '한글날', type: 'NATIONAL' },
  { date: '2025-12-25', name: '크리스마스', type: 'NATIONAL' },

  // ── 2026 ──
  { date: '2026-01-01', name: '신정', type: 'NATIONAL' },
  { date: '2026-02-16', name: '설날 연휴', type: 'NATIONAL' },
  { date: '2026-02-17', name: '설날', type: 'NATIONAL' },
  { date: '2026-02-18', name: '설날 연휴', type: 'NATIONAL' },
  { date: '2026-03-01', name: '삼일절', type: 'NATIONAL' },
  { date: '2026-03-02', name: '대체공휴일(삼일절)', type: 'NATIONAL' },
  { date: '2026-05-05', name: '어린이날', type: 'NATIONAL' },
  { date: '2026-05-24', name: '부처님오신날', type: 'NATIONAL' },
  { date: '2026-05-25', name: '대체공휴일(부처님오신날)', type: 'NATIONAL' },
  { date: '2026-06-06', name: '현충일', type: 'NATIONAL' },
  { date: '2026-08-15', name: '광복절', type: 'NATIONAL' },
  { date: '2026-08-17', name: '대체공휴일(광복절)', type: 'NATIONAL' },
  { date: '2026-09-24', name: '추석 연휴', type: 'NATIONAL' },
  { date: '2026-09-25', name: '추석', type: 'NATIONAL' },
  { date: '2026-09-26', name: '추석 연휴', type: 'NATIONAL' },
  { date: '2026-10-03', name: '개천절', type: 'NATIONAL' },
  { date: '2026-10-05', name: '대체공휴일(개천절)', type: 'NATIONAL' },
  { date: '2026-10-09', name: '한글날', type: 'NATIONAL' },
  { date: '2026-12-25', name: '크리스마스', type: 'NATIONAL' },

  // ── 2027 ──
  { date: '2027-01-01', name: '신정', type: 'NATIONAL' },
  { date: '2027-02-06', name: '설날 연휴', type: 'NATIONAL' },
  { date: '2027-02-07', name: '설날', type: 'NATIONAL' },
  { date: '2027-02-08', name: '설날 연휴', type: 'NATIONAL' },
  { date: '2027-02-09', name: '대체공휴일(설날)', type: 'NATIONAL' },
  { date: '2027-03-01', name: '삼일절', type: 'NATIONAL' },
  { date: '2027-05-05', name: '어린이날', type: 'NATIONAL' },
  { date: '2027-05-13', name: '부처님오신날', type: 'NATIONAL' },
  { date: '2027-06-06', name: '현충일', type: 'NATIONAL' },
  { date: '2027-06-07', name: '대체공휴일(현충일)', type: 'NATIONAL' },
  { date: '2027-08-15', name: '광복절', type: 'NATIONAL' },
  { date: '2027-08-16', name: '대체공휴일(광복절)', type: 'NATIONAL' },
  { date: '2027-09-14', name: '추석 연휴', type: 'NATIONAL' },
  { date: '2027-09-15', name: '추석', type: 'NATIONAL' },
  { date: '2027-09-16', name: '추석 연휴', type: 'NATIONAL' },
  { date: '2027-10-03', name: '개천절', type: 'NATIONAL' },
  { date: '2027-10-04', name: '대체공휴일(개천절)', type: 'NATIONAL' },
  { date: '2027-10-09', name: '한글날', type: 'NATIONAL' },
  { date: '2027-10-11', name: '대체공휴일(한글날)', type: 'NATIONAL' },
  { date: '2027-12-25', name: '크리스마스', type: 'NATIONAL' },
];

async function seedHolidays() {
  console.log('[Seed] 한국 공휴일 시드 시작...');

  const result = await prisma.holiday.createMany({
    data: KOREAN_HOLIDAYS.map((h) => ({
      date: new Date(h.date + 'T00:00:00.000Z'),
      name: h.name,
      type: h.type,
    })),
    skipDuplicates: true,
  });

  console.log(`[Seed] 공휴일 ${result.count}개 신규 삽입 (총 ${KOREAN_HOLIDAYS.length}개 중 중복 제외)`);
}

async function main() {
  try {
    await seedHolidays();
  } catch (error) {
    console.error('[Seed] 시드 실패:', error);
    // 시드 실패해도 서버 기동은 계속 진행 (exit 하지 않음)
  } finally {
    await prisma.$disconnect();
  }
}

main();
