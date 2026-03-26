import { useState, useEffect, useCallback, useRef } from 'react';
import { gpuServerApi } from '../services/api';
import {
  Server, Plus, Trash2, RefreshCw, Wifi, WifiOff, Cpu, MemoryStick,
  Thermometer, Zap, ChevronDown, ChevronUp, TestTube, Pencil, X,
  Activity, Clock, Monitor, BarChart3, Layers,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar,
} from 'recharts';

// ── Types ──
interface GpuInfo { index: number; uuid: string; name: string; memTotalMb: number; memUsedMb: number; utilGpu: number; utilMem: number; temp: number; powerW: number; powerMaxW: number; }
interface GpuProcess { gpuIndex: number; pid: number; name: string; memMb: number; isLlm: boolean; }
interface LlmEndpoint { port: number; containerName: string; containerImage: string; type: string; modelName: string | null; runningRequests: number | null; waitingRequests: number | null; kvCacheUsagePct: number | null; promptThroughputTps: number | null; genThroughputTps: number | null; }
interface ServerMetrics { serverId: string; serverName: string; timestamp: string; error?: string; gpus: GpuInfo[]; processes: GpuProcess[]; llmEndpoints: LlmEndpoint[]; cpuLoadAvg: number | null; cpuCores: number | null; memoryTotalMb: number | null; memoryUsedMb: number | null; hostname: string | null; }
interface GpuServer { id: string; name: string; host: string; sshPort: number; sshUsername: string; description: string | null; isLocal: boolean; enabled: boolean; pollIntervalSec: number; createdAt: string; }
interface RealtimeEntry { server: GpuServer; metrics: ServerMetrics | null; }

