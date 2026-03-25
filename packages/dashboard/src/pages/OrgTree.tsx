import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, AlertCircle, ChevronDown, ChevronRight, Users, Building2, Search, FolderTree } from 'lucide-react';
import { orgTreeApi } from '../services/api';

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

interface Stats {
  totalNodes: number;
  rootNodes: number;
  nodesWithUsers: number;
}

// 레벨별 색상
const LEVEL_COLORS = [
  { bg: 'bg-slate-900', text: 'text-white', border: 'border-slate-700', line: 'bg-slate-400' },
  { bg: 'bg-blue-600', text: 'text-white', border: 'border-blue-500', line: 'bg-blue-400' },
  { bg: 'bg-indigo-500', text: 'text-white', border: 'border-indigo-400', line: 'bg-indigo-300' },
  { bg: 'bg-violet-100', text: 'text-violet-900', border: 'border-violet-300', line: 'bg-violet-300' },
  { bg: 'bg-sky-50', text: 'text-sky-900', border: 'border-sky-200', line: 'bg-sky-300' },
  { bg: 'bg-emerald-50', text: 'text-emerald-900', border: 'border-emerald-200', line: 'bg-emerald-300' },
  { bg: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-200', line: 'bg-amber-300' },
  { bg: 'bg-rose-50', text: 'text-rose-900', border: 'border-rose-200', line: 'bg-rose-300' },
];

// 트리에서 검색
function filterTree(nodes: OrgTreeNode[], query: string): OrgTreeNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();

  function matches(node: OrgTreeNode): boolean {
    return (
      node.departmentName.toLowerCase().includes(q) ||
      node.enDepartmentName.toLowerCase().includes(q) ||
      node.departmentCode.toLowerCase().includes(q) ||
      (node.managerName || '').toLowerCase().includes(q)
    );
  }

  function filterNode(node: OrgTreeNode): OrgTreeNode | null {
    if (matches(node)) return node; // 매칭되면 자기 + 모든 자식 표시
    const filteredChildren = node.children.map(filterNode).filter(Boolean) as OrgTreeNode[];
    if (filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    return null;
  }

  return nodes.map(filterNode).filter(Boolean) as OrgTreeNode[];
}

// ── 트리 노드 컴포넌트 ──
function TreeNode({
  node,
  depth,
  expandedSet,
  toggleExpand,
  searchQuery,
}: {
  node: OrgTreeNode;
  depth: number;
  expandedSet: Set<string>;
  toggleExpand: (code: string) => void;
  searchQuery: string;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedSet.has(node.departmentCode);
  const colors = LEVEL_COLORS[Math.min(depth, LEVEL_COLORS.length - 1)];

  // 검색어 하이라이트
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
    <div className="flex flex-col items-center">
      {/* 노드 카드 */}
      <div
        className={`relative rounded-lg border ${colors.border} ${colors.bg} ${colors.text}
          px-4 py-2.5 min-w-[180px] max-w-[280px] cursor-pointer select-none
          transition-all duration-150 hover:shadow-md hover:scale-[1.02]`}
        onClick={() => hasChildren && toggleExpand(node.departmentCode)}
      >
        {/* 한글 부서명 */}
        <div className="font-semibold text-[13px] leading-tight text-center">
          {highlight(node.departmentName)}
        </div>
        {/* 영문 부서명 */}
        {node.enDepartmentName && node.enDepartmentName !== node.departmentName && (
          <div className={`text-[11px] mt-0.5 text-center ${depth <= 2 ? 'text-white/70' : 'text-gray-500'}`}>
            {highlight(node.enDepartmentName)}
          </div>
        )}
        {/* 메타 정보 */}
        <div className={`flex items-center justify-center gap-2 mt-1.5 text-[10px] ${depth <= 2 ? 'text-white/60' : 'text-gray-400'}`}>
          {node.userCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Users className="w-3 h-3" />
              {node.userCount}
            </span>
          )}
          {node.managerName && (
            <span className="truncate max-w-[100px]">{node.managerName}</span>
          )}
          {hasChildren && (
            <span className="flex items-center gap-0.5">
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {node.children.length}
            </span>
          )}
        </div>
      </div>

      {/* 하위 부서 */}
      {hasChildren && isExpanded && (
        <div className="flex flex-col items-center mt-0">
          {/* 세로 연결선 */}
          <div className={`w-px h-5 ${colors.line}`} />

          {/* 가로 연결선 + 자식들 */}
          <div className="relative flex">
            {/* 가로 바 */}
            {node.children.length > 1 && (
              <div
                className={`absolute top-0 h-px ${colors.line}`}
                style={{
                  left: `calc(50% / ${node.children.length})`,
                  right: `calc(50% / ${node.children.length})`,
                }}
              />
            )}

            <div className="flex gap-2">
              {node.children.map((child) => (
                <div key={child.departmentCode} className="flex flex-col items-center">
                  {/* 자식 위의 세로선 */}
                  <div className={`w-px h-5 ${colors.line}`} />
                  <TreeNode
                    node={child}
                    depth={depth + 1}

                    expandedSet={expandedSet}
                    toggleExpand={toggleExpand}
                    searchQuery={searchQuery}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 리스트 뷰 (인덴트) ──
function ListNode({
  node,
  depth,
  expandedSet,
  toggleExpand,
  searchQuery,
}: {
  node: OrgTreeNode;
  depth: number;
  expandedSet: Set<string>;
  toggleExpand: (code: string) => void;
  searchQuery: string;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedSet.has(node.departmentCode);
  const colors = LEVEL_COLORS[Math.min(depth, LEVEL_COLORS.length - 1)];

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
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer hover:bg-gray-50 transition-colors`}
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
        onClick={() => hasChildren && toggleExpand(node.departmentCode)}
      >
        {/* 확장 아이콘 */}
        <span className="w-4 flex-shrink-0">
          {hasChildren ? (
            isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />
          ) : (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-300 ml-1.5" />
          )}
        </span>

        {/* 레벨 인디케이터 */}
        <span className={`inline-block w-2 h-2 rounded-full ${colors.bg} flex-shrink-0`} />

        {/* 부서명 */}
        <span className="text-[13px] font-medium text-gray-900 truncate">
          {highlight(node.departmentName)}
        </span>
        {node.enDepartmentName && node.enDepartmentName !== node.departmentName && (
          <span className="text-[11px] text-gray-400 truncate">
            {highlight(node.enDepartmentName)}
          </span>
        )}

        {/* 사용자 수 */}
        {node.userCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
            <Users className="w-3 h-3" />
            {node.userCount}
          </span>
        )}
        {hasChildren && (
          <span className="text-[11px] text-gray-400 flex-shrink-0">
            ({node.children.length})
          </span>
        )}
      </div>

      {/* 하위 부서 */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map(child => (
            <ListNode
              key={child.departmentCode}
              node={child}
              depth={depth + 1}
              expandedSet={expandedSet}
              toggleExpand={toggleExpand}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ──
export default function OrgTree() {
  const [tree, setTree] = useState<OrgTreeNode[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('list');

  const loadTree = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await orgTreeApi.getTree();
      setTree(res.data.tree || []);
      setStats(res.data.stats || null);

      // 최초 로드 시 root 노드 + 1단계 자동 확장
      const initialExpanded = new Set<string>();
      for (const root of (res.data.tree || [])) {
        initialExpanded.add(root.departmentCode);
        for (const child of root.children) {
          initialExpanded.add(child.departmentCode);
        }
      }
      setExpandedSet(initialExpanded);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load organization tree');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      const res = await orgTreeApi.sync();
      const { total, discovered, alreadyExist, errors } = res.data;
      setSyncResult(
        `동기화 완료: 미등록 ${total}개 부서 중 ${discovered}개 신규 발견 (기존 ${alreadyExist}개)${
          errors?.length ? ` / 오류 ${errors.length}건` : ''
        }`
      );
      await loadTree();
    } catch (err: any) {
      setSyncResult(`동기화 실패: ${err.response?.data?.error || err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const toggleExpand = (code: string) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const expandAll = () => {
    const all = new Set<string>();
    const collect = (nodes: OrgTreeNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) {
          all.add(n.departmentCode);
          collect(n.children);
        }
      }
    };
    collect(tree);
    setExpandedSet(all);
  };

  const collapseAll = () => {
    setExpandedSet(new Set());
  };

  const filteredTree = filterTree(tree, search);

  // 검색 시 매칭된 경로 전체 자동 확장
  useEffect(() => {
    if (!search) return;
    const toExpand = new Set<string>();
    const collectExpanded = (nodes: OrgTreeNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) {
          toExpand.add(n.departmentCode);
          collectExpanded(n.children);
        }
      }
    };
    collectExpanded(filteredTree);
    setExpandedSet(toExpand);
  }, [search, filteredTree.length]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500 text-sm">조직도 로딩 중...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-indigo-600" />
            조직도
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Knox Organization API 기반 자동 구축 조직도
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {syncing ? '동기화 중...' : '사용자 기반 동기화'}
          </button>
          <button onClick={loadTree} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title="새로고침">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 에러/결과 알림 */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {syncResult && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm border ${
          syncResult.includes('실패') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {syncResult}
          <button onClick={() => setSyncResult(null)} className="ml-auto text-xs hover:underline">닫기</button>
        </div>
      )}

      {/* 통계 카드 */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-[11px] text-gray-500 font-medium">전체 부서</div>
            <div className="text-xl font-bold text-gray-900 mt-0.5">{stats.totalNodes}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-[11px] text-gray-500 font-medium">최상위 조직</div>
            <div className="text-xl font-bold text-gray-900 mt-0.5">{stats.rootNodes}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-[11px] text-gray-500 font-medium">사용자 있는 부서</div>
            <div className="text-xl font-bold text-blue-600 mt-0.5">{stats.nodesWithUsers}</div>
          </div>
        </div>
      )}

      {/* 검색 + 뷰 전환 + 확장/축소 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="부서명, 영문명, 부서코드 검색..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            리스트
          </button>
          <button
            onClick={() => setViewMode('tree')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'tree' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            트리
          </button>
        </div>
        <button onClick={expandAll} className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors">
          전체 펼치기
        </button>
        <button onClick={collapseAll} className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors">
          전체 접기
        </button>
      </div>

      {/* 빈 상태 */}
      {tree.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Building2 className="w-12 h-12 mb-3" />
          <p className="text-sm font-medium text-gray-500">아직 조직도 데이터가 없습니다</p>
          <p className="text-xs text-gray-400 mt-1">"사용자 기반 동기화" 버튼을 눌러 구축을 시작하세요</p>
        </div>
      )}

      {filteredTree.length === 0 && tree.length > 0 && search && (
        <div className="text-center py-8 text-sm text-gray-400">
          "{search}"에 대한 검색 결과가 없습니다
        </div>
      )}

      {/* 트리 뷰 */}
      {viewMode === 'tree' && filteredTree.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 overflow-x-auto">
          <div className="flex gap-6 justify-center min-w-max">
            {filteredTree.map((root) => (
              <TreeNode
                key={root.departmentCode}
                node={root}
                depth={0}
                expandedSet={expandedSet}
                toggleExpand={toggleExpand}
                searchQuery={search}
              />
            ))}
          </div>
        </div>
      )}

      {/* 리스트 뷰 */}
      {viewMode === 'list' && filteredTree.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 py-2 px-1">
          {filteredTree.map(root => (
            <ListNode
              key={root.departmentCode}
              node={root}
              depth={0}
              expandedSet={expandedSet}
              toggleExpand={toggleExpand}
              searchQuery={search}
            />
          ))}
        </div>
      )}

      {/* 범례 */}
      {tree.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-400 px-1">
          <span className="font-medium text-gray-500">레벨 색상:</span>
          {LEVEL_COLORS.slice(0, 6).map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className={`inline-block w-3 h-3 rounded ${c.bg} border ${c.border}`} />
              L{i}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
