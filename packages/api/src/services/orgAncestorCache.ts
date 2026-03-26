/**
 * OrgNode 조상 캐시
 *
 * 서버 시작 시 OrgNode 전체를 메모리에 로드하여
 * departmentCode → 모든 조상 코드 맵을 구축.
 *
 * BUSINESS_UNIT visibility 체크 시:
 *   visibilityScope에 사용자의 dept 또는 조상 코드가 포함되면 허용
 */

import { prisma } from '../index.js';

// departmentCode → Set<조상 코드 (자신 포함)>
let ancestorMap = new Map<string, Set<string>>();

/**
 * OrgNode 테이블 전체를 로드하여 조상 맵 구축
 * 서버 시작 시 & 조직도 변경 시 호출
 */
export async function loadOrgAncestorCache(): Promise<void> {
  try {
    const nodes = await prisma.orgNode.findMany({
      select: { departmentCode: true, parentDepartmentCode: true },
    });

    const parentMap = new Map<string, string | null>();
    for (const n of nodes) {
      parentMap.set(n.departmentCode, n.parentDepartmentCode);
    }

    const newAncestorMap = new Map<string, Set<string>>();
    for (const code of parentMap.keys()) {
      const ancestors = new Set<string>();
      let current: string | null | undefined = code;
      // 자기 자신 포함, 루트까지 순회 (순환 방지: 최대 20단계)
      let depth = 0;
      while (current && depth < 20) {
        ancestors.add(current);
        current = parentMap.get(current) ?? null;
        depth++;
      }
      newAncestorMap.set(code, ancestors);
    }

    ancestorMap = newAncestorMap;
    console.log(`[OrgAncestorCache] Loaded ${ancestorMap.size} departments`);
  } catch (err) {
    console.error('[OrgAncestorCache] Failed to load:', err);
  }
}

/**
 * 사용자의 departmentCode가 scopeCodes 중 하나의 하위에 있는지 확인
 * (자기 자신도 포함)
 *
 * BUSINESS_UNIT visibility: scopeCodes에 BU-level 코드가 들어있고,
 * 사용자의 팀 코드에서 조상을 타고 올라가 매칭.
 */
export function isUnderAnyScope(userDeptCode: string, scopeCodes: string[]): boolean {
  if (!userDeptCode || scopeCodes.length === 0) return false;

  const ancestors = ancestorMap.get(userDeptCode);
  if (!ancestors) return false;

  return scopeCodes.some(code => ancestors.has(code));
}

/**
 * 조상 맵 새로고침 (조직도 동기화 후 호출)
 */
export const refreshOrgAncestorCache = loadOrgAncestorCache;
