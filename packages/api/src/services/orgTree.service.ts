/**
 * Organization Tree Service
 *
 * Knox Organization API를 recursive하게 호출하여 조직도 트리를 구축/관리
 * - 부서코드 → 상위부서코드(uprDepartmentCode)를 따라 최상위까지 탐색
 * - 결과를 org_nodes 테이블에 캐싱
 * - 사용자 접속 시 자동으로 해당 부서 경로를 트리에 추가
 */

import { prisma } from '../index.js';
import { lookupOrganization } from './knoxEmployee.service.js';

const MAX_DEPTH = 15; // 무한 루프 방지 최대 깊이

interface OrgTreeNode {
  id: string;
  departmentCode: string;
  departmentName: string;
  enDepartmentName: string;
  parentDepartmentCode: string | null;
  departmentLevel: string | null;
  companyCode: string | null;
  managerId: string | null;
  managerName: string | null;
  hasChildren: boolean;
  userCount: number;
  children: OrgTreeNode[];
}

/**
 * 특정 부서코드에서 시작하여 최상위까지 recursive하게 탐색,
 * 경로상의 모든 부서를 org_nodes에 저장
 *
 * @returns 발견/저장된 노드 수
 */
export async function discoverDepartment(departmentCode: string): Promise<number> {
  if (!departmentCode) return 0;

  let currentCode: string | null = departmentCode;
  let discovered = 0;
  const visited = new Set<string>(); // 순환 방지

  for (let depth = 0; depth < MAX_DEPTH && currentCode; depth++) {
    if (visited.has(currentCode)) break;
    visited.add(currentCode);

    // 이미 DB에 있으면 중단 (이 부서 위로는 이미 구축됨)
    const existing = await prisma.orgNode.findUnique({
      where: { departmentCode: currentCode },
    });
    if (existing) break;

    // Knox Organization API 호출
    const org = await lookupOrganization(currentCode);
    if (!org) {
      console.log(`[OrgTree] Knox lookup failed for ${currentCode}, stopping traversal`);
      break;
    }

    // 노드 저장
    try {
      await prisma.orgNode.upsert({
        where: { departmentCode: currentCode },
        update: {
          departmentName: org.departmentName || '',
          enDepartmentName: org.enDepartmentName || '',
          parentDepartmentCode: org.uprDepartmentCode || null,
          departmentLevel: org.departmentLevel || null,
          companyCode: org.companyCode || null,
          managerId: org.managerId || null,
          managerName: org.managerName || null,
          hasChildren: org.lowDepartmentYn === 'T',
        },
        create: {
          departmentCode: currentCode,
          departmentName: org.departmentName || '',
          enDepartmentName: org.enDepartmentName || '',
          parentDepartmentCode: org.uprDepartmentCode || null,
          departmentLevel: org.departmentLevel || null,
          companyCode: org.companyCode || null,
          managerId: org.managerId || null,
          managerName: org.managerName || null,
          hasChildren: org.lowDepartmentYn === 'T',
        },
      });
      discovered++;
      console.log(`[OrgTree] Discovered: ${currentCode} → "${org.departmentName}" (${org.enDepartmentName})`);
    } catch (err) {
      console.error(`[OrgTree] Failed to save node ${currentCode}:`, err);
      break;
    }

    // 상위 부서로 이동
    currentCode = org.uprDepartmentCode || null;
  }

  return discovered;
}

/**
 * users 테이블의 모든 departmentCode에 대해 discoverDepartment 실행
 * @returns { total, discovered, errors }
 */
