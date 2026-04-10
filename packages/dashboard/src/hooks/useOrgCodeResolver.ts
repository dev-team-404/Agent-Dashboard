/**
 * departmentCode → departmentName 변환 훅
 *
 * OrgTree 데이터를 캐싱하여 departmentCode를 사람이 읽을 수 있는 부서명으로 변환.
 * visibilityScope/deployScopeValue가 departmentCode를 저장하므로
 * UI 표시 시 이 훅으로 이름을 resolve.
 *
 * summarizeScope: deployScopeValue를 상위 부서 기준으로 그룹핑하여 요약 뱃지 배열 반환
 */

import { useState, useEffect, useCallback } from 'react';
import { scopeApi } from '../services/api';

interface OrgNode {
  departmentCode: string;
  departmentName: string;
  parentDepartmentCode: string | null;
}

interface TreeNode {
  code: string;
  name: string;
  children: TreeNode[];
}

export interface ScopeSummaryItem {
  label: string;       // 표시 텍스트 (e.g. "○○사업부 (전체)")
  isAll: boolean;      // 해당 부서 하위 전체 선택 여부
  count: number;       // 선택된 하위 부서 수
  totalChildren: number; // 전체 하위 부서 수
}

let cachedMap: Map<string, string> | null = null;
let cachedNodes: OrgNode[] | null = null;

function buildTree(nodes: OrgNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const n of nodes) {
    map.set(n.departmentCode, { code: n.departmentCode, name: n.departmentName, children: [] });
  }
  for (const n of nodes) {
    const treeNode = map.get(n.departmentCode)!;
    if (n.parentDepartmentCode && map.has(n.parentDepartmentCode)) {
      map.get(n.parentDepartmentCode)!.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }
  return roots;
}

function collectAllCodes(node: TreeNode): string[] {
  const codes = [node.code];
  for (const child of node.children) {
    codes.push(...collectAllCodes(child));
  }
  return codes;
}

function computeSummary(selectedCodes: string[], nodes: OrgNode[]): ScopeSummaryItem[] {
  if (!selectedCodes.length || !nodes.length) return [];

  const selectedSet = new Set(selectedCodes);
  const roots = buildTree(nodes);
  const result: ScopeSummaryItem[] = [];

  for (const root of roots) {
    const allCodes = collectAllCodes(root);
    const selectedInRoot = allCodes.filter(c => selectedSet.has(c));

    if (selectedInRoot.length === 0) continue;

    const totalChildren = allCodes.length;
    const isAll = selectedInRoot.length === totalChildren;

    if (isAll) {
      result.push({
        label: `${root.name} (전체)`,
        isAll: true,
        count: totalChildren,
        totalChildren,
      });
    } else if (selectedInRoot.length <= 3) {
      // 소수 선택 시 개별 이름 표시
      const names = selectedInRoot
        .map(c => {
          const n = nodes.find(nd => nd.departmentCode === c);
          return n ? n.departmentName : c;
        })
        .filter(name => name !== root.name); // 루트 자체 제외
      const label = names.length > 0
        ? `${root.name} — ${names.join(', ')}`
        : root.name;
      result.push({
        label,
        isAll: false,
        count: selectedInRoot.length,
        totalChildren,
      });
    } else {
      result.push({
        label: `${root.name} (${selectedInRoot.length}개 팀)`,
        isAll: false,
        count: selectedInRoot.length,
        totalChildren,
      });
    }
  }

  return result;
}

export function useOrgCodeResolver() {
  const [codeToName, setCodeToName] = useState<Map<string, string>>(cachedMap || new Map());
  const [nodes, setNodes] = useState<OrgNode[]>(cachedNodes || []);

  useEffect(() => {
    if (cachedMap && cachedNodes) {
      setCodeToName(cachedMap);
      setNodes(cachedNodes);
      return;
    }
    scopeApi.orgTree().then(res => {
      const rawNodes = res.data.nodes || [];
      const map = new Map<string, string>();
      const orgNodes: OrgNode[] = [];
      for (const n of rawNodes) {
        map.set(n.departmentCode, n.departmentName);
        orgNodes.push({
          departmentCode: n.departmentCode,
          departmentName: n.departmentName,
          parentDepartmentCode: n.parentDepartmentCode ?? null,
        });
      }
      cachedMap = map;
      cachedNodes = orgNodes;
      setCodeToName(map);
      setNodes(orgNodes);
    }).catch(() => {});
  }, []);

  const resolve = useCallback((code: string) => codeToName.get(code) || code, [codeToName]);
  const resolveAll = useCallback((codes: string[]) => codes.map(c => codeToName.get(c) || c), [codeToName]);
  const summarizeScope = useCallback((codes: string[]) => computeSummary(codes, nodes), [nodes]);

  return { resolve, resolveAll, summarizeScope };
}
