import { useState, useEffect, useCallback, useRef } from 'react';
import { gpuServerApi } from '../services/api';
import {
  Server, Plus, Trash2, RefreshCw, Wifi, WifiOff, Cpu, MemoryStick,
  Zap, ChevronDown, ChevronUp, TestTube, Pencil, X,
  Activity, Clock, Layers, HardDrive,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar,
} from 'recharts';

// ── Types ──
interface GpuSpec { fp16Tflops: number; memBandwidthGBs: number; tdpW: number; vramGb: number; label: string; }
interface GpuInfo { index: number; uuid: string; name: string; memTotalMb: number; memUsedMb: number; utilGpu: number; utilMem: number; temp: number; powerW: number; powerMaxW: number; spec: GpuSpec | null; }
interface GpuProcess { gpuIndex: number; pid: number; name: string; memMb: number; isLlm: boolean; }
interface LlmEndpoint { port: number; containerName: string; containerImage: string; type: string; modelNames: string[]; runningRequests: number | null; waitingRequests: number | null; kvCacheUsagePct: number | null; promptThroughputTps: number | null; genThroughputTps: number | null; rawMetrics?: Record<string, number>; }
interface ServerMetrics { serverId: string; serverName: string; timestamp: string; error?: string; gpus: GpuInfo[]; processes: GpuProcess[]; llmEndpoints: LlmEndpoint[]; cpuLoadAvg: number | null; cpuCores: number | null; memoryTotalMb: number | null; memoryUsedMb: number | null; hostname: string | null; }
interface GpuServer { id: string; name: string; host: string; sshPort: number; sshUsername: string; description: string | null; isLocal: boolean; enabled: boolean; pollIntervalSec: number; createdAt: string; }
interface ThroughputAnalysis { theoreticalMaxTps: number | null; peakTps: number | null; currentTps: number; modelName: string | null; modelParams: string | null; gpuHealthPct: number | null; utilizationPct: number | null; theoreticalUtilPct: number | null; }
interface RealtimeEntry { server: GpuServer; metrics: ServerMetrics | null; throughputAnalysis?: ThroughputAnalysis; }

// ── Helpers ──
const fmt = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
const utilCls = (p: number) => p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : p >= 40 ? 'bg-blue-500' : 'bg-emerald-500';
const utilTxt = (p: number) => p >= 90 ? 'text-red-600' : p >= 70 ? 'text-amber-600' : 'text-gray-900';
const healthTxt = (p: number) => p >= 85 ? 'text-emerald-600' : p >= 70 ? 'text-amber-600' : 'text-red-600';
const llmBadge = (t: string) => ({ vllm: 'bg-blue-100 text-blue-700', sglang: 'bg-purple-100 text-purple-700', ollama: 'bg-green-100 text-green-700', tgi: 'bg-orange-100 text-orange-700' }[t] || 'bg-gray-100 text-gray-600');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (<div className="bg-white/95 backdrop-blur border rounded-lg shadow-lg p-2 text-[10px]">
    <p className="font-medium text-gray-700 mb-1">{payload[0]?.payload?.fullTime || ''}</p>
    {payload.map((p: any, i: number) => <div key={i} className="flex justify-between gap-3"><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />{p.name}</span><span className="font-semibold tabular-nums">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span></div>)}
  </div>);
}

// ── Compact progress bar ──
function MiniBar({ pct, color = 'bg-blue-500', bg = 'bg-gray-200', h = 'h-1.5' }: { pct: number; color?: string; bg?: string; h?: string }) {
  return <div className={`${h} ${bg} rounded-full overflow-hidden`}><div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>;
}