export async function syncFromUsers(): Promise<{
  total: number;
  discovered: number;
  alreadyExist: number;
  errors: string[];
}> {
  // departmentCode가 있는 고유 부서 목록 중 org_nodes에 없는 것만
  const missingDepts = await prisma.$queryRaw<Array<{
    department_code: string;
  }>>`
    SELECT DISTINCT u.department_code
    FROM users u
    WHERE u.department_code IS NOT NULL
      AND u.department_code != ''
      AND NOT EXISTS (
        SELECT 1 FROM org_nodes o
        WHERE o.department_code = u.department_code
      )
  `;

  const existingCount = await prisma.orgNode.count();
  let discovered = 0;
  const errors: string[] = [];

  for (const dept of missingDepts) {
    try {
      const count = await discoverDepartment(dept.department_code);
      discovered += count;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${dept.department_code}: ${msg}`);
    }
  }

  // 동기화 후 userCount 업데이트
  await updateUserCounts();

  return {
    total: missingDepts.length,
    discovered,
    alreadyExist: existingCount,
    errors,
  };
}

/**
 * 각 org_nodes의 userCount를 users 테이블 기준으로 갱신
 */
export async function updateUserCounts(): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE org_nodes o
      SET user_count = COALESCE(sub.cnt, 0)
      FROM (
        SELECT department_code, COUNT(*)::int AS cnt
        FROM users
        WHERE department_code IS NOT NULL AND department_code != ''
        GROUP BY department_code
      ) sub
      WHERE o.department_code = sub.department_code
    `;
    // 매칭 안되는 노드는 0으로 리셋
    await prisma.$executeRaw`
      UPDATE org_nodes SET user_count = 0
      WHERE department_code NOT IN (
        SELECT DISTINCT department_code FROM users
        WHERE department_code IS NOT NULL AND department_code != ''
      )
    `;
  } catch (err) {
    console.error('[OrgTree] Failed to update user counts:', err);
  }
}

/**
 * DB의 모든 org_nodes를 tree 형태로 반환
 */
export async function getFullOrgTree(): Promise<OrgTreeNode[]> {
  // userCount 최신화 후 조회
  await updateUserCounts();

  const allNodes = await prisma.orgNode.findMany({
    orderBy: [
      { departmentLevel: 'asc' },
      { departmentName: 'asc' },
    ],
  });

  return buildTree(allNodes);
}

/**
 * 플랫 노드 리스트를 tree 구조로 변환
 */
function buildTree(nodes: Array<{
  id: string;
  departmentCode: string;
  departmentName: string;
  enDepartmentName: string;
  parentDepartmentCode: string | null;
  departmentLevel: string | null;
  companyCode: string | null;
  managerId: string | null;
  managerName: string | null;
  hasChildren: boolean;
  userCount: number;
}>): OrgTreeNode[] {
  const nodeMap = new Map<string, OrgTreeNode>();
  const roots: OrgTreeNode[] = [];

  // 모든 노드를 map에 등록
  for (const node of nodes) {
    nodeMap.set(node.departmentCode, {
      ...node,
      children: [],
    });
  }

  // 부모-자식 관계 연결
  for (const node of nodes) {
    const treeNode = nodeMap.get(node.departmentCode)!;

    if (node.parentDepartmentCode && nodeMap.has(node.parentDepartmentCode)) {
      // 부모가 DB에 있으면 자식으로 추가
      nodeMap.get(node.parentDepartmentCode)!.children.push(treeNode);
    } else {
      // 부모가 없거나 DB에 부모 노드가 없으면 root
      roots.push(treeNode);
    }
  }

  // 각 레벨에서 children을 이름순 정렬
  const sortChildren = (node: OrgTreeNode) => {
    node.children.sort((a, b) => a.departmentName.localeCompare(b.departmentName, 'ko'));
    node.children.forEach(sortChildren);
  };
  roots.sort((a, b) => a.departmentName.localeCompare(b.departmentName, 'ko'));
  roots.forEach(sortChildren);

  return roots;
}

/**
 * 특정 노드의 정보 + 직계 하위 노드 조회
 */
export async function getNodeWithChildren(departmentCode: string): Promise<OrgTreeNode | null> {
  const node = await prisma.orgNode.findUnique({
    where: { departmentCode },
  });
  if (!node) return null;

  const children = await prisma.orgNode.findMany({
    where: { parentDepartmentCode: departmentCode },
    orderBy: { departmentName: 'asc' },
  });

  return {
    ...node,
    children: children.map((c: any) => ({ ...c, children: [] as OrgTreeNode[] })),
  };
}

/**
 * 단일 노드 강제 갱신 (Knox API 재호출)
 */
export async function refreshNode(departmentCode: string): Promise<boolean> {
  const org = await lookupOrganization(departmentCode);
  if (!org) return false;

  await prisma.orgNode.upsert({
    where: { departmentCode },
    update: {
      departmentName: org.departmentName || '',
      enDepartmentName: org.enDepartmentName || '',
      parentDepartmentCode: org.uprDepartmentCode || null,
      departmentLevel: org.departmentLevel || null,
      companyCode: org.companyCode || null,
      managerId: org.managerId || null,
      managerName: org.managerName || null,
      hasChildren: org.lowDepartmentYn === 'T',
    },
    create: {
      departmentCode,
      departmentName: org.departmentName || '',
      enDepartmentName: org.enDepartmentName || '',
      parentDepartmentCode: org.uprDepartmentCode || null,
      departmentLevel: org.departmentLevel || null,
      companyCode: org.companyCode || null,
      managerId: org.managerId || null,
      managerName: org.managerName || null,
      hasChildren: org.lowDepartmentYn === 'T',
    },
  });

  return true;
}

/**
 * 조직개편 대응: 서비스/모델의 scope에서 org_nodes에 없는 departmentCode 제거
 *
 * - Service.deployScopeValue에서 유효하지 않은 코드 제거
 * - Model.visibilityScope에서 유효하지 않은 코드 제거
 * - TEAM/BUSINESS_UNIT scope 모두 대상
 *
 * @returns { servicesFixed, modelsFixed, removedCodes }
 */
export async function cleanupStaleScopes(): Promise<{
  servicesFixed: number;
  modelsFixed: number;
  removedCodes: string[];
}> {
  // 현재 유효한 departmentCode 목록
  const validNodes = await prisma.orgNode.findMany({
    select: { departmentCode: true },
  });
  const validCodes = new Set(validNodes.map(n => n.departmentCode));

  let servicesFixed = 0;
  let modelsFixed = 0;
  const removedCodes: string[] = [];

  // 1. Service — TEAM/BUSINESS_UNIT scope 중 deployScopeValue에 유효하지 않은 코드가 있는 서비스
  const scopedServices = await prisma.service.findMany({
    where: {
      deployScope: { in: ['TEAM', 'BUSINESS_UNIT'] },
      deployScopeValue: { isEmpty: false },
    },
    select: { id: true, deployScopeValue: true },
  });

  for (const svc of scopedServices) {
    const cleaned = svc.deployScopeValue.filter(code => validCodes.has(code));
    const removed = svc.deployScopeValue.filter(code => !validCodes.has(code));
    if (removed.length > 0) {
      await prisma.service.update({
        where: { id: svc.id },
        data: { deployScopeValue: cleaned },
      });
      servicesFixed++;
      removedCodes.push(...removed);
    }
  }

  // 2. Model — TEAM/BUSINESS_UNIT visibility 중 visibilityScope에 유효하지 않은 코드가 있는 모델
  const scopedModels = await prisma.model.findMany({
    where: {
      visibility: { in: ['TEAM', 'BUSINESS_UNIT'] },
      visibilityScope: { isEmpty: false },
    },
    select: { id: true, visibilityScope: true },
  });

  for (const mdl of scopedModels) {
    const cleaned = mdl.visibilityScope.filter(code => validCodes.has(code));
    const removed = mdl.visibilityScope.filter(code => !validCodes.has(code));
    if (removed.length > 0) {
      await prisma.model.update({
        where: { id: mdl.id },
        data: { visibilityScope: cleaned },
      });
      modelsFixed++;
      removedCodes.push(...removed);
    }
  }

  if (removedCodes.length > 0) {
    console.log(`[OrgTree] Stale scope cleanup: removed ${removedCodes.length} entries from ${servicesFixed} services, ${modelsFixed} models`);
    console.log(`[OrgTree] Removed codes: ${[...new Set(removedCodes)].join(', ')}`);
  }

  // 조상 캐시 갱신
  try {
    const { refreshOrgAncestorCache } = await import('./orgAncestorCache.js');
    await refreshOrgAncestorCache();
  } catch {}

  return { servicesFixed, modelsFixed, removedCodes: [...new Set(removedCodes)] };
}

// ── org_nodes 기반 부서 계층 조회 (department_hierarchies 대체) ──

export interface OrgHierarchy {
  team: string;        // 영문 팀이름 (본인 노드의 enDepartmentName)
  center2Name: string; // 부모 노드의 enDepartmentName
  center1Name: string; // 조부모 노드의 enDepartmentName
}

/**
 * org_nodes 기반으로 단일 부서의 계층 정보 조회
 * 노드 미존재 시 discoverDepartment로 자동 탐색
 */
export async function getHierarchyFromOrgTree(departmentCode: string): Promise<OrgHierarchy | null> {
  if (!departmentCode) return null;

  let node = await prisma.orgNode.findUnique({ where: { departmentCode } });
  if (!node) {
    await discoverDepartment(departmentCode);
    node = await prisma.orgNode.findUnique({ where: { departmentCode } });
    if (!node) return null;
  }

  const team = node.enDepartmentName || '';
  let center2Name = '';
  let center1Name = '';

  if (node.parentDepartmentCode) {
    const parent = await prisma.orgNode.findUnique({
      where: { departmentCode: node.parentDepartmentCode },
    });
    if (parent) {
      center2Name = parent.enDepartmentName || '';
      if (parent.parentDepartmentCode) {
        const grandparent = await prisma.orgNode.findUnique({
          where: { departmentCode: parent.parentDepartmentCode },
        });
        if (grandparent) {
          center1Name = grandparent.enDepartmentName || '';
        }
      }
    }
  }

  return { team, center2Name, center1Name };
}

/**
 * 전체 org_nodes에서 departmentName(한글) → {team, center2Name, center1Name} 맵 생성
 * insight 등 bulk 조회용
 */
export async function buildAllHierarchyMap(): Promise<Map<string, OrgHierarchy>> {
  const allNodes = await prisma.orgNode.findMany();
  const codeMap = new Map(allNodes.map(n => [n.departmentCode, n]));
  const result = new Map<string, OrgHierarchy>();

  for (const node of allNodes) {
    const team = node.enDepartmentName || '';
    let center2Name = '';
    let center1Name = '';

    if (node.parentDepartmentCode) {
      const parent = codeMap.get(node.parentDepartmentCode);
      if (parent) {
        center2Name = parent.enDepartmentName || '';
        if (parent.parentDepartmentCode) {
          const grandparent = codeMap.get(parent.parentDepartmentCode);
          if (grandparent) {
            center1Name = grandparent.enDepartmentName || '';
          }
        }
      }
    }

    result.set(node.departmentName, { team, center2Name, center1Name });
  }

  return result;
}
