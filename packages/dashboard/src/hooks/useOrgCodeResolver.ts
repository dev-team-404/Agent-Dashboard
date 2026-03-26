/**
 * departmentCode → departmentName 변환 훅
 *
 * OrgTree 데이터를 캐싱하여 departmentCode를 사람이 읽을 수 있는 부서명으로 변환.
 * visibilityScope/deployScopeValue가 departmentCode를 저장하므로
 * UI 표시 시 이 훅으로 이름을 resolve.
 */

import { useState, useEffect, useCallback } from 'react';
import { scopeApi } from '../services/api';

let cachedMap: Map<string, string> | null = null;

export function useOrgCodeResolver() {
  const [codeToName, setCodeToName] = useState<Map<string, string>>(cachedMap || new Map());

  useEffect(() => {
    if (cachedMap) {
      setCodeToName(cachedMap);
      return;
    }
    scopeApi.orgTree().then(res => {
      const nodes = res.data.nodes || [];
      const map = new Map<string, string>();
      for (const n of nodes) {
        map.set(n.departmentCode, n.departmentName);
      }
      cachedMap = map;
      setCodeToName(map);
    }).catch(() => {});
  }, []);

  const resolve = useCallback((code: string) => codeToName.get(code) || code, [codeToName]);
  const resolveAll = useCallback((codes: string[]) => codes.map(c => codeToName.get(c) || c), [codeToName]);

  return { resolve, resolveAll };
}