// ── Helpers ──
const fmt = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
const utilCls = (p: number) => p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : p >= 40 ? 'bg-blue-500' : 'bg-emerald-500';
const utilTxt = (p: number) => p >= 90 ? 'text-red-600' : p >= 70 ? 'text-amber-600' : 'text-gray-900';
const tempTxt = (c: number) => c >= 85 ? 'text-red-600' : c >= 70 ? 'text-amber-600' : 'text-gray-600';
const llmTypeBadge = (t: string) => {
  const colors: Record<string, string> = { vllm: 'bg-blue-100 text-blue-700', sglang: 'bg-purple-100 text-purple-700', ollama: 'bg-green-100 text-green-700', tgi: 'bg-orange-100 text-orange-700' };
  return colors[t] || 'bg-gray-100 text-gray-600';
};
const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const ft = payload[0]?.payload?.fullTime;
  const biz = payload[0]?.payload?.isBusinessHour;
  return (
    <div className="bg-white/95 backdrop-blur border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-medium text-gray-800 mb-1.5 flex items-center gap-1">
        {ft || ''}{biz && <span className="px-1 py-0.5 bg-blue-100 text-blue-600 rounded text-[9px]">영업시간</span>}
      </p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-semibold tabular-nums">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Server Form Modal ──
interface ServerFormData { name: string; host: string; sshPort: number; sshUsername: string; sshPassword: string; description: string; isLocal: boolean; pollIntervalSec: number; }

function ServerModal({ open, onClose, onSubmit, editServer, testing, testResult, onTest }: {
  open: boolean; onClose: () => void; onSubmit: (d: ServerFormData) => void; editServer?: GpuServer | null;
  testing: boolean; testResult: any; onTest: (d: any) => void;
}) {
  const [form, setForm] = useState<ServerFormData>({ name: '', host: '', sshPort: 22, sshUsername: '', sshPassword: '', description: '', isLocal: false, pollIntervalSec: 60 });
  useEffect(() => {
    if (editServer) setForm({ name: editServer.name, host: editServer.host, sshPort: editServer.sshPort, sshUsername: editServer.sshUsername, sshPassword: '', description: editServer.description || '', isLocal: editServer.isLocal, pollIntervalSec: editServer.pollIntervalSec });
    else setForm({ name: '', host: '', sshPort: 22, sshUsername: '', sshPassword: '', description: '', isLocal: false, pollIntervalSec: 60 });
  }, [editServer, open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b"><h3 className="font-semibold text-gray-900">{editServer ? '서버 수정' : '서버 추가'}</h3><button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button></div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">서버 이름</label><input className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="예: GPU서버-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">호스트 (IP)</label><input className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="192.168.1.100" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">SSH 포트</label><input type="number" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" value={form.sshPort} onChange={e => setForm(f => ({ ...f, sshPort: parseInt(e.target.value) || 22 }))} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">SSH 사용자명</label><input className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="root" value={form.sshUsername} onChange={e => setForm(f => ({ ...f, sshUsername: e.target.value }))} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">SSH 비밀번호{editServer && <span className="text-gray-400 ml-1">(변경 시만)</span>}</label><input type="password" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="••••••••" value={form.sshPassword} onChange={e => setForm(f => ({ ...f, sshPassword: e.target.value }))} /></div>
            <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">설명</label><input className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="vLLM 서빙 전용 서버" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">폴링 주기 (초)</label><input type="number" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" value={form.pollIntervalSec} onChange={e => setForm(f => ({ ...f, pollIntervalSec: parseInt(e.target.value) || 60 }))} /></div>
            <div className="flex items-end pb-1"><label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"><input type="checkbox" className="rounded border-gray-300 text-blue-600" checked={form.isLocal} onChange={e => setForm(f => ({ ...f, isLocal: e.target.checked }))} />이 대시보드 서버</label></div>
          </div>
          {testResult && (<div className={`p-3 rounded-lg text-sm ${testResult.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}><p className="font-medium">{testResult.message}</p>{testResult.gpuInfo && <pre className="mt-1 text-[11px] opacity-80 whitespace-pre-wrap">{testResult.gpuInfo}</pre>}</div>)}
        </div>
        <div className="flex items-center justify-between p-5 border-t bg-gray-50 rounded-b-xl">
          <button onClick={() => onTest({ host: form.host, sshPort: form.sshPort, sshUsername: form.sshUsername, sshPassword: form.sshPassword })} disabled={testing || !form.host || !form.sshUsername || !form.sshPassword} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50"><TestTube className="w-4 h-4" />{testing ? '테스트 중...' : '연결 테스트'}</button>
          <div className="flex gap-2"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">취소</button><button onClick={() => onSubmit(form)} disabled={!form.name || !form.host || !form.sshUsername || (!editServer && !form.sshPassword)} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{editServer ? '수정' : '등록'}</button></div>
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
  return (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2"><span className="text-xs font-mono text-gray-400">GPU {gpu.index}</span><span className="text-xs text-gray-600 truncate max-w-[180px]">{gpu.name}</span></div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`font-semibold ${utilTxt(gpu.utilGpu)}`}>{gpu.utilGpu}%</span>
          <span className="text-gray-500">{fmt(gpu.memUsedMb)}/{fmt(gpu.memTotalMb)}</span>
          <span className={`flex items-center gap-0.5 ${tempTxt(gpu.temp)}`}><Thermometer className="w-3 h-3" />{gpu.temp}&deg;C</span>
          <span className="flex items-center gap-0.5 text-gray-500"><Zap className="w-3 h-3" />{Math.round(gpu.powerW)}W</span>
        </div>
      </div>
      <div className="flex gap-1.5">
        <div className="flex-1"><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-500 ${utilCls(gpu.utilGpu)}`} style={{ width: `${gpu.utilGpu}%` }} /></div></div>
        <div className="flex-1"><div className="h-2 bg-gray-100 rounded-full overflow-hidden flex"><div className="bg-blue-500 transition-all duration-500" style={{ width: `${llmPct}%` }} /><div className="bg-gray-400 transition-all duration-500" style={{ width: `${Math.max(0, memPct - llmPct)}%` }} /></div></div>
      </div>
      {gpuProcs.length > 0 && (<div className="flex flex-wrap gap-1 mt-1">{gpuProcs.map((p, i) => (<span key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${p.isLlm ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{p.name.split('/').pop()} ({fmt(p.memMb)})</span>))}</div>)}
    </div>
  );
}

// ── LLM Endpoint Card ──
function LlmCard({ ep }: { ep: LlmEndpoint }) {
  const tps = (ep.promptThroughputTps || 0) + (ep.genThroughputTps || 0);
  return (
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${llmTypeBadge(ep.type)}`}>{ep.type}</span>
          <span className="text-xs font-medium text-gray-800 truncate max-w-[200px]">{ep.modelName || ep.containerName || `port:${ep.port}`}</span>
        </div>
        <span className="text-[10px] text-gray-400">:{ep.port}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {ep.kvCacheUsagePct != null && (
          <div><span className="text-gray-500">KV Cache</span>
            <div className="flex items-center gap-1 mt-0.5"><div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden"><div className={`h-full rounded-full ${utilCls(ep.kvCacheUsagePct)}`} style={{ width: `${ep.kvCacheUsagePct}%` }} /></div><span className={`font-semibold ${utilTxt(ep.kvCacheUsagePct)}`}>{ep.kvCacheUsagePct.toFixed(0)}%</span></div>
          </div>
        )}
        {ep.runningRequests != null && (<div><span className="text-gray-500">실행 중</span><p className="font-semibold text-gray-900 mt-0.5">{ep.runningRequests}</p></div>)}
        {ep.waitingRequests != null && (<div><span className="text-gray-500">대기</span><p className={`font-semibold mt-0.5 ${(ep.waitingRequests || 0) > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{ep.waitingRequests}</p></div>)}
        {tps > 0 && (<div><span className="text-gray-500">처리량</span><p className="font-semibold text-blue-600 mt-0.5">{tps.toFixed(1)} <span className="text-[10px] font-normal">tok/s</span></p></div>)}
      </div>
    </div>
  );
}

// ── Server Card ──
function ServerCard({ entry, onEdit, onDelete, onToggle }: { entry: RealtimeEntry; onEdit: () => void; onDelete: () => void; onToggle: () => void; }) {
  const [expanded, setExpanded] = useState(false);
  const [historyData, setHistoryData] = useState<any>(null);
  const [historyHours, setHistoryHours] = useState(24);
  const { server, metrics: m } = entry;
  const isOnline = m && !m.error;
  const gpuCount = m?.gpus?.length || 0;
  const avgGpuUtil = gpuCount > 0 ? Math.round(m!.gpus.reduce((s, g) => s + g.utilGpu, 0) / gpuCount) : 0;
  const totalMemMb = gpuCount > 0 ? m!.gpus.reduce((s, g) => s + g.memTotalMb, 0) : 0;
  const usedMemMb = gpuCount > 0 ? m!.gpus.reduce((s, g) => s + g.memUsedMb, 0) : 0;
  const memPct = totalMemMb > 0 ? (usedMemMb / totalMemMb) * 100 : 0;
  const llmMemMb = m?.processes?.filter(p => p.isLlm).reduce((s, p) => s + p.memMb, 0) || 0;
  const llmPct = totalMemMb > 0 ? (llmMemMb / totalMemMb) * 100 : 0;
  const llmEps = m?.llmEndpoints || [];
  const totalTps = llmEps.reduce((s, e) => s + (e.promptThroughputTps || 0) + (e.genThroughputTps || 0), 0);

  const loadHistory = useCallback(async () => { try { const res = await gpuServerApi.history(server.id, historyHours); setHistoryData(res.data); } catch {} }, [server.id, historyHours]);
  useEffect(() => { if (expanded) loadHistory(); }, [expanded, loadHistory]);

  const chartData = historyData?.snapshots?.map((s: any) => {
    const gpus = s.gpuMetrics as GpuInfo[];
    const procs = (s.gpuProcesses || []) as GpuProcess[];
    const llms = (s.llmMetrics || []) as LlmEndpoint[];
    const avgU = gpus.length > 0 ? gpus.reduce((sum: number, g: any) => sum + g.utilGpu, 0) / gpus.length : 0;
    const tM = gpus.reduce((sum: number, g: any) => sum + g.memTotalMb, 0);
    const uM = gpus.reduce((sum: number, g: any) => sum + g.memUsedMb, 0);
    const lM = procs.filter((p: any) => p.isLlm).reduce((sum: number, p: any) => sum + p.memMb, 0);
    const kvAvg = llms.filter((l: any) => l.kvCacheUsagePct != null).reduce((s: number, l: any) => s + l.kvCacheUsagePct, 0) / (llms.filter((l: any) => l.kvCacheUsagePct != null).length || 1);
    const tps = llms.reduce((s: number, l: any) => s + (l.promptThroughputTps || 0) + (l.genThroughputTps || 0), 0);
    const ts = new Date(s.timestamp); const kstH = (ts.getUTCHours() + 9) % 24;
    return { time: ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), fullTime: ts.toLocaleString('ko-KR'), gpuUtil: Math.round(avgU * 10) / 10, memPct: tM > 0 ? Math.round((uM / tM) * 1000) / 10 : 0, llmPct: tM > 0 ? Math.round((lM / tM) * 1000) / 10 : 0, kvCache: Math.round(kvAvg * 10) / 10 || null, throughput: Math.round(tps * 10) / 10 || null, cpuLoad: s.cpuLoadAvg, ramPct: s.memoryTotalMb > 0 ? Math.round((s.memoryUsedMb / s.memoryTotalMb) * 1000) / 10 : 0, isBusinessHour: kstH >= 9 && kstH < 18 };
  }) || [];
  const dd = chartData.length > 200 ? chartData.filter((_: any, i: number) => i % Math.ceil(chartData.length / 200) === 0) : chartData;

  return (
    <div className={`bg-white rounded-xl border ${m?.error ? 'border-red-200' : 'border-gray-200'} shadow-sm`}>
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-emerald-500 animate-pulse' : m?.error ? 'bg-red-500' : 'bg-gray-300'}`} />
            <div><h3 className="font-semibold text-gray-900 text-sm">{server.name}</h3><p className="text-xs text-gray-500">{server.host}:{server.sshPort}{server.isLocal && <span className="text-blue-500 ml-1">(로컬)</span>}</p></div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-gray-600 rounded"><Pencil className="w-3.5 h-3.5" /></button>
            <button onClick={onToggle} className={`px-2 py-1 text-[10px] font-medium rounded ${server.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{server.enabled ? 'ON' : 'OFF'}</button>
            <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        {m?.error ? (<div className="p-3 bg-red-50 rounded-lg text-xs text-red-700"><WifiOff className="w-4 h-4 inline mr-1" />연결 실패: {m.error}</div>) : isOnline ? (<>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
            <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">GPU</p><p className="text-lg font-bold text-gray-900">{gpuCount}<span className="text-xs font-normal text-gray-400 ml-0.5">장</span></p></div>
            <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">GPU 사용률</p><p className={`text-lg font-bold ${utilTxt(avgGpuUtil)}`}>{avgGpuUtil}<span className="text-xs font-normal">%</span></p></div>
            <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">VRAM</p><p className="text-sm font-semibold text-gray-900">{fmt(usedMemMb)} <span className="text-xs font-normal text-gray-400">/ {fmt(totalMemMb)}</span></p></div>
            <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">LLM 비중</p><p className="text-lg font-bold text-blue-600">{Math.round(llmPct)}<span className="text-xs font-normal">%</span></p></div>
            <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">LLM 인스턴스</p><p className="text-lg font-bold text-purple-600">{llmEps.length}<span className="text-xs font-normal text-gray-400 ml-0.5">개</span></p></div>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
            {m.hostname && <span className="flex items-center gap-1"><Monitor className="w-3 h-3" />{m.hostname}</span>}
            {m.cpuLoadAvg != null && <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />CPU {m.cpuLoadAvg}{m.cpuCores ? `/${m.cpuCores}코어` : ''}</span>}
            {m.memoryTotalMb != null && <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" />RAM {fmt(m.memoryUsedMb!)}/{fmt(m.memoryTotalMb)}</span>}
            {totalTps > 0 && <span className="flex items-center gap-1 text-blue-600"><Activity className="w-3 h-3" />{totalTps.toFixed(1)} tok/s</span>}
          </div>
          {totalMemMb > 0 && (<div className="mb-2"><div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5"><span>VRAM 비중</span><span><span className="inline-block w-2 h-2 rounded-sm bg-blue-500 mr-0.5" />LLM {Math.round(llmPct)}%<span className="inline-block w-2 h-2 rounded-sm bg-gray-400 mx-0.5 ml-2" />기타 {Math.round(memPct - llmPct)}%<span className="inline-block w-2 h-2 rounded-sm bg-gray-100 mx-0.5 ml-2" />여유 {Math.round(100 - memPct)}%</span></div><div className="h-3 bg-gray-100 rounded-full overflow-hidden flex"><div className="bg-blue-500 transition-all duration-500" style={{ width: `${llmPct}%` }} /><div className="bg-gray-400 transition-all duration-500" style={{ width: `${Math.max(0, memPct - llmPct)}%` }} /></div></div>)}
          {llmEps.length > 0 && (<div className="space-y-2 mt-3"><p className="text-xs font-medium text-gray-700 flex items-center gap-1"><Layers className="w-3.5 h-3.5" />LLM 서빙 ({llmEps.length})</p>{llmEps.map((ep, i) => <LlmCard key={i} ep={ep} />)}</div>)}
        </>) : (<div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500 text-center">대기 중...</div>)}
      </div>
      {isOnline && (<>
        <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-center gap-1 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 border-t border-gray-100">{expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}{expanded ? '접기' : 'GPU 상세 & 히스토리'}</button>
        {expanded && (<div className="border-t border-gray-100">
          <div className="px-4 py-2"><p className="text-xs font-medium text-gray-700 mb-1">GPU 상세</p>{m!.gpus.map(g => <GpuBar key={g.index} gpu={g} processes={m!.processes || []} />)}</div>
          <div className="px-4 py-3 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3"><p className="text-xs font-medium text-gray-700 flex items-center gap-1"><Activity className="w-3.5 h-3.5" />사용률 추이</p><div className="flex gap-1">{[6, 12, 24, 72].map(h => <button key={h} onClick={() => setHistoryHours(h)} className={`px-2 py-1 text-[10px] rounded ${historyHours === h ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{h}h</button>)}</div></div>
            {historyData?.businessHoursAvg && (<div className="flex items-center gap-4 mb-3 p-2.5 bg-blue-50 rounded-lg"><Clock className="w-4 h-4 text-blue-600 flex-shrink-0" /><div className="text-xs text-blue-800"><span className="font-semibold">KST 9-18시 평균</span><span className="ml-3">GPU: <b>{historyData.businessHoursAvg.avgGpuUtil}%</b></span><span className="ml-3">VRAM: <b>{historyData.businessHoursAvg.avgMemUtil}%</b></span></div></div>)}
            {dd.length > 0 ? (<div className="space-y-4">
              <div><p className="text-[10px] text-gray-500 mb-1">GPU / VRAM / LLM / KV Cache (%)</p><ResponsiveContainer width="100%" height={220}><AreaChart data={dd}><defs><linearGradient id="gG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient><linearGradient id="gM" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="gpuUtil" name="GPU 사용률" stroke="#3b82f6" fill="url(#gG)" strokeWidth={2} dot={false} /><Area type="monotone" dataKey="memPct" name="VRAM" stroke="#f59e0b" fill="url(#gM)" strokeWidth={1.5} dot={false} /><Line type="monotone" dataKey="llmPct" name="LLM VRAM" stroke="#10b981" strokeWidth={1.5} dot={false} /><Line type="monotone" dataKey="kvCache" name="KV Cache" stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" /></AreaChart></ResponsiveContainer></div>
              <div><p className="text-[10px] text-gray-500 mb-1">처리량 (tok/s) / CPU / RAM</p><ResponsiveContainer width="100%" height={160}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 10 }} /><Tooltip content={<ChartTooltip />} /><Line type="monotone" dataKey="throughput" name="LLM tok/s" stroke="#3b82f6" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="cpuLoad" name="CPU 로드" stroke="#8b5cf6" strokeWidth={1.5} dot={false} /><Line type="monotone" dataKey="ramPct" name="RAM %" stroke="#ec4899" strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer></div>
            </div>) : <p className="text-xs text-gray-400 text-center py-8">히스토리 데이터 없음</p>}
          </div>
        </div>)}
      </>)}
    </div>
  );
}

