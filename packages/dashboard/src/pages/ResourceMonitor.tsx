import { useState, useEffect, useCallback, useRef } from 'react';
import { gpuServerApi, gpuCapacityApi } from '../services/api';
import {
  Server, Plus, Trash2, RefreshCw, WifiOff, Cpu, MemoryStick,
  ChevronDown, ChevronUp, TestTube, Pencil, X, Copy,
  Activity, Clock, Layers, HardDrive, BarChart3,
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
interface ServerMetrics { serverId: string; serverName: string; timestamp: string; error?: string; gpus: GpuInfo[]; processes: GpuProcess[]; llmEndpoints: LlmEndpoint[]; cpuLoadAvg: number | null; cpuCores: number | null; memoryTotalMb: number | null; memoryUsedMb: number | null; diskTotalGb: number | null; diskUsedGb: number | null; diskFreeGb: number | null; hostname: string | null; }
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

// ── Server Form Modal ──
interface FormData { name: string; host: string; sshPort: number; sshUsername: string; sshPassword: string; description: string; isLocal: boolean; pollIntervalSec: number; }
const EMPTY_FORM: FormData = { name: '', host: '', sshPort: 22, sshUsername: '', sshPassword: '', description: '', isLocal: false, pollIntervalSec: 60 };
const ic = "w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500";

function ServerModal({ open, onClose, onSubmit, edit, testing, testResult, onTest, existingHosts }: {
  open: boolean; onClose: () => void; onSubmit: (d: FormData) => void; edit?: GpuServer | null;
  testing: boolean; testResult: any; onTest: (d: any) => void; existingHosts: string[];
}) {
  const [f, setF] = useState<FormData>(EMPTY_FORM);
  const set = (k: keyof FormData, v: any) => setF(p => ({ ...p, [k]: v }));
  const dupHost = !edit && existingHosts.includes(f.host);

  useEffect(() => {
    if (edit) setF({ name: edit.name, host: edit.host, sshPort: edit.sshPort, sshUsername: edit.sshUsername, sshPassword: '', description: edit.description || '', isLocal: edit.isLocal, pollIntervalSec: edit.pollIntervalSec });
    else setF(EMPTY_FORM);
  }, [edit, open]);

  if (!open) return null;
  return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
    <div className="flex items-center justify-between px-4 py-3 border-b"><h3 className="font-semibold text-sm text-gray-900">{edit ? '서버 수정' : '서버 추가'}</h3><button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button></div>
    <div className="p-4 space-y-3"><div className="grid grid-cols-2 gap-3">
      <div className="col-span-2"><label className="block text-[10px] font-medium text-gray-500 mb-0.5">서버 이름</label><input className={ic} placeholder="GPU서버-1" value={f.name} onChange={e => set('name', e.target.value)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">호스트 (IP){dupHost && <span className="text-red-500 ml-1">중복!</span>}</label><input className={`${ic} ${dupHost ? 'border-red-400' : ''}`} placeholder="192.168.1.100" value={f.host} onChange={e => set('host', e.target.value)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">SSH 포트</label><input type="number" className={ic} value={f.sshPort} onChange={e => set('sshPort', parseInt(e.target.value) || 22)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">사용자명</label><input className={ic} placeholder="root" value={f.sshUsername} onChange={e => set('sshUsername', e.target.value)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">비밀번호{edit && <span className="text-gray-400 ml-1">(변경 시만)</span>}</label><input type="password" className={ic} placeholder="••••" value={f.sshPassword} onChange={e => set('sshPassword', e.target.value)} /></div>
      <div className="col-span-2"><label className="block text-[10px] font-medium text-gray-500 mb-0.5">설명</label><input className={ic} placeholder="vLLM 서빙 전용 서버" value={f.description} onChange={e => set('description', e.target.value)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">폴링 (초)</label><input type="number" className={ic} value={f.pollIntervalSec} onChange={e => set('pollIntervalSec', parseInt(e.target.value) || 60)} /></div>
      <div className="flex items-end pb-0.5"><label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded text-blue-600" checked={f.isLocal} onChange={e => set('isLocal', e.target.checked)} />로컬 서버</label></div>
    </div>
    {testResult && <div className={`p-2 rounded text-xs ${testResult.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}><p className="font-medium">{testResult.message}</p>{testResult.gpuInfo && <pre className="mt-1 text-[10px] opacity-80 whitespace-pre-wrap max-h-32 overflow-y-auto">{testResult.gpuInfo}</pre>}</div>}
    </div>
    <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
      <button onClick={() => onTest({ host: f.host, sshPort: f.sshPort, sshUsername: f.sshUsername, sshPassword: f.sshPassword })} disabled={testing || !f.host || !f.sshUsername || !f.sshPassword} className="text-xs text-gray-600 hover:text-gray-800 disabled:opacity-50 flex items-center gap-1"><TestTube className="w-3 h-3" />{testing ? '테스트 중...' : '연결 테스트'}</button>
      <div className="flex gap-2"><button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500">취소</button><button onClick={() => onSubmit(f)} disabled={!f.name || !f.host || !f.sshUsername || (!edit && !f.sshPassword) || dupHost} className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50">{edit ? '수정' : '등록'}</button></div>
    </div>
  </div></div>);
}

// ── Compact Server Card ──
function ServerCard({ entry, onEdit, onDelete, onToggle, onCopy }: { entry: RealtimeEntry; onEdit: () => void; onDelete: () => void; onToggle: () => void; onCopy: () => void; }) {
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState<any>(null);
  const [hrs, setHrs] = useState(24);
  const [dbg, setDbg] = useState<string | null>(null);
  const [dbgL, setDbgL] = useState(false);
  const { server: s, metrics: m, throughputAnalysis: ta } = entry;
  const ok = m && !m.error;
  const gc = m?.gpus?.length || 0;
  const spec = m?.gpus?.[0]?.spec;
  // VRAM 정보 (GPU 상세 펼침에서 사용)
  void gc; // gc는 spec 표시에서 사용
  const eps = m?.llmEndpoints || [];
  const avgKv = eps.filter(e => e.kvCacheUsagePct != null);
  const kvPct = avgKv.length > 0 ? avgKv.reduce((a, e) => a + e.kvCacheUsagePct!, 0) / avgKv.length : null;
  const cpuPct = m?.cpuLoadAvg && m?.cpuCores ? Math.min(Math.round((m.cpuLoadAvg / m.cpuCores) * 100), 100) : null;
  const ramPct = m?.memoryTotalMb && m?.memoryUsedMb ? Math.round((m.memoryUsedMb / m.memoryTotalMb) * 100) : null;
  const diskPct = m?.diskTotalGb && m?.diskUsedGb ? Math.round((m.diskUsedGb / m.diskTotalGb) * 100) : null;
  const currentTps = eps.reduce((a, e) => a + (e.promptThroughputTps || 0) + (e.genThroughputTps || 0), 0);
  // 서버별 핵심 지표
  const serverEffUtil = (ta?.theoreticalUtilPct != null && ta?.gpuHealthPct && ta.gpuHealthPct > 0) ? Math.round((ta.theoreticalUtilPct / ta.gpuHealthPct) * 100) : ta?.theoreticalUtilPct || null;
  const serverHeadroom = serverEffUtil != null ? 100 - serverEffUtil : null;

  const loadHist = useCallback(async () => { try { const r = await gpuServerApi.history(s.id, hrs); setHist(r.data); } catch {} }, [s.id, hrs]);
  // 영업시간 평균은 항상 로드 (컴팩트 뷰에 표시), 차트 데이터는 open 시
  useEffect(() => { if (!hist) loadHist(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) loadHist(); }, [open, loadHist]);

  const cd = hist?.snapshots?.map((snap: any) => {
    const gs = snap.gpuMetrics as GpuInfo[]; const ps = (snap.gpuProcesses || []) as GpuProcess[]; const ls = (snap.llmMetrics || []) as LlmEndpoint[];
    const au = gs.length > 0 ? gs.reduce((a: number, g: any) => a + g.utilGpu, 0) / gs.length : 0;
    const tm = gs.reduce((a: number, g: any) => a + g.memTotalMb, 0); const um = gs.reduce((a: number, g: any) => a + g.memUsedMb, 0);
    const lm = ps.filter((p: any) => p.isLlm).reduce((a: number, p: any) => a + p.memMb, 0);
    const kvs = ls.filter((l: any) => l.kvCacheUsagePct != null); const kv = kvs.length > 0 ? kvs.reduce((a: number, l: any) => a + l.kvCacheUsagePct, 0) / kvs.length : null;
    const tp = ls.reduce((a: number, l: any) => a + (l.promptThroughputTps || 0) + (l.genThroughputTps || 0), 0);
    const t = new Date(snap.timestamp);
    // 건강도/실효사용률은 이론max 대비이므로 throughputAnalysis 기반이 아닌 KV+GPU로 추정
    const effUtil = kv != null ? kv : (tm > 0 ? (um / tm) * 100 : au);
    return { time: t.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), fullTime: t.toLocaleString('ko-KR'), gpuUtil: Math.round(au * 10) / 10, memPct: tm > 0 ? Math.round((um / tm) * 1000) / 10 : 0, llmPct: tm > 0 ? Math.round((lm / tm) * 1000) / 10 : 0, kvCache: kv ? Math.round(kv * 10) / 10 : null, throughput: tp > 0 ? Math.round(tp * 10) / 10 : null, effUtil: Math.round(effUtil * 10) / 10, cpuLoad: snap.cpuLoadAvg, ramPct: snap.memoryTotalMb > 0 ? Math.round((snap.memoryUsedMb / snap.memoryTotalMb) * 1000) / 10 : 0 };
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
            <button onClick={onEdit} className="p-1 text-gray-300 hover:text-gray-500" title="수정"><Pencil className="w-3 h-3" /></button>
            <button onClick={onCopy} className="p-1 text-gray-300 hover:text-blue-500" title="복사"><Copy className="w-3 h-3" /></button>
            <button onClick={onToggle} className={`px-1.5 py-0.5 text-[9px] rounded ${s.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>{s.enabled ? 'ON' : 'OFF'}</button>
            <button onClick={onDelete} className="p-1 text-gray-300 hover:text-red-400" title="삭제"><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>

        {m?.error ? <p className="text-[10px] text-red-500"><WifiOff className="w-3 h-3 inline mr-0.5" />{m.error}</p> : ok ? (<>
          {/* ── 1) 핵심: 실효 사용률 + 건강도 + 여유 ── */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-blue-600 font-semibold w-12 shrink-0">실효</span>
            <div className="flex-1"><MiniBar pct={serverEffUtil || 0} color={utilCls(serverEffUtil || 0)} h="h-2.5" /></div>
            <span className={`text-xs font-bold w-8 text-right ${serverEffUtil != null ? utilTxt(serverEffUtil) : 'text-gray-300'}`}>{serverEffUtil ?? '-'}%</span>
          </div>
          <div className="flex items-center gap-3 mb-1.5 text-[10px]">
            {ta?.theoreticalUtilPct != null && <span className="text-gray-500">이론대비 <b className={utilTxt(ta.theoreticalUtilPct)}>{ta.theoreticalUtilPct}%</b></span>}
            {ta?.gpuHealthPct != null && <span>건강도 <b className={healthTxt(ta.gpuHealthPct)}>{ta.gpuHealthPct}%</b></span>}
            {serverHeadroom != null && <span>여유 <b className={serverHeadroom <= 20 ? 'text-red-600' : 'text-emerald-600'}>{serverHeadroom}%</b></span>}
          </div>

          {/* ── 2) 처리량 + 모델 ── */}
          {ta && (
            <div className="flex items-center gap-3 mb-1.5 text-[10px]">
              {ta.currentTps > 0 && <span className="text-blue-600 font-semibold">{ta.currentTps.toFixed(1)} tok/s</span>}
              {ta.theoreticalMaxTps && <span className="text-gray-400">/ {ta.theoreticalMaxTps.toFixed(0)} max</span>}
              {ta.peakTps != null && ta.peakTps > 0 && <span className="text-gray-400">피크 {ta.peakTps.toFixed(1)}</span>}
              {ta.modelParams && <span className="text-gray-400">({ta.modelParams})</span>}
            </div>
          )}

          {/* ── 3) 영업시간 평균 (9-18 KST) ── */}
          {hist?.businessHoursAvg && (
            <div className="grid grid-cols-3 gap-1.5 mb-1.5">
              <div className="text-[9px]"><span className="text-gray-400">영업시간 실효</span><div className="flex items-center gap-1"><MiniBar pct={hist.businessHoursAvg.avgGpuUtil || 0} color={utilCls(hist.businessHoursAvg.avgGpuUtil || 0)} h="h-1.5" /><b className={utilTxt(hist.businessHoursAvg.avgGpuUtil || 0)}>{hist.businessHoursAvg.avgGpuUtil || 0}%</b></div></div>
              <div className="text-[9px]"><span className="text-gray-400">영업시간 이론대비</span><div className="flex items-center gap-1"><MiniBar pct={hist.businessHoursAvg.avgMemUtil || 0} color="bg-indigo-400" h="h-1.5" /><b>{hist.businessHoursAvg.avgMemUtil || 0}%</b></div></div>
              <div className="text-[9px]"><span className="text-gray-400">영업시간 건강도</span><div className="flex items-center gap-1"><MiniBar pct={ta?.gpuHealthPct || 0} color={ta?.gpuHealthPct && ta.gpuHealthPct < 80 ? 'bg-red-400' : 'bg-emerald-400'} h="h-1.5" /><b className={healthTxt(ta?.gpuHealthPct || 0)}>{ta?.gpuHealthPct ?? '-'}%</b></div></div>
            </div>
          )}

          {/* ── 4) 시스템 리소스 한 줄 ── */}
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            {cpuPct != null && <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />CPU <b className={cpuPct > 80 ? 'text-red-600' : 'text-gray-700'}>{cpuPct}%</b></span>}
            {ramPct != null && <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" />RAM <b className={ramPct > 85 ? 'text-red-600' : 'text-gray-700'}>{ramPct}%</b></span>}
            {diskPct != null && <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />Disk <b className={diskPct > 90 ? 'text-red-600' : 'text-gray-700'}>{diskPct}%</b><span className="text-gray-400">({m.diskFreeGb}GB free)</span></span>}
            {currentTps > 0 && <span className="flex items-center gap-1 text-blue-600"><Activity className="w-3 h-3" /><b>{currentTps.toFixed(1)}</b> tok/s</span>}
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
            <div className="space-y-3">
              {/* 실효사용률 + KV Cache + GPU 사용률 */}
              <div><p className="text-[9px] text-gray-400 mb-0.5">실효사용률 / KV Cache / GPU (%)</p>
              <ResponsiveContainer width="100%" height={140}><AreaChart data={dd}><defs><linearGradient id="gG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} /><Tooltip content={<Tip />} /><Area type="monotone" dataKey="effUtil" name="실효사용률" stroke="#2563eb" fill="url(#gG)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="kvCache" name="KV Cache" stroke="#8b5cf6" strokeWidth={1.5} dot={false} strokeDasharray="3 2" /><Line type="monotone" dataKey="gpuUtil" name="GPU" stroke="#94a3b8" strokeWidth={1} dot={false} /></AreaChart></ResponsiveContainer></div>
              {/* tok/s 처리량 */}
              <div><p className="text-[9px] text-gray-400 mb-0.5">처리량 (tok/s)</p>
              <ResponsiveContainer width="100%" height={100}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} /><Line type="monotone" dataKey="throughput" name="tok/s" stroke="#3b82f6" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
              {/* CPU / RAM / VRAM */}
              <div><p className="text-[9px] text-gray-400 mb-0.5">시스템 리소스 (%)</p>
              <ResponsiveContainer width="100%" height={80}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} /><Line type="monotone" dataKey="ramPct" name="RAM" stroke="#ec4899" strokeWidth={1} dot={false} /><Line type="monotone" dataKey="memPct" name="VRAM" stroke="#f59e0b" strokeWidth={1} dot={false} /></LineChart></ResponsiveContainer></div>
            </div>
          </div>

          {/* 디버그 */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <button onClick={async () => { setDbgL(true); try { const r = await gpuServerApi.debug(s.id); setDbg(r.data.raw); } catch (e: any) { setDbg('Error: ' + e.message); } finally { setDbgL(false); } }} className="text-[9px] text-gray-400 hover:text-gray-600 underline">{dbgL ? '조회 중...' : 'SSH Raw 출력 (디버그)'}</button>
              {dbg && <button onClick={() => { try { navigator.clipboard.writeText(dbg); } catch { const ta = document.createElement('textarea'); ta.value = dbg; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } alert('복사됨'); }} className="text-[9px] text-blue-400 hover:text-blue-600 underline">복사</button>}
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
  const [pred, setPred] = useState<any>(null);
  const [predRunning, setPredRunning] = useState(false);
  const ref = useRef<ReturnType<typeof setInterval>>();

  const fetch_ = useCallback(async () => { try { const [r, p] = await Promise.all([gpuServerApi.realtime(), gpuCapacityApi.latest()]); setData(r.data.data || []); setPred(p.data.prediction); setUpdated(new Date()); } catch {} finally { setLoading(false); } }, []);
  const fetchAna = useCallback(async () => { try { const r = await gpuServerApi.analytics(anaDays); setAna(r.data); } catch {} }, [anaDays]);
  useEffect(() => { fetch_(); ref.current = setInterval(fetch_, 10000); return () => { if (ref.current) clearInterval(ref.current); }; }, [fetch_]);
  useEffect(() => { if (tab === 'analysis') fetchAna(); }, [tab, fetchAna]);

  // ── 종합 KPI (투자 판단 관점) ──
  const totGpu = data.reduce((a, e) => a + (e.metrics?.gpus?.length || 0), 0);
  const online = data.filter(e => e.metrics && !e.metrics.error).length;
  const totLlm = data.reduce((a, e) => a + (e.metrics?.llmEndpoints?.length || 0), 0);
  const totTps = data.reduce((a, e) => a + (e.throughputAnalysis?.currentTps || 0), 0);

  // 건강도 = 피크/이론 (GPU 성능 저하 감지)
  const avgHealth = (() => { const h = data.filter(e => e.throughputAnalysis?.gpuHealthPct != null).map(e => e.throughputAnalysis!.gpuHealthPct!); return h.length > 0 ? Math.round(h.reduce((a, v) => a + v, 0) / h.length) : null; })();
  // 이론 최대 대비 사용률 = 현재/이론max
  const avgTheoreticalUtil = (() => { const h = data.filter(e => e.throughputAnalysis?.theoreticalUtilPct != null).map(e => e.throughputAnalysis!.theoreticalUtilPct!); return h.length > 0 ? Math.round(h.reduce((a, v) => a + v, 0) / h.length) : null; })();
  // 실효 가용량 대비 사용률 = 현재/(이론max × 건강도) = theoreticalUtil / health
  const effectiveUtil = (avgTheoreticalUtil != null && avgHealth != null && avgHealth > 0) ? Math.round((avgTheoreticalUtil / avgHealth) * 100) : avgTheoreticalUtil;
  // 여유 = 100 - 실효사용률
  const headroom = effectiveUtil != null ? 100 - effectiveUtil : null;
  // 시스템 리소스
  const avgCpu = (() => { let s = 0, c = 0; data.forEach(e => { if (e.metrics?.cpuLoadAvg && e.metrics.cpuCores) { s += (e.metrics.cpuLoadAvg / e.metrics.cpuCores) * 100; c++; } }); return c > 0 ? Math.round(s / c) : null; })();
  const avgRam = (() => { let s = 0, c = 0; data.forEach(e => { if (e.metrics?.memoryTotalMb && e.metrics.memoryUsedMb) { s += (e.metrics.memoryUsedMb / e.metrics.memoryTotalMb) * 100; c++; } }); return c > 0 ? Math.round(s / c) : null; })();
  const avgDisk = (() => { let s = 0, c = 0; data.forEach(e => { if (e.metrics?.diskTotalGb && e.metrics.diskUsedGb) { s += (e.metrics.diskUsedGb / e.metrics.diskTotalGb) * 100; c++; } }); return c > 0 ? Math.round(s / c) : null; })();

  const handleTest = async (d: any) => { setTesting(true); setTestR(null); try { setTestR((await gpuServerApi.test(d)).data); } catch (e: any) { setTestR({ success: false, message: e?.response?.data?.error || e.message }); } finally { setTesting(false); } };
  const handleSubmit = async (f: any) => { try { if (edit && edit.id) { const u = { ...f }; if (!u.sshPassword) delete u.sshPassword; await gpuServerApi.update(edit.id, u); } else { await gpuServerApi.create(f); } setModal(false); setEdit(null); setTestR(null); fetch_(); } catch (e: any) { alert(e?.response?.data?.error || '실패'); } };

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

    {/* GPU 수요 예측 하이라이트 */}
    {pred && (
      <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-purple-50 rounded-lg border border-indigo-200 p-4 shadow-sm">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center"><BarChart3 className="w-4 h-4 text-indigo-600" /></div>
            <div><p className="text-xs font-bold text-gray-900">GPU 수요 예측</p><p className="text-[10px] text-gray-500">{new Date(pred.date).toLocaleDateString('ko-KR')} 기준 | 목표 {pred.targetUserCount?.toLocaleString()}명</p></div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${pred.aiConfidence === 'HIGH' ? 'bg-emerald-100 text-emerald-700' : pred.aiConfidence === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{pred.aiConfidence}</span>
            <button onClick={async () => { setPredRunning(true); try { const r = await gpuCapacityApi.run(); setPred(r.data.prediction); } catch (e: any) { alert(e?.response?.data?.error || '실패'); } finally { setPredRunning(false); } }} disabled={predRunning} className="text-[10px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50">{predRunning ? '분석 중...' : '재실행'}</button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-3">
          <div><p className="text-[10px] text-gray-500">현재 사용자</p><p className="text-lg font-bold text-gray-900">{pred.currentUsers?.toLocaleString()}<span className="text-xs font-normal text-gray-400 ml-0.5">명</span></p><p className="text-[10px] text-gray-400">DAU {Math.round(pred.currentDau)}</p></div>
          <div><p className="text-[10px] text-gray-500">현재 GPU VRAM</p><p className="text-lg font-bold text-gray-900">{Math.round(pred.currentTotalVramGb)}<span className="text-xs font-normal text-gray-400 ml-0.5">GB</span></p></div>
          <div><p className="text-[10px] text-gray-500">예상 필요 VRAM</p><p className="text-lg font-bold text-indigo-700">{Math.round(pred.predictedTotalVramGb)}<span className="text-xs font-normal text-gray-400 ml-0.5">GB</span></p></div>
          <div><p className="text-[10px] text-gray-500">부족분</p><p className={`text-lg font-bold ${pred.gapVramGb > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{pred.gapVramGb > 0 ? `+${Math.round(pred.gapVramGb)}` : '0'}<span className="text-xs font-normal text-gray-400 ml-0.5">GB</span></p></div>
          <div className="sm:col-span-2 bg-white/60 rounded-lg p-2 border border-indigo-100">
            <p className="text-[10px] text-gray-500">추가 필요 GPU</p>
            <p className="text-2xl font-black text-indigo-700">{pred.predictedB300Units}<span className="text-sm font-normal text-gray-500 ml-1">B300</span></p>
            <p className="text-[10px] text-gray-400">(192GB/장 기준)</p>
          </div>
        </div>
        {/* 성장률 + 에러율 */}
        {pred.calculationDetails?.growth && (
          <div className="flex flex-wrap gap-3 mb-2 text-[10px]">
            <span className="text-gray-500">주간 성장률: <b className={pred.calculationDetails.growth.weeklyGrowthRate > 5 ? 'text-red-600' : pred.calculationDetails.growth.weeklyGrowthRate > 0 ? 'text-amber-600' : 'text-gray-700'}>{pred.calculationDetails.growth.weeklyGrowthRate}%</b></span>
            <span className="text-gray-500">DAU 성장: <b>{pred.calculationDetails.growth.dauGrowthRate}%</b>/주</span>
            <span className="text-gray-500">인당 토큰 성장: <b>{pred.calculationDetails.growth.tokensPerUserGrowthRate}%</b>/주</span>
            <span className="text-gray-500">6개월 배율: <b>x{pred.calculationDetails.growth.growthMultiplier6mo}</b></span>
            {pred.calculationDetails.inputs?.errorRate > 0 && <span className="text-gray-500">에러율: <b className={pred.calculationDetails.inputs.errorRate > 5 ? 'text-red-600' : 'text-gray-700'}>{pred.calculationDetails.inputs.errorRate}%</b></span>}
          </div>
        )}
        {/* 서비스별 Top */}
        {pred.calculationDetails?.topServices?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {pred.calculationDetails.topServices.slice(0, 3).map((s: any, i: number) => (
              <span key={i} className="px-1.5 py-0.5 bg-white/60 rounded text-[9px] text-gray-600 border border-gray-200">{s.name}: {(s.tokens / 1000000).toFixed(1)}M tok</span>
            ))}
          </div>
        )}
        {/* 계산 논리 */}
        {pred.calculationDetails && (
          <details className="text-[10px]">
            <summary className="cursor-pointer text-indigo-600 font-medium hover:text-indigo-800">계산 논리 보기</summary>
            <div className="mt-2 p-2 bg-white/70 rounded-lg space-y-1 text-gray-600">
              <p><b>1. 스케일링:</b> DAU 비율 {(pred.calculationDetails.inputs?.dauRatio * 100).toFixed(1)}% x 서브리니어 0.7 = 기본 x{pred.calculationDetails.scaling?.scalingFactor} → 성장 반영 x{pred.calculationDetails.growth?.growthAdjustedScaling}</p>
              <p><b>2. Method A</b> (모델가중치 {pred.calculationDetails.methodA?.modelWeightVram}GB 고정 + KV {pred.calculationDetails.methodA?.kvVramCurrent}GB → {pred.calculationDetails.methodA?.kvVramPredicted}GB): <b>{pred.calculationDetails.methodA?.totalVramA}GB</b></p>
              <p><b>3. Method B</b> (처리량 {pred.calculationDetails.methodB?.currentTps} → {pred.calculationDetails.methodB?.predictedTps} tok/s, 이론 max {pred.calculationDetails.methodB?.weightedMaxTps} tok/s): <b>{pred.calculationDetails.methodB?.totalVramB}GB</b></p>
              <p><b>4. 최종:</b> max(A,B) x 안전마진 {pred.safetyMargin} x 에러보정 {pred.calculationDetails.scaling?.errorMargin} = <b>{Math.round(pred.predictedTotalVramGb)}GB</b></p>
              {pred.calculationDetails.inputs?.detectedModels?.length > 0 && <p><b>모델:</b> {pred.calculationDetails.inputs.detectedModels.join(', ')} ({pred.calculationDetails.inputs.modelParams || '?'})</p>}
              {pred.calculationDetails.confidenceIssues?.length > 0 && <p className="text-amber-600"><b>주의:</b> {pred.calculationDetails.confidenceIssues.join(', ')}</p>}
              {pred.calculationDetails.recommendations?.length > 0 && <div className="mt-1"><b>권고:</b><ul className="list-disc ml-4">{pred.calculationDetails.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></div>}
            </div>
          </details>
        )}
        {/* AI 분석 */}
        {pred.aiAnalysis && pred.modelId !== 'none' && (
          <details className="text-[10px] mt-1">
            <summary className="cursor-pointer text-purple-600 font-medium hover:text-purple-800">AI 분석 리포트</summary>
            <div className="mt-2 p-3 bg-white/70 rounded-lg text-gray-700 whitespace-pre-wrap leading-relaxed">{pred.aiAnalysis}</div>
          </details>
        )}
      </div>
    )}

    {/* ── 종합 KPI (투자 판단 우선순위) ── */}
    {data.length > 0 && (
      <div className="bg-white rounded-lg border shadow-sm">
        {/* 핵심 지표 */}
        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-2.5 border border-blue-100">
            <p className="text-[9px] text-blue-600 font-semibold uppercase">실효 가용량 대비 사용률</p>
            <p className={`text-2xl font-black ${effectiveUtil != null ? utilTxt(effectiveUtil) : 'text-gray-300'}`}>{effectiveUtil ?? '-'}%</p>
            <p className="text-[9px] text-gray-400">건강도 반영 실사용</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
            <p className="text-[9px] text-gray-600 font-semibold uppercase">이론 최대 대비</p>
            <p className={`text-2xl font-black ${avgTheoreticalUtil != null ? utilTxt(avgTheoreticalUtil) : 'text-gray-300'}`}>{avgTheoreticalUtil ?? '-'}%</p>
            <p className="text-[9px] text-gray-400">현재 / 이론max</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
            <p className="text-[9px] text-gray-600 font-semibold uppercase">GPU 건강도</p>
            <p className={`text-2xl font-black ${avgHealth != null ? healthTxt(avgHealth) : 'text-gray-300'}`}>{avgHealth ?? '-'}%</p>
            <p className="text-[9px] text-gray-400">피크 / 이론max</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
            <p className="text-[9px] text-gray-600 font-semibold uppercase">여유 용량</p>
            <p className={`text-2xl font-black ${headroom != null ? (headroom <= 20 ? 'text-red-600' : headroom <= 40 ? 'text-amber-600' : 'text-emerald-600') : 'text-gray-300'}`}>{headroom ?? '-'}%</p>
            <p className="text-[9px] text-gray-400">{headroom != null && headroom <= 20 ? '증설 필요!' : '포화까지 남은 %'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
            <p className="text-[9px] text-gray-600 font-semibold uppercase">처리량</p>
            <p className="text-2xl font-black text-blue-600">{totTps > 0 ? totTps.toFixed(1) : '-'}</p>
            <p className="text-[9px] text-gray-400">tok/s (전체 서버 합산)</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
            <p className="text-[9px] text-gray-600 font-semibold uppercase">인프라</p>
            <p className="text-sm font-bold text-gray-900">{totGpu}GPU · {totLlm}LLM · {online}/{data.length}서버</p>
            <div className="flex gap-2 mt-0.5 text-[9px] text-gray-500">
              <span>CPU <b className={avgCpu != null && avgCpu > 80 ? 'text-red-600' : ''}>{avgCpu ?? '-'}%</b></span>
              <span>RAM <b className={avgRam != null && avgRam > 85 ? 'text-red-600' : ''}>{avgRam ?? '-'}%</b></span>
              <span>Disk <b className={avgDisk != null && avgDisk > 90 ? 'text-red-600' : ''}>{avgDisk ?? '-'}%</b></span>
            </div>
          </div>
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
        {data.map(e => <ServerCard key={e.server.id} entry={e}
          onEdit={() => { setEdit(e.server); setTestR(null); setModal(true); }}
          onCopy={() => { setEdit({ ...e.server, id: '', name: e.server.name + ' (복사)', host: '' } as any); setTestR(null); setModal(true); }}
          onDelete={async () => { if (confirm(`"${e.server.name}" 삭제?`)) { try { await gpuServerApi.delete(e.server.id); fetch_(); } catch {} } }}
          onToggle={async () => { try { await gpuServerApi.update(e.server.id, { enabled: !e.server.enabled }); fetch_(); } catch {} }}
        />)}
      </div>
    ))}

    {/* Analysis Tab */}
    {tab === 'analysis' && ana && (<div className="space-y-4">
      <div className="flex items-center justify-between"><span className="text-xs font-medium text-gray-600">기간 분석 (휴일 {ana.period?.holidayCount || 0}일 제외)</span><div className="flex gap-0.5">{[3, 7, 14, 30].map(d => <button key={d} onClick={() => setAnaDays(d)} className={`px-2 py-1 text-[10px] rounded ${anaDays === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{d}일</button>)}</div></div>

      {/* 서버별 핵심 지표 비교 */}
      {data.length > 0 && (
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-gray-600 mb-3">서버별 성능 비교 (실효사용률 / 건강도 / 처리량)</p>
          <div className="space-y-2">
            {data.filter(e => e.metrics && !e.metrics.error).map(e => {
              const t = e.throughputAnalysis;
              const eu = (t?.theoreticalUtilPct != null && t?.gpuHealthPct && t.gpuHealthPct > 0) ? Math.round((t.theoreticalUtilPct / t.gpuHealthPct) * 100) : t?.theoreticalUtilPct || 0;
              const tooltip = [
                `서버: ${e.server.name}`,
                `이론 최대: ${t?.theoreticalMaxTps?.toFixed(1) || '?'} tok/s (${t?.modelParams || '?'} 모델 × GPU 대역폭 기반)`,
                `7일 피크: ${t?.peakTps?.toFixed(1) || '?'} tok/s`,
                `현재: ${t?.currentTps?.toFixed(1) || '0'} tok/s`,
                ``,
                `건강도 = 피크(${t?.peakTps?.toFixed(1) || '?'}) / 이론(${t?.theoreticalMaxTps?.toFixed(1) || '?'}) = ${t?.gpuHealthPct ?? '?'}%`,
                `이론대비 = 현재(${t?.currentTps?.toFixed(1) || '0'}) / 이론(${t?.theoreticalMaxTps?.toFixed(1) || '?'}) = ${t?.theoreticalUtilPct ?? '?'}%`,
                `실효사용률 = 이론대비(${t?.theoreticalUtilPct ?? '?'}%) / 건강도(${t?.gpuHealthPct ?? '?'}%) = ${eu}%`,
                `여유 = 100% - ${eu}% = ${100 - eu}%`,
              ].join('\n');
              return (
                <div key={e.server.id} className="grid grid-cols-12 gap-2 items-center text-[10px] cursor-help" title={tooltip}>
                  <span className="col-span-2 text-gray-700 font-medium truncate">{e.server.name}</span>
                  <div className="col-span-3"><span className="text-gray-400">실효 {eu}%</span><MiniBar pct={eu} color={utilCls(eu)} h="h-2" /></div>
                  <div className="col-span-2"><span className="text-gray-400">이론대비 {t?.theoreticalUtilPct ?? '-'}%</span><MiniBar pct={t?.theoreticalUtilPct || 0} color="bg-indigo-400" h="h-2" /></div>
                  <div className="col-span-2"><span className="text-gray-400">건강도 {t?.gpuHealthPct ?? '-'}%</span><MiniBar pct={t?.gpuHealthPct || 0} color={t?.gpuHealthPct && t.gpuHealthPct < 80 ? 'bg-red-400' : 'bg-emerald-400'} h="h-2" /></div>
                  <div className="col-span-2 text-right"><span className="text-blue-600 font-bold">{t?.currentTps?.toFixed(1) || '-'}</span><span className="text-gray-400"> tok/s</span></div>
                  <div className="col-span-1 text-right"><span className={`px-1 py-0.5 rounded text-[8px] ${eu > 70 ? 'bg-red-100 text-red-600' : eu < 20 ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>{eu > 70 ? '과부하' : eu < 20 ? '여유' : '정상'}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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

    <ServerModal open={modal} onClose={() => { setModal(false); setEdit(null); setTestR(null); }} onSubmit={handleSubmit} edit={edit} testing={testing} testResult={testR} onTest={handleTest} existingHosts={data.map(e => e.server.host)} />
  </div>);
}
