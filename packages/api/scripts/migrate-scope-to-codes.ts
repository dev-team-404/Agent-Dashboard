/**
 * Scope Migration: departmentName → departmentCode
 *
 * visibilityScope / deployScopeValue에 저장된 departmentName(한글)을
 * departmentCode(고유 식별자)로 변환합니다.
 *
 * 변환 로직:
 * 1. OrgNode.departmentName 또는 enDepartmentName으로 코드 조회
 * 2. User.businessUnit으로 BU-level OrgNode 역추적 (auto-fill된 BU 약어)
 * 3. 매칭 실패 → 원본 유지 + 경고 로그
 *
 * 멱등성: 이미 departmentCode 형태인 값은 건너뜀 (OrgNode에서 코드로 확인)
 *
 * 실행:
 *   cd packages/api
 *   npx ts-node scripts/migrate-scope-to-codes.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Scope Migration: departmentName → departmentCode\n');

  // 1. OrgNode 전체 로드 → name/enName → code 맵 구축
  const orgNodes = await prisma.orgNode.findMany({
    select: { departmentCode: true, departmentName: true, enDepartmentName: true },
  });

  const allCodes = new Set(orgNodes.map(n => n.departmentCode));
  const nameToCode = new Map<string, string[]>();  // name → [code, code, ...] (동명 가능)

  for (const n of orgNodes) {
    // 한글명
    if (n.departmentName) {
      const existing = nameToCode.get(n.departmentName) || [];
      existing.push(n.departmentCode);
      nameToCode.set(n.departmentName, existing);
    }
    // 영문명
    if (n.enDepartmentName && n.enDepartmentName !== n.departmentName) {
      const existing = nameToCode.get(n.enDepartmentName) || [];
      existing.push(n.departmentCode);
      nameToCode.set(n.enDepartmentName, existing);
    }
  }

  // 2. BU 약어 → departmentCode 맵 (auto-fill에서 생성된 "S.LSI" 같은 값 대응)
  //    User.businessUnit 역추적: BU 약어가 어떤 User에게 속하는지 → 그 User의 departmentCode → 부모 체인에서 BU 레벨 찾기
  const buToCode = new Map<string, string>();
  const usersWithBU = await prisma.user.findMany({
    where: { businessUnit: { not: '' } },
    select: { businessUnit: true, departmentCode: true },
    distinct: ['businessUnit'],
  });
  for (const u of usersWithBU) {
    if (u.businessUnit && u.departmentCode && !buToCode.has(u.businessUnit)) {
      // 부모 체인 순회하여 가장 높은 레벨의 코드를 BU 코드로 사용
      let current: string | null = u.departmentCode;
      let buCode = u.departmentCode;
      let depth = 0;
      while (current && depth < 20) {
        buCode = current;
        const node = orgNodes.find(n => n.departmentCode === current);
        if (!node) break;
        const parent = await prisma.orgNode.findUnique({
          where: { departmentCode: current },
          select: { parentDepartmentCode: true },
        });
        current = parent?.parentDepartmentCode || null;
        depth++;
      }
      buToCode.set(u.businessUnit, buCode);
    }
  }
  console.log(`  BU 약어 → 코드 매핑: ${buToCode.size}개`);

  // 변환 함수
  function resolveValue(value: string): string[] {
    // 이미 departmentCode인 경우 → 그대로
    if (allCodes.has(value)) return [value];

    // departmentName/enDepartmentName으로 조회
    const codes = nameToCode.get(value);
    if (codes && codes.length > 0) return codes;

    // BU 약어로 조회 (auto-fill에서 생성된 "S.LSI" 등)
    const buCode = buToCode.get(value);
    if (buCode) return [buCode];

    // 매칭 실패
    return [];
  }

  let totalConverted = 0;
  let totalKept = 0;
  const warnings: string[] = [];

  // 3. Model.visibilityScope 변환
  const scopedModels = await prisma.model.findMany({
    where: {
      visibility: { in: ['TEAM', 'BUSINESS_UNIT'] },
      visibilityScope: { isEmpty: false },
    },
    select: { id: true, displayName: true, visibility: true, visibilityScope: true },
  });

  console.log(`\n📦 Models: ${scopedModels.length}개 대상`);
  for (const model of scopedModels) {
    const newScope: string[] = [];
    let changed = false;

    for (const val of model.visibilityScope) {
      if (allCodes.has(val)) {
        // 이미 코드
        newScope.push(val);
      } else {
        const codes = resolveValue(val);
        if (codes.length > 0) {
          newScope.push(...codes);
          changed = true;
          console.log(`  ✅ Model "${model.displayName}": "${val}" → [${codes.join(', ')}]`);
        } else {
          // 매칭 실패 → 원본 유지
          newScope.push(val);
          warnings.push(`Model "${model.displayName}" (${model.visibility}): "${val}" 매칭 실패 — 원본 유지`);
        }
      }
    }

    if (changed) {
      // 중복 제거
      const uniqueScope = [...new Set(newScope)];
      await prisma.model.update({
        where: { id: model.id },
        data: { visibilityScope: uniqueScope },
      });
      totalConverted++;
    } else {
      totalKept++;
    }
  }

  // 4. Service.deployScopeValue 변환
  const scopedServices = await prisma.service.findMany({
    where: {
      deployScope: { in: ['TEAM', 'BUSINESS_UNIT'] },
      deployScopeValue: { isEmpty: false },
    },
    select: { id: true, name: true, deployScope: true, deployScopeValue: true },
  });

  console.log(`\n🔧 Services: ${scopedServices.length}개 대상`);
  for (const svc of scopedServices) {
    const newScope: string[] = [];
    let changed = false;

    for (const val of svc.deployScopeValue) {
      if (allCodes.has(val)) {
        newScope.push(val);
      } else {
        const codes = resolveValue(val);
        if (codes.length > 0) {
          newScope.push(...codes);
          changed = true;
          console.log(`  ✅ Service "${svc.name}": "${val}" → [${codes.join(', ')}]`);
        } else {
          newScope.push(val);
          warnings.push(`Service "${svc.name}" (${svc.deployScope}): "${val}" 매칭 실패 — 원본 유지`);
        }
      }
    }

    if (changed) {
      const uniqueScope = [...new Set(newScope)];
      await prisma.service.update({
        where: { id: svc.id },
        data: { deployScopeValue: uniqueScope },
      });
      totalConverted++;
    } else {
      totalKept++;
    }
  }

  // 결과 출력
  console.log('\n' + '='.repeat(60));
  console.log(`✅ 변환 완료: ${totalConverted}개 업데이트`);
  console.log(`⏭️  이미 코드 형태: ${totalKept}개 (스킵)`);

  if (warnings.length > 0) {
    console.log(`\n⚠️  매칭 실패 (원본 유지): ${warnings.length}건`);
    for (const w of warnings) {
      console.log(`  - ${w}`);
    }
  }
  console.log('='.repeat(60));
}

main()
  .catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