// ── Heatmap ──
function Heatmap({ data }: { data: Array<{ hour: number; dow: number; avgUtil: number | null }> }) {
  const cellColor = (v: number | null) => {
    if (v == null) return 'bg-gray-100';
    if (v >= 80) return 'bg-red-500 text-white';
    if (v >= 60) return 'bg-orange-400 text-white';
    if (v >= 40) return 'bg-amber-300 text-gray-800';
    if (v >= 20) return 'bg-blue-200 text-gray-800';
    if (v > 0) return 'bg-blue-100 text-gray-600';
    return 'bg-gray-50 text-gray-400';
  };
  return (
    <div className="overflow-x-auto">
      <div className="grid gap-px" style={{ gridTemplateColumns: `40px repeat(24, 1fr)` }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-[9px] text-gray-400 py-0.5">{h}</div>)}
        {DOW_LABELS.map((day, dow) => (<>
          <div key={`l${dow}`} className="text-[10px] text-gray-500 flex items-center pr-1 justify-end">{day}</div>
          {Array.from({ length: 24 }, (_, h) => {
            const cell = data.find(d => d.hour === h && d.dow === dow);
            return <div key={`${dow}-${h}`} className={`text-center text-[9px] py-1 rounded-sm ${cellColor(cell?.avgUtil ?? null)}`} title={`${day} ${h}시: ${cell?.avgUtil?.toFixed(1) ?? '-'}%`}>{cell?.avgUtil != null ? Math.round(cell.avgUtil) : ''}</div>;
          })}
        </>))}
      </div>
      <div className="flex items-center gap-2 mt-2 text-[9px] text-gray-500 justify-end">
        <span>낮음</span>
        {['bg-gray-100', 'bg-blue-100', 'bg-blue-200', 'bg-amber-300', 'bg-orange-400', 'bg-red-500'].map((c, i) => <span key={i} className={`w-4 h-3 rounded-sm ${c}`} />)}
        <span>높음 (%)</span>
      </div>
    </div>
  );
}

// ── Main Page ──
export default function ResourceMonitor() {
  const [data, setData] = useState<RealtimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'realtime' | 'analytics'>('realtime');
  const [modalOpen, setModalOpen] = useState(false);
  const [editServer, setEditServer] = useState<GpuServer | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsDays, setAnalyticsDays] = useState(7);
  const refreshRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = useCallback(async () => { try { const res = await gpuServerApi.realtime(); setData(res.data.data || []); setLastUpdated(new Date()); } catch {} finally { setLoading(false); } }, []);
  const fetchAnalytics = useCallback(async () => { try { const res = await gpuServerApi.analytics(analyticsDays); setAnalytics(res.data); } catch {} }, [analyticsDays]);

  useEffect(() => { fetchData(); refreshRef.current = setInterval(fetchData, 10000); return () => { if (refreshRef.current) clearInterval(refreshRef.current); }; }, [fetchData]);
  useEffect(() => { if (tab === 'analytics') fetchAnalytics(); }, [tab, fetchAnalytics]);

  // 종합 KPI
  const totalGpus = data.reduce((s, e) => s + (e.metrics?.gpus?.length || 0), 0);
  const totalVram = data.reduce((s, e) => s + (e.metrics?.gpus?.reduce((ss, g) => ss + g.memTotalMb, 0) || 0), 0);
  const usedVram = data.reduce((s, e) => s + (e.metrics?.gpus?.reduce((ss, g) => ss + g.memUsedMb, 0) || 0), 0);
  const totalLlmMb = data.reduce((s, e) => s + (e.metrics?.processes?.filter(p => p.isLlm).reduce((ss, p) => ss + p.memMb, 0) || 0), 0);
  const onlineCount = data.filter(e => e.metrics && !e.metrics.error).length;
  const avgGpu = (() => { let s = 0, c = 0; data.forEach(e => e.metrics?.gpus?.forEach(g => { s += g.utilGpu; c++; })); return c > 0 ? Math.round(s / c) : 0; })();
  const llmPct = totalVram > 0 ? Math.round((totalLlmMb / totalVram) * 100) : 0;
  const totalLlmInstances = data.reduce((s, e) => s + (e.metrics?.llmEndpoints?.length || 0), 0);
  const totalTps = data.reduce((s, e) => s + (e.metrics?.llmEndpoints?.reduce((ss, ep) => ss + (ep.promptThroughputTps || 0) + (ep.genThroughputTps || 0), 0) || 0), 0);
  const avgKvCache = (() => { let s = 0, c = 0; data.forEach(e => e.metrics?.llmEndpoints?.forEach(ep => { if (ep.kvCacheUsagePct != null) { s += ep.kvCacheUsagePct; c++; } })); return c > 0 ? Math.round(s / c) : null; })();

  const handleTest = async (d: any) => { setTesting(true); setTestResult(null); try { const r = await gpuServerApi.test(d); setTestResult(r.data); } catch (e: any) { setTestResult({ success: false, message: e?.response?.data?.error || e.message }); } finally { setTesting(false); } };
  const handleSubmit = async (form: any) => { try { if (editServer) { const u = { ...form }; if (!u.sshPassword) delete u.sshPassword; await gpuServerApi.update(editServer.id, u); } else { await gpuServerApi.create(form); } setModalOpen(false); setEditServer(null); setTestResult(null); fetchData(); } catch (e: any) { alert(e?.response?.data?.error || '저장 실패'); } };
  const handleDelete = async (s: GpuServer) => { if (!confirm(`"${s.name}" 삭제?`)) return; try { await gpuServerApi.delete(s.id); fetchData(); } catch { alert('삭제 실패'); } };
  const handleToggle = async (s: GpuServer) => { try { await gpuServerApi.update(s.id, { enabled: !s.enabled }); fetchData(); } catch {} };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Server className="w-5 h-5 text-blue-600" />GPU 리소스 모니터링</h1>
          <p className="text-xs text-gray-500 mt-0.5">SSH + LLM 메트릭 자동 탐지{lastUpdated && <span className="ml-2 text-gray-400">갱신: {lastUpdated.toLocaleTimeString('ko-KR')}</span>}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => { setEditServer(null); setTestResult(null); setModalOpen(true); }} className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"><Plus className="w-4 h-4" />서버 추가</button>
        </div>
      </div>

      {/* KPI */}
      {data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="bg-white rounded-xl border p-3 shadow-sm"><p className="text-[10px] font-medium text-gray-500">서버</p><p className="text-xl font-bold text-gray-900">{onlineCount}<span className="text-sm font-normal text-gray-400">/{data.length}</span></p></div>
          <div className="bg-white rounded-xl border p-3 shadow-sm"><p className="text-[10px] font-medium text-gray-500">GPU</p><p className="text-xl font-bold text-gray-900">{totalGpus}<span className="text-sm font-normal text-gray-400">장</span></p></div>
          <div className="bg-white rounded-xl border p-3 shadow-sm"><p className="text-[10px] font-medium text-gray-500">VRAM</p><p className="text-lg font-bold text-gray-900">{fmt(usedVram)}<span className="text-xs font-normal text-gray-400">/{fmt(totalVram)}</span></p></div>
          <div className="bg-white rounded-xl border p-3 shadow-sm"><p className="text-[10px] font-medium text-gray-500">GPU 사용률</p><p className={`text-xl font-bold ${utilTxt(avgGpu)}`}>{avgGpu}%</p></div>
          <div className="bg-white rounded-xl border p-3 shadow-sm"><p className="text-[10px] font-medium text-gray-500">LLM 비중</p><p className="text-xl font-bold text-blue-600">{llmPct}%</p></div>
          <div className="bg-white rounded-xl border p-3 shadow-sm"><p className="text-[10px] font-medium text-gray-500">LLM 인스턴스</p><p className="text-xl font-bold text-purple-600">{totalLlmInstances}</p></div>
          <div className="bg-white rounded-xl border p-3 shadow-sm"><p className="text-[10px] font-medium text-gray-500">총 처리량</p><p className="text-lg font-bold text-blue-600">{totalTps.toFixed(1)}<span className="text-[10px] font-normal"> tok/s</span></p></div>
          <div className="bg-white rounded-xl border p-3 shadow-sm"><p className="text-[10px] font-medium text-gray-500">KV Cache</p><p className={`text-xl font-bold ${avgKvCache != null ? utilTxt(avgKvCache) : 'text-gray-400'}`}>{avgKvCache != null ? `${avgKvCache}%` : '-'}</p></div>
        </div>
      )}

      {/* Tabs */}
      {data.length > 0 && (
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          <button onClick={() => setTab('realtime')} className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === 'realtime' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}><Wifi className="w-3.5 h-3.5 inline mr-1" />실시간 현황</button>
          <button onClick={() => setTab('analytics')} className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === 'analytics' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}><BarChart3 className="w-3.5 h-3.5 inline mr-1" />사용률 분석</button>
        </div>
      )}

      {/* Tab Content */}
      {tab === 'realtime' && (
        data.length === 0 ? (
          <div className="bg-white rounded-xl border p-12 text-center"><Server className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500 mb-4">등록된 GPU 서버가 없습니다</p><button onClick={() => { setEditServer(null); setTestResult(null); setModalOpen(true); }} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"><Plus className="w-4 h-4" />첫 서버 추가</button></div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{data.map(e => <ServerCard key={e.server.id} entry={e} onEdit={() => { setEditServer(e.server); setTestResult(null); setModalOpen(true); }} onDelete={() => handleDelete(e.server)} onToggle={() => handleToggle(e.server)} />)}</div>
        )
      )}

      {tab === 'analytics' && analytics && (
        <div className="space-y-6">
          {/* Period selector */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1"><Clock className="w-4 h-4" />기간별 분석 (휴일 {analytics.period?.holidayCount || 0}일 제외)</h2>
            <div className="flex gap-1">{[3, 7, 14, 30].map(d => <button key={d} onClick={() => setAnalyticsDays(d)} className={`px-3 py-1 text-xs rounded-lg ${analyticsDays === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{d}일</button>)}</div>
          </div>

          {/* Business vs Off-hours comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-blue-600" />영업시간 평균 (KST 9-18, 평일)</h3>
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-[10px] text-gray-500">GPU 사용률</p><p className={`text-2xl font-bold ${analytics.businessHours?.avgGpuUtil != null ? utilTxt(analytics.businessHours.avgGpuUtil) : 'text-gray-400'}`}>{analytics.businessHours?.avgGpuUtil ?? '-'}<span className="text-sm">%</span></p></div>
                <div><p className="text-[10px] text-gray-500">VRAM 사용률</p><p className="text-2xl font-bold text-gray-900">{analytics.businessHours?.avgMemUtil ?? '-'}<span className="text-sm">%</span></p></div>
                <div><p className="text-[10px] text-gray-500">KV Cache</p><p className="text-2xl font-bold text-purple-600">{analytics.businessHours?.avgKvCache ?? '-'}<span className="text-sm">%</span></p></div>
                <div><p className="text-[10px] text-gray-500">평균 실행 요청</p><p className="text-lg font-bold text-gray-900">{analytics.businessHours?.avgRunningReqs ?? '-'}</p></div>
                <div><p className="text-[10px] text-gray-500">평균 대기 요청</p><p className={`text-lg font-bold ${(analytics.businessHours?.avgWaitingReqs || 0) > 1 ? 'text-amber-600' : 'text-gray-900'}`}>{analytics.businessHours?.avgWaitingReqs ?? '-'}</p></div>
                <div><p className="text-[10px] text-gray-500">처리량</p><p className="text-lg font-bold text-blue-600">{analytics.businessHours?.avgThroughputTps ?? '-'} <span className="text-[10px] font-normal">tok/s</span></p></div>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">{analytics.businessHours?.sampleCount || 0}건 샘플</p>
            </div>
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-gray-400" />비영업시간 평균</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[10px] text-gray-500">GPU 사용률</p><p className="text-2xl font-bold text-gray-600">{analytics.offHours?.avgGpuUtil ?? '-'}<span className="text-sm">%</span></p></div>
                <div><p className="text-[10px] text-gray-500">VRAM 사용률</p><p className="text-2xl font-bold text-gray-600">{analytics.offHours?.avgMemUtil ?? '-'}<span className="text-sm">%</span></p></div>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">{analytics.offHours?.sampleCount || 0}건 샘플</p>
            </div>
          </div>

          {/* Peak time heatmap */}
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-gray-700 mb-3">피크타임 히트맵 (시간대 x 요일, GPU 평균 사용률 %)</h3>
            <Heatmap data={analytics.heatmap || []} />
            {analytics.peakHours?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="text-[10px] text-gray-500">피크:</span>
                {analytics.peakHours.map((p: any, i: number) => (
                  <span key={i} className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-[10px] font-medium">{DOW_LABELS[p.dow]} {p.hour}시 ({p.avgUtil}%)</span>
                ))}
              </div>
            )}
          </div>

          {/* Hourly throughput chart */}
          {analytics.throughputByHour && (
            <div className="bg-white rounded-xl border p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-700 mb-3">시간대별 평균 LLM 처리량 (tok/s)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={analytics.throughputByHour}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={h => `${h}시`} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="avgTps" name="평균 tok/s" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      <ServerModal open={modalOpen} onClose={() => { setModalOpen(false); setEditServer(null); setTestResult(null); }} onSubmit={handleSubmit} editServer={editServer} testing={testing} testResult={testResult} onTest={handleTest} />
    </div>
  );
}
