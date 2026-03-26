/**
 * Scope Migration: departmentName → departmentCode
 *
 * visibilityScope / deployScopeValue에 저장된 departmentName을
 * departmentCode(고유 식별자)로 변환. 멱등성 보장.
 *
 * 실행: node scripts/migrate-scope-to-codes.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Scope Migration: departmentName → departmentCode\n');

  // 1. OrgNode 전체 로드
  const orgNodes = await prisma.orgNode.findMany({
    select: { departmentCode: true, departmentName: true, enDepartmentName: true, parentDepartmentCode: true },
  });

  const allCodes = new Set(orgNodes.map(n => n.departmentCode));
  const nameToCode = new Map();

  for (const n of orgNodes) {
    if (n.departmentName) {
      const arr = nameToCode.get(n.departmentName) || [];
      arr.push(n.departmentCode);
      nameToCode.set(n.departmentName, arr);
    }
    if (n.enDepartmentName && n.enDepartmentName !== n.departmentName) {
      const arr = nameToCode.get(n.enDepartmentName) || [];
      arr.push(n.departmentCode);
      nameToCode.set(n.enDepartmentName, arr);
    }
  }

  // 2. BU 약어 → departmentCode 맵
  const buToCode = new Map();
  const usersWithBU = await prisma.$queryRaw`
    SELECT DISTINCT business_unit, department_code
    FROM users
    WHERE business_unit IS NOT NULL AND business_unit != ''
      AND department_code IS NOT NULL AND department_code != ''
  `;
  for (const u of usersWithBU) {
    if (u.business_unit && u.department_code && !buToCode.has(u.business_unit)) {
      // 부모 체인 최상위 찾기
      let current = u.department_code;
      let buCode = current;
      let depth = 0;
      while (current && depth < 20) {
        buCode = current;
        const node = orgNodes.find(n => n.departmentCode === current);
        current = node?.parentDepartmentCode || null;
        depth++;
      }
      buToCode.set(u.business_unit, buCode);
    }
  }
  console.log(`  BU 약어 → 코드 매핑: ${buToCode.size}개`);

  function resolveValue(value) {
    if (allCodes.has(value)) return [value];
    const codes = nameToCode.get(value);
    if (codes?.length > 0) return codes;
    const buCode = buToCode.get(value);
    if (buCode) return [buCode];
    return [];
  }

  let totalConverted = 0;
  let totalKept = 0;
  const warnings = [];

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
    const newScope = [];
    let changed = false;

    for (const val of model.visibilityScope) {
      if (allCodes.has(val)) {
        newScope.push(val);
      } else {
        const codes = resolveValue(val);
        if (codes.length > 0) {
          newScope.push(...codes);
          changed = true;
          console.log(`  ✅ Model "${model.displayName}": "${val}" → [${codes.join(', ')}]`);
        } else {
          newScope.push(val);
          warnings.push(`Model "${model.displayName}" (${model.visibility}): "${val}" 매칭 실패`);
        }
      }
    }

    if (changed) {
      await prisma.model.update({
        where: { id: model.id },
        data: { visibilityScope: [...new Set(newScope)] },
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
    const newScope = [];
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
          warnings.push(`Service "${svc.name}" (${svc.deployScope}): "${val}" 매칭 실패`);
        }
      }
    }

    if (changed) {
      await prisma.service.update({
        where: { id: svc.id },
        data: { deployScopeValue: [...new Set(newScope)] },
      });
      totalConverted++;
    } else {
      totalKept++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ 변환 완료: ${totalConverted}개 업데이트`);
  console.log(`⏭️  이미 코드 형태: ${totalKept}개 (스킵)`);
  if (warnings.length > 0) {
    console.log(`\n⚠️  매칭 실패 (원본 유지): ${warnings.length}건`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log('='.repeat(60));
}

main()
  .catch(err => { console.error('❌ Migration failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
