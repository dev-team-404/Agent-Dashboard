/**
 * OrgTreeSelector — 조직도 기반 부서 선택 체크박스 트리
 *
 * - 상위 체크 → 하위 전체 자동 체크
 * - 하위 전체 해제 → 상위 자동 해제
 * - 부분 선택 시 indeterminate 표시
 * - 검색 지원
 * - selected: departmentCode[] (외부 state)
 * - onChange: (departmentCodes: string[]) => void
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Search, Loader2, FolderTree } from 'lucide-react';
import { scopeApi } from '../services/api';

interface OrgNodeFlat {
  departmentCode: string;
  departmentName: string;
  enDepartmentName: string;
  parentDepartmentCode: string | null;
  hasChildren: boolean;
  userCount: number;
}

interface TreeNode extends OrgNodeFlat {
  children: TreeNode[];
}

interface OrgTreeSelectorProps {
  selected: string[];          // 선택된 departmentCode 배열
  onChange: (codes: string[]) => void;
  maxHeight?: string;          // 기본 'max-h-64'
}

// 플랫 → 트리 변환
function buildTree(nodes: OrgNodeFlat[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const n of nodes) {
    map.set(n.departmentCode, { ...n, children: [] });
  }
  for (const n of nodes) {
    const treeNode = map.get(n.departmentCode)!;
    if (n.parentDepartmentCode && map.has(n.parentDepartmentCode)) {
      map.get(n.parentDepartmentCode)!.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.departmentName.localeCompare(b.departmentName, 'ko'));
    list.forEach(n => sort(n.children));
  };
  sort(roots);
  return roots;
}

// 노드 + 모든 하위의 departmentCode 수집
function collectAllCodes(node: TreeNode): string[] {
  const codes = [node.departmentCode];
  for (const child of node.children) {
    codes.push(...collectAllCodes(child));
  }
  return codes;
}

// 트리 검색 필터
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  function matches(n: TreeNode): boolean {
    return n.departmentName.toLowerCase().includes(q) || n.enDepartmentName.toLowerCase().includes(q);
  }
  function filter(n: TreeNode): TreeNode | null {
    if (matches(n)) return n;
    const filteredChildren = n.children.map(filter).filter(Boolean) as TreeNode[];
    if (filteredChildren.length > 0) return { ...n, children: filteredChildren };
    return null;
  }
  return nodes.map(filter).filter(Boolean) as TreeNode[];
}

// ── 체크박스 노드 ──
function CheckNode({
  node,
  selectedSet,
  onToggle,
  expandedSet,
  toggleExpand,
  depth,
  searchQuery,
}: {
  node: TreeNode;
  selectedSet: Set<string>;
  onToggle: (node: TreeNode, checked: boolean) => void;
  expandedSet: Set<string>;
  toggleExpand: (code: string) => void;
  depth: number;
  searchQuery: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedSet.has(node.departmentCode);

  // 체크 상태 계산 (departmentCode 기반 — 동명 조직 구분)
  const allCodes = collectAllCodes(node);
  const checkedCount = allCodes.filter(c => selectedSet.has(c)).length;
  const isChecked = checkedCount === allCodes.length;
  const isIndeterminate = checkedCount > 0 && checkedCount < allCodes.length;

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const highlight = (text: string) => {
    if (!searchQuery) return text;
    const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="bg-yellow-200 text-yellow-900 rounded px-0.5">{text.slice(idx, idx + searchQuery.length)}</span>
        {text.slice(idx + searchQuery.length)}
      </>
    );
  };

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-gray-50 transition-colors"
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        {/* 확장/접기 */}
        <button
          type="button"
          className="w-4 h-4 flex-shrink-0 flex items-center justify-center"
          onClick={() => hasChildren && toggleExpand(node.departmentCode)}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          ) : (
            <span className="w-1 h-1 rounded-full bg-gray-300" />
          )}
        </button>

        {/* 체크박스 */}
        <input
          ref={ref}
          type="checkbox"
          checked={isChecked}
          onChange={(e) => onToggle(node, e.target.checked)}
          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0 cursor-pointer"
        />

        {/* 부서명 */}
        <label
          className="text-[13px] text-gray-800 cursor-pointer truncate select-none flex-1"
          onClick={() => onToggle(node, !isChecked)}
        >
          {highlight(node.departmentName)}
          {node.enDepartmentName && node.enDepartmentName !== node.departmentName && (
            <span className="text-[11px] text-gray-400 ml-1">{highlight(node.enDepartmentName)}</span>
          )}
        </label>

        {/* 사용자 수 */}
        {node.userCount > 0 && (
          <span className="text-[10px] text-gray-400 flex-shrink-0">{node.userCount}</span>
        )}
      </div>

      {/* 하위 노드 */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map(child => (
            <CheckNode
              key={child.departmentCode}
              node={child}
              selectedSet={selectedSet}
              onToggle={onToggle}
              expandedSet={expandedSet}
              toggleExpand={toggleExpand}
              depth={depth + 1}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ──
export default function OrgTreeSelector({ selected, onChange, maxHeight = 'max-h-64' }: OrgTreeSelectorProps) {
  const { t } = useTranslation();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const selectedSet = new Set(selected);

  const loadTree = useCallback(async () => {
    try {
      setLoading(true);
      const res = await scopeApi.orgTree();
      const nodes: OrgNodeFlat[] = res.data.nodes || [];
      const built = buildTree(nodes);
      setTree(built);

      // 루트 + 1단계 자동 확장
      const initial = new Set<string>();
      for (const root of built) {
        initial.add(root.departmentCode);
        for (const child of root.children) {
          if (child.children.length > 0) initial.add(child.departmentCode);
        }
      }
      setExpandedSet(initial);
    } catch {
      console.error('Failed to load org tree for scope selector');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // 검색 시 자동 확장
  useEffect(() => {
    if (!search) return;
    const filtered = filterTree(tree, search);
    const toExpand = new Set<string>();
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) {
          toExpand.add(n.departmentCode);
          collect(n.children);
        }
      }
    };
    collect(filtered);
    setExpandedSet(toExpand);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, tree]);

  const toggleExpand = (code: string) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // 체크/언체크 — 하위 전체 연동 (departmentCode 기반)
  const handleToggle = (node: TreeNode, checked: boolean) => {
    const allCodes = collectAllCodes(node);
    const newSet = new Set(selected);
    if (checked) {
      allCodes.forEach(c => newSet.add(c));
    } else {
      allCodes.forEach(c => newSet.delete(c));
    }
    onChange([...newSet]);
  };

  const filteredTree = filterTree(tree, search);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 justify-center text-gray-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('orgTreeSelector.loading')}
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-4 text-gray-400 text-sm">
        <FolderTree className="w-5 h-5" />
        <span>{t('orgTreeSelector.noData')}</span>
        <span className="text-[11px]">{t('orgTreeSelector.noDataGuide')}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 border border-gray-200 rounded-lg bg-white">
      {/* 검색 + 선택 현황 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('orgTreeSelector.searchPlaceholder')}
          className="flex-1 text-sm bg-transparent outline-none placeholder-gray-400"
        />
        {selected.length > 0 && (
          <span className="text-[11px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
            {t('orgTreeSelector.selectedCount', { count: selected.length })}
          </span>
        )}
      </div>

      {/* 트리 */}
      <div className={`${maxHeight} overflow-y-auto py-1 px-1`}>
        {filteredTree.length === 0 ? (
          <div className="text-center py-3 text-sm text-gray-400">{t('orgTreeSelector.noSearchResults')}</div>
        ) : (
          filteredTree.map(root => (
            <CheckNode
              key={root.departmentCode}
              node={root}
              selectedSet={selectedSet}
              onToggle={handleToggle}
              expandedSet={expandedSet}
              toggleExpand={toggleExpand}
              depth={0}
              searchQuery={search}
            />
          ))
        )}
      </div>
    </div>
  );
}
