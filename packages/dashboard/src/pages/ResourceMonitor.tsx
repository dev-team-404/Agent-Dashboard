import { useState, useEffect, useCallback, useRef } from 'react';
import { gpuServerApi } from '../services/api';
import {
  Server, Plus, Trash2, RefreshCw, Wifi, WifiOff, Cpu, MemoryStick,
  Thermometer, Zap, HardDrive, ChevronDown, ChevronUp, TestTube, Pencil, X,
  Activity, Clock, Monitor,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';

// ── Types ──

interface GpuInfo {
  index: number; uuid: string; name: string;
  memTotalMb: number; memUsedMb: number;
  utilGpu: number; utilMem: number; temp: number;
  powerW: number; powerMaxW: number;
}

interface GpuProcess {
  gpuIndex: number; pid: number; name: string; memMb: number; isLlm: boolean;
}

interface ServerMetrics {
  serverId: string; serverName: string; timestamp: string;
  error?: string;
  gpus: GpuInfo[]; processes: GpuProcess[];
  cpuLoadAvg: number | null; cpuCores: number | null;
  memoryTotalMb: number | null; memoryUsedMb: number | null;
  hostname: string | null;
}

interface GpuServer {
  id: string; name: string; host: string; sshPort: number;
  sshUsername: string; description: string | null;
  isLocal: boolean; enabled: boolean; pollIntervalSec: number;
  createdAt: string;
}

interface RealtimeEntry { server: GpuServer; metrics: ServerMetrics | null; }

// ── Helpers ──

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function utilColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  if (pct >= 40) return 'bg-blue-500';
  return 'bg-emerald-500';
}

function utilTextColor(pct: number): string {
  if (pct >= 90) return 'text-red-600';
  if (pct >= 70) return 'text-amber-600';
  return 'text-gray-900';
}

function tempColor(c: number): string {
  if (c >= 85) return 'text-red-600';
  if (c >= 70) return 'text-amber-600';
  return 'text-gray-600';
}

const PIE_COLORS = ['#3b82f6', '#94a3b8'];

// ── Custom Tooltip ──
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const fullTime = payload[0]?.payload?.fullTime;
  const isBiz = payload[0]?.payload?.isBusinessHour;
  return (
    <div className="bg-white/95 backdrop-blur border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-medium text-gray-800 mb-1.5 flex items-center gap-1">
        {fullTime || label}
        {isBiz && <span className="px-1 py-0.5 bg-blue-100 text-blue-600 rounded text-[9px]">영업시간</span>}
      </p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold tabular-nums">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}{p.unit || '%'}</span>
        </div>
      ))}
    </div>
  );
}

// ── Add/Edit Server Modal ──

interface ServerFormData {
  name: string; host: string; sshPort: number; sshUsername: string;
  sshPassword: string; description: string; isLocal: boolean; pollIntervalSec: number;
}