// ── Server Form Modal (unchanged) ──
interface FormData { name: string; host: string; sshPort: number; sshUsername: string; sshPassword: string; description: string; isLocal: boolean; pollIntervalSec: number; }
function ServerModal({ open, onClose, onSubmit, edit, testing, testResult, onTest }: {
  open: boolean; onClose: () => void; onSubmit: (d: FormData) => void; edit?: GpuServer | null;
  testing: boolean; testResult: any; onTest: (d: any) => void;
}) {
  const [f, setF] = useState<FormData>({ name: '', host: '', sshPort: 22, sshUsername: '', sshPassword: '', description: '', isLocal: false, pollIntervalSec: 60 });
  useEffect(() => { edit ? setF({ name: edit.name, host: edit.host, sshPort: edit.sshPort, sshUsername: edit.sshUsername, sshPassword: '', description: edit.description || '', isLocal: edit.isLocal, pollIntervalSec: edit.pollIntervalSec }) : setF({ name: '', host: '', sshPort: 22, sshUsername: '', sshPassword: '', description: '', isLocal: false, pollIntervalSec: 60 }); }, [edit, open]);
  if (!open) return null;
  const I = ({ label, v, k, type = 'text', ph = '', span = false }: any) => <div className={span ? 'col-span-2' : ''}><label className="block text-[10px] font-medium text-gray-500 mb-0.5">{label}</label><input type={type} className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-1 focus:ring-blue-500" placeholder={ph} value={v} onChange={e => setF(p => ({ ...p, [k]: type === 'number' ? parseInt(e.target.value) || 0 : e.target.value }))} /></div>;
  return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
    <div className="flex items-center justify-between px-4 py-3 border-b"><h3 className="font-semibold text-sm text-gray-900">{edit ? '서버 수정' : '서버 추가'}</h3><button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button></div>
    <div className="p-4 space-y-3"><div className="grid grid-cols-2 gap-3">
      <I label="서버 이름" v={f.name} k="name" ph="GPU서버-1" span /><I label="호스트" v={f.host} k="host" ph="192.168.1.100" /><I label="SSH 포트" v={f.sshPort} k="sshPort" type="number" /><I label="사용자명" v={f.sshUsername} k="sshUsername" ph="root" /><I label="비밀번호" v={f.sshPassword} k="sshPassword" type="password" ph="••••" /><I label="설명" v={f.description} k="description" span /><I label="폴링(초)" v={f.pollIntervalSec} k="pollIntervalSec" type="number" />
      <div className="flex items-end pb-0.5"><label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded text-blue-600" checked={f.isLocal} onChange={e => setF(p => ({ ...p, isLocal: e.target.checked }))} />로컬 서버</label></div>
    </div>{testResult && <div className={`p-2 rounded text-xs ${testResult.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}><p className="font-medium">{testResult.message}</p>{testResult.gpuInfo && <pre className="mt-1 text-[10px] opacity-80 whitespace-pre-wrap max-h-32 overflow-y-auto">{testResult.gpuInfo}</pre>}</div>}</div>
    <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
      <button onClick={() => onTest({ host: f.host, sshPort: f.sshPort, sshUsername: f.sshUsername, sshPassword: f.sshPassword })} disabled={testing || !f.host || !f.sshUsername || !f.sshPassword} className="text-xs text-gray-600 hover:text-gray-800 disabled:opacity-50 flex items-center gap-1"><TestTube className="w-3 h-3" />{testing ? '테스트 중...' : '연결 테스트'}</button>
      <div className="flex gap-2"><button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500">취소</button><button onClick={() => onSubmit(f)} disabled={!f.name || !f.host || !f.sshUsername || (!edit && !f.sshPassword)} className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50">{edit ? '수정' : '등록'}</button></div>
    </div>
  </div></div>);
}

// ── Compact Server Card ──
function ServerCard({ entry, onEdit, onDelete, onToggle }: { entry: RealtimeEntry; onEdit: () => void; onDelete: () => void; onToggle: () => void; }) {
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState<any>(null);
  const [hrs, setHrs] = useState(24);
  const [dbg, setDbg] = useState<string | null>(null);
  const [dbgL, setDbgL] = useState(false);
  const { server: s, metrics: m, throughputAnalysis: ta } = entry;
  const ok = m && !m.error;
  const gc = m?.gpus?.length || 0;
  const spec = m?.gpus?.[0]?.spec;
  const avgGpu = gc > 0 ? Math.round(m!.gpus.reduce((a, g) => a + g.utilGpu, 0) / gc) : 0;
  const totMem = gc > 0 ? m!.gpus.reduce((a, g) => a + g.memTotalMb, 0) : 0;
  const usedMem = gc > 0 ? m!.gpus.reduce((a, g) => a + g.memUsedMb, 0) : 0;
  const memPct = totMem > 0 ? (usedMem / totMem) * 100 : 0;
  const eps = m?.llmEndpoints || [];
  const avgKv = eps.filter(e => e.kvCacheUsagePct != null);
  const kvPct = avgKv.length > 0 ? avgKv.reduce((a, e) => a + e.kvCacheUsagePct!, 0) / avgKv.length : null;
  const cpuPct = m?.cpuLoadAvg && m?.cpuCores ? Math.min(Math.round((m.cpuLoadAvg / m.cpuCores) * 100), 100) : null;
  const ramPct = m?.memoryTotalMb && m?.memoryUsedMb ? Math.round((m.memoryUsedMb / m.memoryTotalMb) * 100) : null;
  const capacityPct = Math.max(avgGpu, kvPct || 0, memPct);

  const loadHist = useCallback(async () => { try { const r = await gpuServerApi.history(s.id, hrs); setHist(r.data); } catch {} }, [s.id, hrs]);
  useEffect(() => { if (open) loadHist(); }, [open, loadHist]);

  const cd = hist?.snapshots?.map((snap: any) => {
    const gs = snap.gpuMetrics as GpuInfo[]; const ps = (snap.gpuProcesses || []) as GpuProcess[]; const ls = (snap.llmMetrics || []) as LlmEndpoint[];
    const au = gs.length > 0 ? gs.reduce((a: number, g: any) => a + g.utilGpu, 0) / gs.length : 0;
    const tm = gs.reduce((a: number, g: any) => a + g.memTotalMb, 0); const um = gs.reduce((a: number, g: any) => a + g.memUsedMb, 0);
    const lm = ps.filter((p: any) => p.isLlm).reduce((a: number, p: any) => a + p.memMb, 0);
    const kvs = ls.filter((l: any) => l.kvCacheUsagePct != null); const kv = kvs.length > 0 ? kvs.reduce((a: number, l: any) => a + l.kvCacheUsagePct, 0) / kvs.length : null;
    const tp = ls.reduce((a: number, l: any) => a + (l.promptThroughputTps || 0) + (l.genThroughputTps || 0), 0);
    const t = new Date(snap.timestamp);
    return { time: t.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), fullTime: t.toLocaleString('ko-KR'), gpuUtil: Math.round(au * 10) / 10, memPct: tm > 0 ? Math.round((um / tm) * 1000) / 10 : 0, llmPct: tm > 0 ? Math.round((lm / tm) * 1000) / 10 : 0, kvCache: kv ? Math.round(kv * 10) / 10 : null, throughput: tp > 0 ? Math.round(tp * 10) / 10 : null, cpuLoad: snap.cpuLoadAvg, ramPct: snap.memoryTotalMb > 0 ? Math.round((snap.memoryUsedMb / snap.memoryTotalMb) * 1000) / 10 : 0 };
  }) || [];
  const dd = cd.length > 150 ? cd.filter((_: any, i: number) => i % Math.ceil(cd.length / 150) === 0) : cd;

  return (
    <div className={`bg-white rounded-lg border ${m?.error ? 'border-red-200' : 'border-gray-200'} shadow-sm`}>
      {/* ── Compact header ── */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ok ? 'bg-emerald-500' : m?.error ? 'bg-red-400' : 'bg-gray-300'}`} />
          <span className="text-xs font-semibold text-gray-900 truncate">{s.name}</span>
          {spec && <span className="text-[10px] text-gray-400">{spec.label} x{gc}</span>}
          <span className="text-[10px] text-gray-400 ml-auto">{s.host}</span>
          <div className="flex items-center gap-0.5 ml-1">
            <button onClick={onEdit} className="p-1 text-gray-300 hover:text-gray-500"><Pencil className="w-3 h-3" /></button>
            <button onClick={onToggle} className={`px-1.5 py-0.5 text-[9px] rounded ${s.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>{s.enabled ? 'ON' : 'OFF'}</button>
            <button onClick={onDelete} className="p-1 text-gray-300 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>

        {m?.error ? <p className="text-[10px] text-red-500"><WifiOff className="w-3 h-3 inline mr-0.5" />{m.error}</p> : ok ? (<>
          {/* ── 1) LLM 용량 사용률 (핵심 게이지) ── */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-gray-500 w-14 shrink-0">LLM 용량</span>
            <div className="flex-1"><MiniBar pct={capacityPct} color={utilCls(capacityPct)} h="h-2" /></div>
            <span className={`text-xs font-bold w-8 text-right ${utilTxt(capacityPct)}`}>{Math.round(capacityPct)}%</span>
          </div>

          {/* ── 2) 건강도 + 처리량 ── */}
          {ta && (
            <div className="flex items-center gap-3 mb-1.5 text-[10px]">
              {ta.gpuHealthPct != null && <span className="flex items-center gap-0.5"><Activity className="w-3 h-3 text-gray-400" />건강도 <b className={healthTxt(ta.gpuHealthPct)}>{ta.gpuHealthPct}%</b></span>}
              {ta.currentTps > 0 && <span className="text-blue-600">{ta.currentTps.toFixed(1)} tok/s</span>}
              {ta.theoreticalMaxTps && <span className="text-gray-400">/ {ta.theoreticalMaxTps.toFixed(0)} 이론</span>}
              {ta.peakTps != null && ta.peakTps > 0 && <span className="text-gray-400">피크 {ta.peakTps.toFixed(1)}</span>}
              {ta.modelParams && <span className="text-gray-400">({ta.modelParams})</span>}
            </div>
          )}

          {/* ── 3) 시스템 리소스 한 줄 ── */}
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            {cpuPct != null && <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />CPU <b className={cpuPct > 80 ? 'text-red-600' : 'text-gray-700'}>{cpuPct}%</b><span className="text-gray-400">({m.cpuLoadAvg}/{m.cpuCores})</span></span>}
            {ramPct != null && <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" />RAM <b className={ramPct > 85 ? 'text-red-600' : 'text-gray-700'}>{ramPct}%</b><span className="text-gray-400">({fmt(m.memoryUsedMb!)}/{fmt(m.memoryTotalMb!)})</span></span>}
            {eps.length > 0 && <span className="flex items-center gap-1"><Layers className="w-3 h-3" />LLM {eps.length}개</span>}
            {kvPct != null && <span>KV <b className={utilTxt(kvPct)}>{kvPct.toFixed(0)}%</b></span>}
          </div>

          {/* ── LLM 인스턴스 태그 ── */}
          {eps.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {eps.map((ep, i) => (
                <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${llmBadge(ep.type)}`}>
                  <span className="uppercase">{ep.type}</span>
                  {ep.modelNames?.[0] && <span className="opacity-75 truncate max-w-[120px]">{ep.modelNames[0]}</span>}
                  {ep.kvCacheUsagePct != null && <span>KV:{ep.kvCacheUsagePct.toFixed(0)}%</span>}
                  {(ep.runningRequests || 0) > 0 && <span>R:{ep.runningRequests}</span>}
                  {(ep.waitingRequests || 0) > 0 && <span className="text-amber-700">W:{ep.waitingRequests}</span>}
                </span>
              ))}
            </div>
          )}
        </>) : <p className="text-[10px] text-gray-400">대기 중...</p>}
      </div>

      {/* ── 상세 펼침 ── */}
      {ok && (<>
        <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 border-t border-gray-100">
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{open ? '접기' : '상세 보기'}
        </button>
        {open && (<div className="border-t border-gray-100 text-xs">
          {/* GPU별 상세 */}
          <div className="px-3 py-2 space-y-1">
            <p className="text-[10px] font-medium text-gray-500 mb-1">GPU 상세</p>
            {m!.gpus.map(g => {
              const mp = g.memTotalMb > 0 ? (g.memUsedMb / g.memTotalMb) * 100 : 0;
              return (<div key={g.index} className="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">
                <span className="text-[10px] font-mono text-gray-400 w-8">#{g.index}</span>
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center gap-1"><MiniBar pct={g.utilGpu} color={utilCls(g.utilGpu)} /><span className={`text-[10px] font-semibold w-7 ${utilTxt(g.utilGpu)}`}>{g.utilGpu}%</span></div>
                  <div className="flex items-center gap-1"><MiniBar pct={mp} color="bg-blue-400" /><span className="text-[10px] text-gray-500 w-7">{Math.round(mp)}%</span></div>
                </div>
                <span className="text-[10px] text-gray-400">{fmt(g.memUsedMb)}/{fmt(g.memTotalMb)}</span>
                <span className={`text-[10px] ${g.temp >= 80 ? 'text-red-500' : 'text-gray-400'}`}>{g.temp}&deg;C</span>
                <span className="text-[10px] text-gray-400">{Math.round(g.powerW)}W</span>
              </div>);
            })}
          </div>

          {/* 처리량 3단 분석 */}
          {ta && (ta.theoreticalMaxTps || ta.peakTps) && (
            <div className="px-3 py-2 border-t border-gray-100">
              <p className="text-[10px] font-medium text-gray-500 mb-1.5">처리량 분석 {ta.modelName && <span className="text-gray-400">({ta.modelName})</span>}</p>
              <div className="space-y-1">
                {ta.theoreticalMaxTps && <div className="flex items-center gap-1.5"><span className="text-[9px] text-gray-400 w-10 text-right">이론</span><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-indigo-200 rounded-full" style={{ width: '100%' }} /></div><span className="text-[9px] w-14 text-right text-gray-500">{ta.theoreticalMaxTps.toFixed(0)} tok/s</span></div>}
                {ta.peakTps != null && ta.peakTps > 0 && <div className="flex items-center gap-1.5"><span className="text-[9px] text-gray-400 w-10 text-right">피크</span><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-purple-400 rounded-full" style={{ width: `${ta.gpuHealthPct || 0}%` }} /></div><span className="text-[9px] w-14 text-right text-purple-600">{ta.peakTps.toFixed(1)} tok/s</span></div>}
                <div className="flex items-center gap-1.5"><span className="text-[9px] text-gray-400 w-10 text-right">현재</span><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className={`h-full rounded-full ${utilCls(ta.theoreticalUtilPct || 0)}`} style={{ width: `${ta.theoreticalUtilPct || 0}%` }} /></div><span className={`text-[9px] w-14 text-right ${ta.currentTps > 0 ? 'text-blue-600' : 'text-gray-400'}`}>{ta.currentTps.toFixed(1)} tok/s</span></div>
              </div>
              <div className="flex gap-4 mt-1.5 text-[9px]">
                {ta.gpuHealthPct != null && <span className="text-gray-500">건강도: <b className={healthTxt(ta.gpuHealthPct)}>{ta.gpuHealthPct}%</b></span>}
                {ta.utilizationPct != null && <span className="text-gray-500">피크대비: <b className={utilTxt(ta.utilizationPct)}>{ta.utilizationPct}%</b></span>}
                {ta.theoreticalUtilPct != null && <span className="text-gray-500">이론대비: <b className={utilTxt(ta.theoreticalUtilPct)}>{ta.theoreticalUtilPct}%</b></span>}
              </div>
            </div>
          )}

          {/* 히스토리 차트 */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-medium text-gray-500">사용률 추이</span><div className="flex gap-0.5">{[6, 12, 24, 72].map(h => <button key={h} onClick={() => setHrs(h)} className={`px-1.5 py-0.5 text-[9px] rounded ${hrs === h ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{h}h</button>)}</div></div>
            {hist?.businessHoursAvg && <div className="flex items-center gap-2 mb-2 p-1.5 bg-blue-50 rounded text-[9px] text-blue-700"><Clock className="w-3 h-3" /><span>9-18시: GPU <b>{hist.businessHoursAvg.avgGpuUtil}%</b> VRAM <b>{hist.businessHoursAvg.avgMemUtil}%</b></span></div>}
            {dd.length > 0 ? (<div className="space-y-3">
              <ResponsiveContainer width="100%" height={160}><AreaChart data={dd}><defs><linearGradient id="gG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} /><Tooltip content={<Tip />} /><Area type="monotone" dataKey="gpuUtil" name="GPU" stroke="#3b82f6" fill="url(#gG)" strokeWidth={1.5} dot={false} /><Line type="monotone" dataKey="kvCache" name="KV Cache" stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="3 2" /><Line type="monotone" dataKey="memPct" name="VRAM" stroke="#f59e0b" strokeWidth={1} dot={false} /></AreaChart></ResponsiveContainer>
              <ResponsiveContainer width="100%" height={100}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} /><Line type="monotone" dataKey="throughput" name="tok/s" stroke="#3b82f6" strokeWidth={1.5} dot={false} /><Line type="monotone" dataKey="ramPct" name="RAM%" stroke="#ec4899" strokeWidth={1} dot={false} /></LineChart></ResponsiveContainer>
            </div>) : <p className="text-[10px] text-gray-400 text-center py-4">데이터 없음</p>}
          </div>

          {/* 디버그 */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <button onClick={async () => { setDbgL(true); try { const r = await gpuServerApi.debug(s.id); setDbg(r.data.raw); } catch (e: any) { setDbg('Error: ' + e.message); } finally { setDbgL(false); } }} className="text-[9px] text-gray-400 hover:text-gray-600 underline">{dbgL ? '조회 중...' : 'SSH Raw 출력 (디버그)'}</button>
              {dbg && <button onClick={() => { navigator.clipboard.writeText(dbg); }} className="text-[9px] text-blue-400 hover:text-blue-600 underline">복사</button>}
            </div>
            {dbg && <pre className="mt-1 p-2 bg-gray-900 text-green-400 rounded text-[9px] max-h-48 overflow-auto whitespace-pre-wrap">{dbg}</pre>}
          </div>
        </div>)}
      </>)}
    </div>
  );
}

// ── Heatmap ──
function Heatmap({ data }: { data: Array<{ hour: number; dow: number; avgUtil: number | null }> }) {
  const cc = (v: number | null) => v == null ? 'bg-gray-50' : v >= 80 ? 'bg-red-500 text-white' : v >= 60 ? 'bg-orange-400 text-white' : v >= 40 ? 'bg-amber-300' : v >= 20 ? 'bg-blue-200' : v > 0 ? 'bg-blue-100' : 'bg-gray-50';
  return (<div className="overflow-x-auto"><div className="grid gap-px" style={{ gridTemplateColumns: '28px repeat(24, 1fr)' }}>
    <div />{Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-[8px] text-gray-400">{h}</div>)}
    {DOW.map((d, dow) => <>{<div key={`l${dow}`} className="text-[9px] text-gray-500 flex items-center justify-end pr-1">{d}</div>}{Array.from({ length: 24 }, (_, h) => { const c = data.find(x => x.hour === h && x.dow === dow); return <div key={`${dow}-${h}`} className={`text-center text-[8px] py-0.5 rounded-sm ${cc(c?.avgUtil ?? null)}`} title={`${d} ${h}시: ${c?.avgUtil?.toFixed(1) ?? '-'}%`}>{c?.avgUtil != null ? Math.round(c.avgUtil) : ''}</div>; })}</>)}
  </div></div>);
}

// ── Main ──
export default function ResourceMonitor() {
  const [data, setData] = useState<RealtimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'live' | 'analysis'>('live');
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState<GpuServer | null>(null);
  const [testing, setTesting] = useState(false);
  const [testR, setTestR] = useState<any>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [ana, setAna] = useState<any>(null);
  const [anaDays, setAnaDays] = useState(7);
  const ref = useRef<ReturnType<typeof setInterval>>();

  const fetch_ = useCallback(async () => { try { const r = await gpuServerApi.realtime(); setData(r.data.data || []); setUpdated(new Date()); } catch {} finally { setLoading(false); } }, []);
  const fetchAna = useCallback(async () => { try { const r = await gpuServerApi.analytics(anaDays); setAna(r.data); } catch {} }, [anaDays]);
  useEffect(() => { fetch_(); ref.current = setInterval(fetch_, 10000); return () => { if (ref.current) clearInterval(ref.current); }; }, [fetch_]);
  useEffect(() => { if (tab === 'analysis') fetchAna(); }, [tab, fetchAna]);

  // 종합 KPI
  const totGpu = data.reduce((a, e) => a + (e.metrics?.gpus?.length || 0), 0);
  const totVram = data.reduce((a, e) => a + (e.metrics?.gpus?.reduce((s, g) => s + g.memTotalMb, 0) || 0), 0);
  const usedVram = data.reduce((a, e) => a + (e.metrics?.gpus?.reduce((s, g) => s + g.memUsedMb, 0) || 0), 0);
  const online = data.filter(e => e.metrics && !e.metrics.error).length;
  const avgGpu = (() => { let s = 0, c = 0; data.forEach(e => e.metrics?.gpus?.forEach(g => { s += g.utilGpu; c++; })); return c > 0 ? Math.round(s / c) : 0; })();
  const totLlm = data.reduce((a, e) => a + (e.metrics?.llmEndpoints?.length || 0), 0);
  const totTps = data.reduce((a, e) => a + (e.throughputAnalysis?.currentTps || 0), 0);
  const avgHealth = (() => { const h = data.filter(e => e.throughputAnalysis?.gpuHealthPct != null).map(e => e.throughputAnalysis!.gpuHealthPct!); return h.length > 0 ? Math.round(h.reduce((a, v) => a + v, 0) / h.length) : null; })();
  const avgCpu = (() => { let s = 0, c = 0; data.forEach(e => { if (e.metrics?.cpuLoadAvg && e.metrics.cpuCores) { s += (e.metrics.cpuLoadAvg / e.metrics.cpuCores) * 100; c++; } }); return c > 0 ? Math.round(s / c) : null; })();
  const avgRam = (() => { let s = 0, c = 0; data.forEach(e => { if (e.metrics?.memoryTotalMb && e.metrics.memoryUsedMb) { s += (e.metrics.memoryUsedMb / e.metrics.memoryTotalMb) * 100; c++; } }); return c > 0 ? Math.round(s / c) : null; })();
  const capacityAll = Math.max(avgGpu, (() => { const kvs = data.flatMap(e => e.metrics?.llmEndpoints?.filter(l => l.kvCacheUsagePct != null) || []); return kvs.length > 0 ? kvs.reduce((a, l) => a + l.kvCacheUsagePct!, 0) / kvs.length : 0; })(), totVram > 0 ? (usedVram / totVram) * 100 : 0);

  const handleTest = async (d: any) => { setTesting(true); setTestR(null); try { setTestR((await gpuServerApi.test(d)).data); } catch (e: any) { setTestR({ success: false, message: e?.response?.data?.error || e.message }); } finally { setTesting(false); } };
  const handleSubmit = async (f: any) => { try { if (edit) { const u = { ...f }; if (!u.sshPassword) delete u.sshPassword; await gpuServerApi.update(edit.id, u); } else { await gpuServerApi.create(f); } setModal(false); setEdit(null); setTestR(null); fetch_(); } catch (e: any) { alert(e?.response?.data?.error || '실패'); } };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (<div className="space-y-4">
    {/* Header */}
    <div className="flex items-center justify-between">
      <div><h1 className="text-base font-bold text-gray-900 flex items-center gap-1.5"><Server className="w-4 h-4 text-blue-600" />리소스 모니터링</h1>
        <p className="text-[10px] text-gray-400 mt-0.5">SSH + LLM 자동 탐지{updated && <span className="ml-1">| {updated.toLocaleTimeString('ko-KR')}</span>}</p></div>
      <div className="flex items-center gap-1.5">
        <button onClick={fetch_} className="p-1.5 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"><RefreshCw className="w-3.5 h-3.5" /></button>
        <button onClick={() => { setEdit(null); setTestR(null); setModal(true); }} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700"><Plus className="w-3.5 h-3.5" />서버 추가</button>
      </div>
    </div>

    {/* 종합 KPI */}
    {data.length > 0 && (
      <div className="bg-white rounded-lg border p-3 shadow-sm">
        <div className="flex items-center gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5 text-emerald-500" /><span className="text-gray-500">서버</span><b>{online}/{data.length}</b></div>
          <div className="flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-500">GPU</span><b>{totGpu}장</b></div>
          <div className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-purple-500" /><span className="text-gray-500">LLM</span><b>{totLlm}개</b></div>
          <div className="border-l pl-3 flex items-center gap-1.5"><span className="text-gray-500">LLM 용량</span><b className={utilTxt(capacityAll)}>{Math.round(capacityAll)}%</b><div className="w-16"><MiniBar pct={capacityAll} color={utilCls(capacityAll)} /></div></div>
          {avgHealth != null && <div className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-500">건강도</span><b className={healthTxt(avgHealth)}>{avgHealth}%</b></div>}
          {totTps > 0 && <div className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-blue-500" /><b className="text-blue-600">{totTps.toFixed(1)} tok/s</b></div>}
          {(() => { const ta = data.filter(e => e.throughputAnalysis?.theoreticalUtilPct != null); const avg = ta.length > 0 ? Math.round(ta.reduce((a, e) => a + e.throughputAnalysis!.theoreticalUtilPct!, 0) / ta.length) : null; return avg != null ? <div className="flex items-center gap-1.5"><span className="text-gray-500">이론대비</span><b className={utilTxt(avg)}>{avg}%</b></div> : null; })()}
          <div className="border-l pl-3 flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-500">CPU</span><b className={avgCpu != null && avgCpu > 80 ? 'text-red-600' : ''}>{avgCpu ?? '-'}%</b></div>
          <div className="flex items-center gap-1.5"><MemoryStick className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-500">RAM</span><b className={avgRam != null && avgRam > 85 ? 'text-red-600' : ''}>{avgRam ?? '-'}%</b></div>
        </div>
      </div>
    )}

    {/* Tabs */}
    {data.length > 0 && (
      <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5 w-fit text-xs">
        <button onClick={() => setTab('live')} className={`px-3 py-1 rounded-md ${tab === 'live' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500'}`}>실시간</button>
        <button onClick={() => setTab('analysis')} className={`px-3 py-1 rounded-md ${tab === 'analysis' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500'}`}>분석</button>
      </div>
    )}

    {/* Live Tab */}
    {tab === 'live' && (data.length === 0 ? (
      <div className="bg-white rounded-lg border p-10 text-center"><Server className="w-10 h-10 text-gray-200 mx-auto mb-2" /><p className="text-xs text-gray-400 mb-3">등록된 서버 없음</p><button onClick={() => { setEdit(null); setTestR(null); setModal(true); }} className="text-xs text-blue-600 hover:underline">+ 서버 추가</button></div>
    ) : (
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.map(e => <ServerCard key={e.server.id} entry={e} onEdit={() => { setEdit(e.server); setTestR(null); setModal(true); }} onDelete={async () => { if (confirm(`"${e.server.name}" 삭제?`)) { try { await gpuServerApi.delete(e.server.id); fetch_(); } catch {} } }} onToggle={async () => { try { await gpuServerApi.update(e.server.id, { enabled: !e.server.enabled }); fetch_(); } catch {} }} />)}
      </div>
    ))}

    {/* Analysis Tab */}
    {tab === 'analysis' && ana && (<div className="space-y-4">
      <div className="flex items-center justify-between"><span className="text-xs font-medium text-gray-600">기간 분석 (휴일 {ana.period?.holidayCount || 0}일 제외)</span><div className="flex gap-0.5">{[3, 7, 14, 30].map(d => <button key={d} onClick={() => setAnaDays(d)} className={`px-2 py-1 text-[10px] rounded ${anaDays === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{d}일</button>)}</div></div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-gray-600 mb-2 flex items-center gap-1"><Clock className="w-3 h-3 text-blue-500" />영업시간 (9-18 평일)</p>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div><span className="text-gray-400">GPU</span><p className={`text-lg font-bold ${ana.businessHours?.avgGpuUtil != null ? utilTxt(ana.businessHours.avgGpuUtil) : 'text-gray-300'}`}>{ana.businessHours?.avgGpuUtil ?? '-'}%</p></div>
            <div><span className="text-gray-400">VRAM</span><p className="text-lg font-bold text-gray-800">{ana.businessHours?.avgMemUtil ?? '-'}%</p></div>
            <div><span className="text-gray-400">KV Cache</span><p className="text-lg font-bold text-purple-600">{ana.businessHours?.avgKvCache ?? '-'}%</p></div>
            <div><span className="text-gray-400">실행 요청</span><p className="font-bold text-gray-800">{ana.businessHours?.avgRunningReqs ?? '-'}</p></div>
            <div><span className="text-gray-400">대기 큐</span><p className={`font-bold ${(ana.businessHours?.avgWaitingReqs || 0) > 1 ? 'text-amber-600' : 'text-gray-800'}`}>{ana.businessHours?.avgWaitingReqs ?? '-'}</p></div>
            <div><span className="text-gray-400">처리량</span><p className="font-bold text-blue-600">{ana.businessHours?.avgThroughputTps ?? '-'} tok/s</p></div>
          </div>
        </div>
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-gray-600 mb-2 flex items-center gap-1"><Clock className="w-3 h-3 text-gray-400" />비영업시간</p>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div><span className="text-gray-400">GPU</span><p className="text-lg font-bold text-gray-500">{ana.offHours?.avgGpuUtil ?? '-'}%</p></div>
            <div><span className="text-gray-400">VRAM</span><p className="text-lg font-bold text-gray-500">{ana.offHours?.avgMemUtil ?? '-'}%</p></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-4 shadow-sm">
        <p className="text-[10px] font-semibold text-gray-600 mb-2">피크타임 히트맵 (시간 x 요일, GPU %)</p>
        <Heatmap data={ana.heatmap || []} />
        {ana.peakHours?.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{ana.peakHours.map((p: any, i: number) => <span key={i} className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[9px]">{DOW[p.dow]} {p.hour}시 {p.avgUtil}%</span>)}</div>}
      </div>

      {ana.throughputByHour && <div className="bg-white rounded-lg border p-4 shadow-sm">
        <p className="text-[10px] font-semibold text-gray-600 mb-2">시간대별 LLM 처리량 (tok/s)</p>
        <ResponsiveContainer width="100%" height={150}><BarChart data={ana.throughputByHour}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="hour" tick={{ fontSize: 9 }} tickFormatter={h => `${h}`} /><YAxis tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} /><Bar dataKey="avgTps" name="tok/s" fill="#3b82f6" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
      </div>}
    </div>)}

    <ServerModal open={modal} onClose={() => { setModal(false); setEdit(null); setTestR(null); }} onSubmit={handleSubmit} edit={edit} testing={testing} testResult={testR} onTest={handleTest} />
  </div>);
}