function ServerModal({ open, onClose, onSubmit, editServer, testing, testResult, onTest }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ServerFormData) => void;
  editServer?: GpuServer | null;
  testing: boolean;
  testResult: { success: boolean; message: string; gpuInfo?: string } | null;
  onTest: (data: { host: string; sshPort: number; sshUsername: string; sshPassword: string }) => void;
}) {
  const [form, setForm] = useState<ServerFormData>({
    name: '', host: '', sshPort: 22, sshUsername: '',
    sshPassword: '', description: '', isLocal: false, pollIntervalSec: 60,
  });

  useEffect(() => {
    if (editServer) {
      setForm({
        name: editServer.name, host: editServer.host, sshPort: editServer.sshPort,
        sshUsername: editServer.sshUsername, sshPassword: '',
        description: editServer.description || '', isLocal: editServer.isLocal,
        pollIntervalSec: editServer.pollIntervalSec,
      });
    } else {
      setForm({ name: '', host: '', sshPort: 22, sshUsername: '', sshPassword: '', description: '', isLocal: false, pollIntervalSec: 60 });
    }
  }, [editServer, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-gray-900">{editServer ? '서버 수정' : '서버 추가'}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">서버 이름</label>
              <input className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="예: GPU서버-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">호스트 (IP)</label>
              <input className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="192.168.1.100" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SSH 포트</label>
              <input type="number" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={form.sshPort} onChange={e => setForm(f => ({ ...f, sshPort: parseInt(e.target.value) || 22 }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SSH 사용자명</label>
              <input className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="root" value={form.sshUsername} onChange={e => setForm(f => ({ ...f, sshUsername: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SSH 비밀번호 {editServer && <span className="text-gray-400">(변경 시만 입력)</span>}</label>
              <input type="password" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="••••••••" value={form.sshPassword} onChange={e => setForm(f => ({ ...f, sshPassword: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">설명 (선택)</label>
              <input className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="예: vLLM 서빙 전용 서버" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">폴링 주기 (초)</label>
              <input type="number" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={form.pollIntervalSec} onChange={e => setForm(f => ({ ...f, pollIntervalSec: parseInt(e.target.value) || 60 }))} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={form.isLocal} onChange={e => setForm(f => ({ ...f, isLocal: e.target.checked }))} />
                이 대시보드 서버
              </label>
            </div>
          </div>

          {/* 연결 테스트 결과 */}
          {testResult && (
            <div className={`p-3 rounded-lg text-sm ${testResult.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              <p className="font-medium">{testResult.message}</p>
              {testResult.gpuInfo && <p className="mt-1 text-xs opacity-80 whitespace-pre-wrap">{testResult.gpuInfo}</p>}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between p-5 border-t bg-gray-50 rounded-b-xl">
          <button onClick={() => onTest({ host: form.host, sshPort: form.sshPort, sshUsername: form.sshUsername, sshPassword: form.sshPassword })}
            disabled={testing || !form.host || !form.sshUsername || !form.sshPassword}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <TestTube className="w-4 h-4" />{testing ? '테스트 중...' : '연결 테스트'}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">취소</button>
            <button onClick={() => onSubmit(form)}
              disabled={!form.name || !form.host || !form.sshUsername || (!editServer && !form.sshPassword)}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {editServer ? '수정' : '등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── GPU Bar ──

function GpuBar({ gpu, processes }: { gpu: GpuInfo; processes: GpuProcess[] }) {
  const memPct = gpu.memTotalMb > 0 ? (gpu.memUsedMb / gpu.memTotalMb) * 100 : 0;
  const gpuProcs = processes.filter(p => p.gpuIndex === gpu.index);
  const llmMem = gpuProcs.filter(p => p.isLlm).reduce((s, p) => s + p.memMb, 0);
  const llmPct = gpu.memTotalMb > 0 ? (llmMem / gpu.memTotalMb) * 100 : 0;
  const otherPct = memPct - llmPct;

  return (
    <div className="py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">GPU {gpu.index}</span>
          <span className="text-xs text-gray-600 truncate max-w-[200px]">{gpu.name}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`font-semibold ${utilTextColor(gpu.utilGpu)}`}>{gpu.utilGpu}%</span>
          <span className="text-gray-500">{formatMb(gpu.memUsedMb)} / {formatMb(gpu.memTotalMb)}</span>
          <span className={`flex items-center gap-0.5 ${tempColor(gpu.temp)}`}>
            <Thermometer className="w-3 h-3" />{gpu.temp}&deg;C
          </span>
          <span className="flex items-center gap-0.5 text-gray-500">
            <Zap className="w-3 h-3" />{Math.round(gpu.powerW)}W/{Math.round(gpu.powerMaxW)}W
          </span>
        </div>
      </div>
      {/* 사용률 바 */}
      <div className="flex gap-1.5">
        <div className="flex-1">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[10px] text-gray-400 w-8">연산</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${utilColor(gpu.utilGpu)}`}
              style={{ width: `${gpu.utilGpu}%` }} />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[10px] text-gray-400 w-8">메모리</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden relative">
            {/* LLM 비중 (파란색) + 기타 (회색) */}
            <div className="absolute inset-y-0 left-0 bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${llmPct}%` }} />
            <div className="absolute inset-y-0 bg-gray-400 rounded-r-full transition-all duration-500" style={{ left: `${llmPct}%`, width: `${Math.max(0, otherPct)}%` }} />
          </div>
        </div>
      </div>
      {/* 프로세스 태그 */}
      {gpuProcs.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {gpuProcs.map((p, i) => (
            <span key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
              p.isLlm ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {p.name.split('/').pop()} ({formatMb(p.memMb)})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Server Card ──

function ServerCard({ entry, onEdit, onDelete, onToggle }: {
  entry: RealtimeEntry;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [historyData, setHistoryData] = useState<any>(null);
  const [historyHours, setHistoryHours] = useState(24);
  const { server, metrics } = entry;
  const m = metrics;

  const isOnline = m && !m.error;
  const gpuCount = m?.gpus?.length || 0;

  // 전체 GPU 평균 사용률
  const avgGpuUtil = gpuCount > 0 ? Math.round(m!.gpus.reduce((s, g) => s + g.utilGpu, 0) / gpuCount) : 0;
  const totalMemMb = gpuCount > 0 ? m!.gpus.reduce((s, g) => s + g.memTotalMb, 0) : 0;
  const usedMemMb = gpuCount > 0 ? m!.gpus.reduce((s, g) => s + g.memUsedMb, 0) : 0;
  const memPct = totalMemMb > 0 ? (usedMemMb / totalMemMb) * 100 : 0;

  // LLM 비중
  const llmMemMb = m?.processes?.filter(p => p.isLlm).reduce((s, p) => s + p.memMb, 0) || 0;
  const llmPct = totalMemMb > 0 ? (llmMemMb / totalMemMb) * 100 : 0;

  // GPU 모델 요약
  const gpuModelSummary = (() => {
    if (!m || gpuCount === 0) return '';
    const models = new Map<string, number>();
    m.gpus.forEach(g => models.set(g.name, (models.get(g.name) || 0) + 1));
    return Array.from(models.entries()).map(([n, c]) => `${n} x${c}`).join(', ');
  })();

  // 히스토리 로드
  const loadHistory = useCallback(async () => {
    try {
      const res = await gpuServerApi.history(server.id, historyHours);
      setHistoryData(res.data);
    } catch { /* ignore */ }
  }, [server.id, historyHours]);

  useEffect(() => {
    if (expanded) loadHistory();
  }, [expanded, loadHistory]);

  // 히스토리 차트 데이터
  const chartData = historyData?.snapshots?.map((s: any) => {
    const gpus = s.gpuMetrics as GpuInfo[];
    const procs = (s.gpuProcesses || []) as GpuProcess[];
    const avgUtil = gpus.length > 0 ? gpus.reduce((sum: number, g: GpuInfo) => sum + g.utilGpu, 0) / gpus.length : 0;
    const totalMem = gpus.reduce((sum: number, g: GpuInfo) => sum + g.memTotalMb, 0);
    const usedMem = gpus.reduce((sum: number, g: GpuInfo) => sum + g.memUsedMb, 0);
    const llmMem = procs.filter((p: GpuProcess) => p.isLlm).reduce((sum: number, p: GpuProcess) => sum + p.memMb, 0);
    const ts = new Date(s.timestamp);
    const kstH = (ts.getUTCHours() + 9) % 24;

    return {
      time: ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      fullTime: ts.toLocaleString('ko-KR'),
      gpuUtil: Math.round(avgUtil * 10) / 10,
      memPct: totalMem > 0 ? Math.round((usedMem / totalMem) * 1000) / 10 : 0,
      llmPct: totalMem > 0 ? Math.round((llmMem / totalMem) * 1000) / 10 : 0,
      cpuLoad: s.cpuLoadAvg,
      ramPct: s.memoryTotalMb > 0 ? Math.round((s.memoryUsedMb / s.memoryTotalMb) * 1000) / 10 : 0,
      isBusinessHour: kstH >= 9 && kstH < 18,
    };
  }) || [];

  // 차트 thinning (너무 많을 때)
  const displayData = chartData.length > 200
    ? chartData.filter((_: any, i: number) => i % Math.ceil(chartData.length / 200) === 0)
    : chartData;

  return (
    <div className={`bg-white rounded-xl border ${isOnline ? 'border-gray-200' : m?.error ? 'border-red-200' : 'border-gray-200'} shadow-sm`}>
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-emerald-500 animate-pulse' : m?.error ? 'bg-red-500' : 'bg-gray-300'}`} />
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">{server.name}</h3>
              <p className="text-xs text-gray-500">{server.host}:{server.sshPort} {server.isLocal && <span className="text-blue-500">(로컬)</span>}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-gray-600 rounded" title="수정"><Pencil className="w-3.5 h-3.5" /></button>
            <button onClick={onToggle}
              className={`px-2 py-1 text-[10px] font-medium rounded ${server.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {server.enabled ? 'ON' : 'OFF'}
            </button>
            <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 rounded" title="삭제"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        {m?.error ? (
          <div className="p-3 bg-red-50 rounded-lg text-xs text-red-700">
            <WifiOff className="w-4 h-4 inline mr-1" />연결 실패: {m.error}
          </div>
        ) : isOnline ? (
          <>
            {/* GPU 요약 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">GPU</p>
                <p className="text-lg font-bold text-gray-900">{gpuCount}<span className="text-xs font-normal text-gray-400 ml-1">장</span></p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">평균 GPU 사용률</p>
                <p className={`text-lg font-bold ${utilTextColor(avgGpuUtil)}`}>{avgGpuUtil}<span className="text-xs font-normal">%</span></p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">VRAM</p>
                <p className="text-sm font-semibold text-gray-900">{formatMb(usedMemMb)} <span className="text-xs font-normal text-gray-400">/ {formatMb(totalMemMb)}</span></p>
                <p className="text-[10px] text-gray-500">{Math.round(memPct)}% 사용</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-0.5">LLM 비중</p>
                <p className="text-lg font-bold text-blue-600">{Math.round(llmPct)}<span className="text-xs font-normal">%</span></p>
              </div>
            </div>

            {/* 시스템 메트릭 한 줄 */}
            <div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
              {m.hostname && <span className="flex items-center gap-1"><Monitor className="w-3 h-3" />{m.hostname}</span>}
              {m.cpuLoadAvg != null && <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />CPU: {m.cpuLoadAvg}{m.cpuCores ? `/${m.cpuCores}코어` : ''}</span>}
              {m.memoryTotalMb != null && m.memoryUsedMb != null && (
                <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" />RAM: {formatMb(m.memoryUsedMb)}/{formatMb(m.memoryTotalMb)}</span>
              )}
              {gpuModelSummary && <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{gpuModelSummary}</span>}
            </div>

            {/* LLM vs 기타 비중 바 */}
            {totalMemMb > 0 && (
              <div className="mb-2">
                <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>전체 VRAM 사용 비중</span>
                  <span>
                    <span className="inline-block w-2 h-2 rounded-sm bg-blue-500 mr-0.5" />LLM {Math.round(llmPct)}%
                    <span className="inline-block w-2 h-2 rounded-sm bg-gray-400 mx-0.5 ml-2" />기타 {Math.round(memPct - llmPct)}%
                    <span className="inline-block w-2 h-2 rounded-sm bg-gray-100 mx-0.5 ml-2" />여유 {Math.round(100 - memPct)}%
                  </span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
                  <div className="bg-blue-500 transition-all duration-500" style={{ width: `${llmPct}%` }} />
                  <div className="bg-gray-400 transition-all duration-500" style={{ width: `${Math.max(0, memPct - llmPct)}%` }} />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500 text-center">
            대기 중...
          </div>
        )}
      </div>

      {/* Expand/Collapse */}
      {isOnline && (
        <>
          <button onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-center gap-1 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 border-t border-gray-100 transition-colors">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? '접기' : 'GPU 상세 & 히스토리'}
          </button>

          {expanded && (
            <div className="border-t border-gray-100">
              {/* Per-GPU 상세 */}
              <div className="px-4 py-2">
                <p className="text-xs font-medium text-gray-700 mb-1">GPU 상세</p>
                {m!.gpus.map(gpu => (
                  <GpuBar key={gpu.index} gpu={gpu} processes={m!.processes || []} />
                ))}
              </div>

              {/* 히스토리 차트 */}
              <div className="px-4 py-3 border-t border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-gray-700 flex items-center gap-1"><Activity className="w-3.5 h-3.5" />사용률 추이</p>
                  <div className="flex items-center gap-1">
                    {[6, 12, 24, 72].map(h => (
                      <button key={h} onClick={() => setHistoryHours(h)}
                        className={`px-2 py-1 text-[10px] rounded ${historyHours === h ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {h}h
                      </button>
                    ))}
                  </div>
                </div>

                {/* 영업시간 평균 */}
                {historyData?.businessHoursAvg && (
                  <div className="flex items-center gap-4 mb-3 p-2.5 bg-blue-50 rounded-lg">
                    <Clock className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    <div className="text-xs text-blue-800">
                      <span className="font-semibold">KST 9-18시 평균</span>
                      <span className="ml-3">GPU 사용률: <b>{historyData.businessHoursAvg.avgGpuUtil}%</b></span>
                      <span className="ml-3">VRAM 사용률: <b>{historyData.businessHoursAvg.avgMemUtil}%</b></span>
                      <span className="ml-3 text-blue-500">({historyData.businessHoursAvg.sampleCount}건 샘플)</span>
                    </div>
                  </div>
                )}

                {displayData.length > 0 ? (
                  <div className="space-y-4">
                    {/* GPU 사용률 */}
                    <div>
                      <p className="text-[10px] text-gray-500 mb-1">GPU 사용률 / VRAM / LLM 비중 (%)</p>
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={displayData}>
                          <defs>
                            <linearGradient id="gradGpu" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="gradMem" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="gradLlm" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area type="monotone" dataKey="gpuUtil" name="GPU 사용률" stroke="#3b82f6" fill="url(#gradGpu)" strokeWidth={2} dot={false} animationDuration={500} />
                          <Area type="monotone" dataKey="memPct" name="VRAM 사용률" stroke="#f59e0b" fill="url(#gradMem)" strokeWidth={2} dot={false} animationDuration={500} />
                          <Area type="monotone" dataKey="llmPct" name="LLM 비중" stroke="#10b981" fill="url(#gradLlm)" strokeWidth={2} dot={false} animationDuration={500} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    {/* CPU/RAM */}
                    <div>
                      <p className="text-[10px] text-gray-500 mb-1">CPU 로드 / RAM 사용률</p>
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={displayData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip content={<ChartTooltip />} />
                          <Line type="monotone" dataKey="cpuLoad" name="CPU 로드" stroke="#8b5cf6" strokeWidth={2} dot={false} animationDuration={500} />
                          <Line type="monotone" dataKey="ramPct" name="RAM %" stroke="#ec4899" strokeWidth={2} dot={false} animationDuration={500} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-8">히스토리 데이터가 아직 없습니다</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ──

export default function ResourceMonitor() {
  const [data, setData] = useState<RealtimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editServer, setEditServer] = useState<GpuServer | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = useCallback(async () => {
    try {
      const res = await gpuServerApi.realtime();
      setData(res.data.data || []);
      setLastUpdated(new Date());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    refreshRef.current = setInterval(fetchData, 10000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [fetchData]);

  // 전체 요약
  const totalGpus = data.reduce((s, e) => s + (e.metrics?.gpus?.length || 0), 0);
  const totalVramMb = data.reduce((s, e) => s + (e.metrics?.gpus?.reduce((ss, g) => ss + g.memTotalMb, 0) || 0), 0);
  const usedVramMb = data.reduce((s, e) => s + (e.metrics?.gpus?.reduce((ss, g) => ss + g.memUsedMb, 0) || 0), 0);
  const totalLlmMb = data.reduce((s, e) => s + (e.metrics?.processes?.filter(p => p.isLlm).reduce((ss, p) => ss + p.memMb, 0) || 0), 0);
  const onlineCount = data.filter(e => e.metrics && !e.metrics.error).length;
  const overallAvgGpu = (() => {
    let sum = 0; let cnt = 0;
    data.forEach(e => e.metrics?.gpus?.forEach(g => { sum += g.utilGpu; cnt++; }));
    return cnt > 0 ? Math.round(sum / cnt) : 0;
  })();

  const llmOverallPct = totalVramMb > 0 ? Math.round((totalLlmMb / totalVramMb) * 100) : 0;

  // LLM vs 기타 Pie 데이터
  const pieData = [
    { name: 'LLM', value: totalLlmMb },
    { name: '기타/여유', value: totalVramMb - totalLlmMb },
  ];

  const handleTest = async (connData: { host: string; sshPort: number; sshUsername: string; sshPassword: string }) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await gpuServerApi.test(connData);
      setTestResult(res.data);
    } catch (err: any) {
      setTestResult({ success: false, message: err?.response?.data?.error || err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (form: any) => {
    try {
      if (editServer) {
        const updateData = { ...form };
        if (!updateData.sshPassword) delete updateData.sshPassword;
        await gpuServerApi.update(editServer.id, updateData);
      } else {
        await gpuServerApi.create(form);
      }
      setModalOpen(false);
      setEditServer(null);
      setTestResult(null);
      fetchData();
    } catch (err: any) {
      alert(err?.response?.data?.error || '저장 실패');
    }
  };

  const handleDelete = async (server: GpuServer) => {
    if (!confirm(`"${server.name}" 서버를 삭제하시겠습니까?`)) return;
    try {
      await gpuServerApi.delete(server.id);
      fetchData();
    } catch { alert('삭제 실패'); }
  };

  const handleToggle = async (server: GpuServer) => {
    try {
      await gpuServerApi.update(server.id, { enabled: !server.enabled });
      fetchData();
    } catch { alert('상태 변경 실패'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-600" />GPU 리소스 모니터링
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            SSH 기반 실시간 GPU 서버 모니터링 (10초 갱신)
            {lastUpdated && <span className="ml-2 text-gray-400">마지막 갱신: {lastUpdated.toLocaleTimeString('ko-KR')}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100" title="새로고침">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => { setEditServer(null); setTestResult(null); setModalOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" />서버 추가
          </button>
        </div>
      </div>

      {/* 전체 요약 KPI */}
      {data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-[10px] font-medium text-gray-500 uppercase">서버</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{onlineCount}<span className="text-sm font-normal text-gray-400">/{data.length}</span></p>
            <p className="text-[10px] text-emerald-600 flex items-center gap-0.5 mt-0.5"><Wifi className="w-3 h-3" />온라인</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-[10px] font-medium text-gray-500 uppercase">GPU 총 수</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{totalGpus}<span className="text-sm font-normal text-gray-400">장</span></p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-[10px] font-medium text-gray-500 uppercase">총 VRAM</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatMb(totalVramMb)}</p>
            <p className="text-[10px] text-gray-500">{formatMb(usedVramMb)} 사용 중</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-[10px] font-medium text-gray-500 uppercase">평균 GPU 사용률</p>
            <p className={`text-2xl font-bold mt-1 ${utilTextColor(overallAvgGpu)}`}>{overallAvgGpu}<span className="text-sm font-normal">%</span></p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-[10px] font-medium text-gray-500 uppercase">LLM VRAM 사용</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{formatMb(totalLlmMb)}</p>
            <p className="text-[10px] text-gray-500">전체 대비 {llmOverallPct}%</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex items-center justify-center">
            <ResponsiveContainer width={80} height={80}>
              <PieChart>
                <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={22} outerRadius={35} strokeWidth={0}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="text-[10px] text-gray-600 ml-1">
              <p><span className="inline-block w-2 h-2 bg-blue-500 rounded-sm mr-0.5" />LLM {llmOverallPct}%</p>
              <p><span className="inline-block w-2 h-2 bg-gray-400 rounded-sm mr-0.5" />기타 {100 - llmOverallPct}%</p>
            </div>
          </div>
        </div>
      )}

      {/* 서버 카드 목록 */}
      {data.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Server className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-4">등록된 GPU 서버가 없습니다</p>
          <button onClick={() => { setEditServer(null); setTestResult(null); setModalOpen(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" />첫 서버 추가하기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {data.map(entry => (
            <ServerCard
              key={entry.server.id}
              entry={entry}
              onEdit={() => { setEditServer(entry.server); setTestResult(null); setModalOpen(true); }}
              onDelete={() => handleDelete(entry.server)}
              onToggle={() => handleToggle(entry.server)}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <ServerModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditServer(null); setTestResult(null); }}
        onSubmit={handleSubmit}
        editServer={editServer}
        testing={testing}
        testResult={testResult}
        onTest={handleTest}
      />
    </div>
  );
}
