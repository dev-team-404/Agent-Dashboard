import { useState, useEffect, useCallback, useRef } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
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
interface LlmEndpoint { port: number; containerName: string; containerImage: string; type: string; modelNames: string[]; runningRequests: number | null; waitingRequests: number | null; kvCacheUsagePct: number | null; promptThroughputTps: number | null; genThroughputTps: number | null; ttftMs: number | null; tpotMs: number | null; e2eLatencyMs: number | null; prefixCacheHitRate: number | null; preemptionCount: number | null; queueTimeMs: number | null; rawMetrics?: Record<string, number>; }
interface ServerMetrics { serverId: string; serverName: string; timestamp: string; error?: string; gpus: GpuInfo[]; processes: GpuProcess[]; llmEndpoints: LlmEndpoint[]; cpuLoadAvg: number | null; cpuCores: number | null; memoryTotalMb: number | null; memoryUsedMb: number | null; diskTotalGb: number | null; diskUsedGb: number | null; diskFreeGb: number | null; hostname: string | null; }
interface GpuServer { id: string; name: string; host: string; sshPort: number; sshUsername: string; description: string | null; isLocal: boolean; enabled: boolean; pollIntervalSec: number; createdAt: string; }
interface ThroughputAnalysis { theoreticalMaxTps: number | null; bandwidthMaxTps: number | null; peakTps: number | null; currentTps: number; modelName: string | null; modelParams: string | null; gpuHealthPct: number | null; utilizationPct: number | null; theoreticalUtilPct: number | null; practicalUtilPct: number | null; practicalHealthPct: number | null; }
interface CapacityAnalysis { compositeCapacity: number | null; bottleneck: 'throughput' | 'kvMemory' | 'concurrency' | null; tokPct: number | null; kvPct: number | null; concPct: number | null; currentTps: number; peakTps: number | null; modelName: string | null; modelParams: string | null; benchmark: { peakTps: number; peakKvPct: number; peakConcurrent: number; source: string } | null; }
interface RealtimeEntry { server: GpuServer; metrics: ServerMetrics | null; throughputAnalysis?: ThroughputAnalysis; capacityAnalysis?: CapacityAnalysis; }

// ── Helpers ──
const fmt = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
const utilCls = (p: number) => p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : p >= 40 ? 'bg-blue-500' : 'bg-emerald-500';
const utilTxt = (p: number) => p >= 90 ? 'text-red-600' : p >= 70 ? 'text-amber-600' : 'text-gray-900';
const llmBadge = (t: string) => ({ vllm: 'bg-blue-100 text-blue-700', sglang: 'bg-purple-100 text-purple-700', ollama: 'bg-green-100 text-green-700', tgi: 'bg-orange-100 text-orange-700' }[t] || 'bg-gray-100 text-gray-600');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// ── 마크다운→HTML 변환 (테이블 포함) ──
function mdToHtml(md: string): string {
  if (!md) return '';
  let html = md;
  // 마크다운 테이블 변환 (| col | col | 형식)
  html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return tableBlock;
    const parseRow = (r: string) => r.split('|').slice(1, -1).map(c => c.trim());
    const headerCells = parseRow(rows[0]);
    // 구분선 (|---|---| ) 건너뛰기
    const startIdx = rows[1]?.match(/^[\s|:-]+$/) ? 2 : 1;
    let t = '<table class="w-full text-[10px] border-collapse my-2"><thead><tr>';
    for (const h of headerCells) t += `<th class="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-semibold">${h}</th>`;
    t += '</tr></thead><tbody>';
    for (let i = startIdx; i < rows.length; i++) {
      const cells = parseRow(rows[i]);
      t += '<tr>';
      for (const c of cells) t += `<td class="border border-gray-200 px-2 py-1">${c}</td>`;
      t += '</tr>';
    }
    t += '</tbody></table>';
    return t;
  });
  // 기존 마크다운 변환
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^### (.*$)/gm, '<h3 style="font-size:12px;font-weight:700;margin:8px 0 2px">$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2 style="font-size:13px;font-weight:700;margin:10px 0 3px">$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1 style="font-size:14px;font-weight:700;margin:12px 0 4px">$1</h1>');
  // 번호 리스트: 1. 2. 3. → <ol><li>
  html = html.replace(/((?:^\d+\. .*$\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => l.replace(/^\d+\.\s*/, ''));
    return '<ol style="list-style:decimal;padding-left:20px;margin:2px 0">' + items.map(i => `<li style="margin:1px 0">${i}</li>`).join('') + '</ol>';
  });
  // 불릿 리스트: - → <ul><li>
  html = html.replace(/((?:^- .*$\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => l.replace(/^- /, ''));
    return '<ul style="list-style:disc;padding-left:20px;margin:2px 0">' + items.map(i => `<li style="margin:1px 0">${i}</li>`).join('') + '</ul>';
  });
  // 링크: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#2563eb;text-decoration:underline">$1</a>');
  // 단락 간격: 빈 줄 = 작은 간격, 단순 줄바꿈 = 줄바꿈
  html = html.replace(/\n\n/g, '<div style="height:4px"></div>');
  html = html.replace(/\n/g, '<br/>');
  return html;
}
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
  const [coach, setCoach] = useState<any>(null);
  const [coachL, setCoachL] = useState(false);
  const { server: s, metrics: m, throughputAnalysis: ta } = entry;
  const ok = m && !m.error;
  const gc = m?.gpus?.length || 0;
  const spec = m?.gpus?.[0]?.spec;
  // VRAM 정보 (GPU 상세 펼침에서 사용)
  void gc; // gc는 spec 표시에서 사용
  const eps = (m?.llmEndpoints || []).filter(e => e.type !== 'unknown');
  const avgKv = eps.filter(e => e.kvCacheUsagePct != null);
  const kvPct = avgKv.length > 0 ? avgKv.reduce((a, e) => a + e.kvCacheUsagePct!, 0) / avgKv.length : null;
  const cpuPct = m?.cpuLoadAvg && m?.cpuCores ? Math.min(Math.round((m.cpuLoadAvg / m.cpuCores) * 100), 100) : null;
  const ramPct = m?.memoryTotalMb && m?.memoryUsedMb ? Math.round((m.memoryUsedMb / m.memoryTotalMb) * 100) : null;
  const diskPct = m?.diskTotalGb && m?.diskUsedGb ? Math.round((m.diskUsedGb / m.diskTotalGb) * 100) : null;
  const currentTps = eps.reduce((a, e) => a + (e.promptThroughputTps || 0) + (e.genThroughputTps || 0), 0);
  // 서버별 핵심 지표 (벤치마크 기반)
  const ca = (entry as any).capacityAnalysis;
  const serverComposite = ca?.compositeCapacity ?? null;
  const serverHeadroom = serverComposite != null ? Math.round((100 - serverComposite) * 10) / 10 : null;

  const loadHist = useCallback(async () => { try { const r = await gpuServerApi.history(s.id, hrs); setHist(r.data); } catch {} }, [s.id, hrs]);
  // 영업시간 평균은 항상 로드 (컴팩트 뷰에 표시), 차트 데이터는 open 시
  useEffect(() => { if (!hist) loadHist(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) {
      loadHist();
      if (!coach) gpuServerApi.coaching(s.id).then(r => setCoach(r.data.coaching)).catch(() => {});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cd = hist?.snapshots?.map((snap: any) => {
    const gs = snap.gpuMetrics as GpuInfo[]; const ps = (snap.gpuProcesses || []) as GpuProcess[]; const ls = (snap.llmMetrics || []) as LlmEndpoint[];
    const au = gs.length > 0 ? gs.reduce((a: number, g: any) => a + g.utilGpu, 0) / gs.length : 0;
    const tm = gs.reduce((a: number, g: any) => a + g.memTotalMb, 0); const um = gs.reduce((a: number, g: any) => a + g.memUsedMb, 0);
    const lm = ps.filter((p: any) => p.isLlm).reduce((a: number, p: any) => a + p.memMb, 0);
    const kvs = ls.filter((l: any) => l.kvCacheUsagePct != null); const kv = kvs.length > 0 ? kvs.reduce((a: number, l: any) => a + l.kvCacheUsagePct, 0) / kvs.length : null;
    const tp = ls.reduce((a: number, l: any) => a + (l.promptThroughputTps || 0) + (l.genThroughputTps || 0), 0);
    const t = new Date(snap.timestamp);
    const effUtil = kv != null ? kv : (tm > 0 ? (um / tm) * 100 : au);
    // LLM별 throughput + KV (최대 5개)
    const perLlm: Record<string, number> = {};
    const perLlmKv: Record<string, number> = {};
    ls.slice(0, 5).forEach((l: any, i: number) => {
      const label = l.modelNames?.[0] || l.containerName || `LLM${i}`;
      const short = label.length > 20 ? label.slice(-20) : label;
      const ltps = (l.promptThroughputTps || 0) + (l.genThroughputTps || 0);
      perLlm[short] = Math.round(ltps * 10) / 10;
      if (l.kvCacheUsagePct != null) perLlmKv[`${short}_kv`] = Math.round(l.kvCacheUsagePct * 10) / 10;
      if (l.ttftMs != null) perLlm[`${short}_ttft`] = Math.round(l.ttftMs);
    });
    // 서비스 품질 합산
    const avgTtft = ls.filter((l: any) => l.ttftMs != null);
    const ttft = avgTtft.length > 0 ? Math.round(avgTtft.reduce((a: number, l: any) => a + l.ttftMs, 0) / avgTtft.length) : null;
    const totalPreempt = ls.reduce((a: number, l: any) => a + (l.preemptionCount || 0), 0);
    return { time: t.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), fullTime: t.toLocaleString('ko-KR'), gpuUtil: Math.round(au * 10) / 10, memPct: tm > 0 ? Math.round((um / tm) * 1000) / 10 : 0, llmPct: tm > 0 ? Math.round((lm / tm) * 1000) / 10 : 0, kvCache: kv ? Math.round(kv * 10) / 10 : null, throughput: tp > 0 ? Math.round(tp * 10) / 10 : null, effUtil: Math.round(effUtil * 10) / 10, ttft, preempt: totalPreempt > 0 ? totalPreempt : null, cpuLoad: snap.cpuLoadAvg, ramPct: snap.memoryTotalMb > 0 ? Math.round((snap.memoryUsedMb / snap.memoryTotalMb) * 1000) / 10 : 0, ...perLlm, ...perLlmKv };
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
          {/* ── 1) 벤치마크 기반 4개 게이지 ── */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-1.5">
            <div className="flex items-center gap-1.5 text-[10px]" title={`종합 용량 = max(처리량 ${ca?.tokPct ?? '-'}%, KV ${ca?.kvPct ?? '-'}%, 동시 ${ca?.concPct ?? '-'}%)\n병목: ${ca?.bottleneck === 'throughput' ? '처리량' : ca?.bottleneck === 'kvMemory' ? 'KV메모리' : ca?.bottleneck === 'concurrency' ? '동시처리' : '-'}`}>
              <span className="text-gray-500 w-10 shrink-0">종합</span>
              <div className="flex-1"><MiniBar pct={serverComposite || 0} color={utilCls(serverComposite || 0)} h="h-2" /></div>
              <b className={`w-7 text-right ${serverComposite != null ? utilTxt(serverComposite) : 'text-gray-300'}`}>{serverComposite != null ? Math.round(serverComposite) : '-'}%</b>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]" title="처리량 = 현재 tok/s ÷ 벤치마크 피크 tok/s">
              <span className="text-gray-500 w-10 shrink-0">처리량</span>
              <div className="flex-1"><MiniBar pct={ca?.tokPct || 0} color="bg-blue-400" h="h-2" /></div>
              <b className={`w-7 text-right ${ca?.tokPct != null ? utilTxt(ca.tokPct) : 'text-gray-300'}`}>{ca?.tokPct ?? '-'}%</b>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]" title="KV 메모리 = 현재 KV Cache 사용률 (80%+ 위험)">
              <span className="text-gray-500 w-10 shrink-0">KV</span>
              <div className="flex-1"><MiniBar pct={ca?.kvPct || 0} color="bg-purple-400" h="h-2" /></div>
              <b className={`w-7 text-right ${ca?.kvPct != null && ca.kvPct >= 80 ? 'text-red-600' : ca?.kvPct != null && ca.kvPct >= 50 ? 'text-amber-600' : 'text-gray-700'}`}>{ca?.kvPct ?? '-'}%</b>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]" title="여유 = 100% - 종합 용량">
              <span className="text-gray-500 w-10 shrink-0">여유</span>
              <div className="flex-1"><MiniBar pct={serverHeadroom || 0} color={serverHeadroom != null && serverHeadroom <= 20 ? 'bg-red-400' : 'bg-emerald-400'} h="h-2" /></div>
              <b className={`w-7 text-right ${serverHeadroom != null ? (serverHeadroom <= 20 ? 'text-red-600' : 'text-emerald-600') : 'text-gray-300'}`}>{serverHeadroom ?? '-'}%</b>
            </div>
          </div>

          {/* ── 2) 3대 지표: tok/s + KV% + 대기건수 ── */}
          <div className="flex items-center gap-2 mb-1.5 text-[10px] flex-wrap">
            <span className="text-blue-600 font-semibold">{currentTps > 0 ? currentTps.toFixed(1) : '-'} <span className="font-normal">tok/s</span></span>
            {kvPct != null && <span className="text-gray-400">KV <b className={kvPct >= 80 ? 'text-red-600' : kvPct >= 50 ? 'text-amber-600' : 'text-emerald-600'}>{kvPct.toFixed(0)}%</b></span>}
            {(() => { const w = eps.reduce((a, e) => a + (e.waitingRequests || 0), 0); return w > 0 ? <span className="text-red-500 font-semibold">대기 {w}건</span> : <span className="text-emerald-500">대기 0</span>; })()}
            {ca?.benchmark && <span className="text-gray-300 text-[8px]">벤치마크 {ca.benchmark.peakTps} tok/s</span>}
            {!ca && !kvPct && <span className="text-gray-300">데이터 수집 중</span>}
          </div>

          {/* ── 3) 영업시간 평균 ── */}
          <div className="mb-1.5 p-1.5 bg-blue-50/50 rounded border border-blue-100/50">
            <p className="text-[8px] text-blue-500 mb-1">KST 9-18시 영업일 기준 (주말·등록 휴일 제외) | 최근 24h 영업시간 평균</p>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="text-[9px]"><span className="text-blue-600 font-medium">GPU 사용률</span><div className="flex items-center gap-1"><MiniBar pct={hist?.businessHoursAvg?.avgGpuUtil || 0} color={utilCls(hist?.businessHoursAvg?.avgGpuUtil || 0)} h="h-1.5" /><b className={utilTxt(hist?.businessHoursAvg?.avgGpuUtil || 0)}>{hist?.businessHoursAvg?.avgGpuUtil ?? '-'}%</b></div></div>
              <div className="text-[9px]"><span className="text-blue-600 font-medium">VRAM 사용률</span><div className="flex items-center gap-1"><MiniBar pct={hist?.businessHoursAvg?.avgMemUtil || 0} color="bg-indigo-400" h="h-1.5" /><b>{hist?.businessHoursAvg?.avgMemUtil ?? '-'}%</b></div></div>
              <div className="text-[9px]"><span className="text-blue-600 font-medium">종합용량</span><div className="flex items-center gap-1"><MiniBar pct={ca?.compositeCapacity || 0} color={utilCls(ca?.compositeCapacity || 0)} h="h-1.5" /><b className={utilTxt(ca?.compositeCapacity || 0)}>{ca?.compositeCapacity != null ? Math.round(ca.compositeCapacity) : '-'}%</b></div></div>
            </div>
          </div>

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
                <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${llmBadge(ep.type)} cursor-help`}
                  title={[
                    `TTFT: 첫 토큰까지 시간 (${ep.ttftMs != null ? Math.round(ep.ttftMs) + 'ms' : '-'})`,
                    `TPOT: 토큰 간 지연 (${ep.tpotMs != null ? Math.round(ep.tpotMs) + 'ms' : '-'})`,
                    `E2E: 전체 요청 시간 (${ep.e2eLatencyMs != null ? Math.round(ep.e2eLatencyMs) + 'ms' : '-'})`,
                    `Cache Hit: 프롬프트 캐시 적중률 (${ep.prefixCacheHitRate != null ? (ep.prefixCacheHitRate * 100).toFixed(1) + '%' : '-'})`,
                    `Preemption: VRAM 부족으로 밀려난 요청 (${ep.preemptionCount ?? 0}회)`,
                    `Queue: 대기열 체류 시간 (${ep.queueTimeMs != null ? Math.round(ep.queueTimeMs) + 'ms' : '-'})`,
                  ].join('\n')}>
                  {(() => {
                    const overloaded = (ep.kvCacheUsagePct != null && ep.kvCacheUsagePct > 80) || (ep.waitingRequests || 0) > 0 || (ep.preemptionCount || 0) > 0;
                    return overloaded ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" title="과부하: KV>80% 또는 대기큐>0 또는 Preemption>0" /> : null;
                  })()}
                  <span className="uppercase">{ep.type}</span>
                  {ep.modelNames?.[0] && <span className="opacity-75 truncate max-w-[100px]">{ep.modelNames[0]}</span>}
                  {ep.kvCacheUsagePct != null && <span>KV:{ep.kvCacheUsagePct.toFixed(0)}%</span>}
                  {(ep.runningRequests || 0) > 0 && <span>R:{ep.runningRequests}</span>}
                  {(ep.waitingRequests || 0) > 0 && <span className="text-amber-700">W:{ep.waitingRequests}</span>}
                  {ep.ttftMs != null && <span className="text-gray-500">TTFT:{ep.ttftMs < 1000 ? Math.round(ep.ttftMs) + 'ms' : (ep.ttftMs / 1000).toFixed(1) + 's'}</span>}
                  {ep.prefixCacheHitRate != null && <span className="text-gray-500">C:{(ep.prefixCacheHitRate * 100).toFixed(0)}%</span>}
                  {(ep.preemptionCount || 0) > 0 && <span className="text-red-600">P:{ep.preemptionCount}</span>}
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
              <p className="text-[10px] font-medium text-gray-500 mb-1.5">벤치마크 대비 {ca?.benchmark?.source === 'manual' ? '(수동)' : '(자동 P95)'}</p>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5"><span className="text-[9px] text-gray-400 w-14 text-right">처리량</span><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(ca?.tokPct || 0, 100)}%` }} /></div><span className="text-[9px] w-14 text-right text-blue-600">{ca?.tokPct ?? '-'}%</span></div>
                <div className="flex items-center gap-1.5"><span className="text-[9px] text-gray-400 w-14 text-right">KV메모리</span><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.min(ca?.kvPct || 0, 100)}%` }} /></div><span className={`text-[9px] w-14 text-right ${(ca?.kvPct || 0) >= 80 ? 'text-red-600' : 'text-purple-600'}`}>{ca?.kvPct ?? '-'}%</span></div>
                <div className="flex items-center gap-1.5"><span className="text-[9px] text-gray-400 w-14 text-right">동시처리</span><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(ca?.concPct || 0, 100)}%` }} /></div><span className={`text-[9px] w-14 text-right ${(ca?.concPct || 0) >= 100 ? 'text-red-600' : 'text-amber-600'}`}>{ca?.concPct ?? '-'}%</span></div>
              </div>
              <div className="flex gap-4 mt-1.5 text-[9px]">
                <span className="text-gray-500">현재: <b className="text-blue-600">{(ca?.currentTps || 0).toFixed(1)} tok/s</b></span>
                <span className="text-gray-500">벤치마크: <b>{ca?.benchmark?.peakTps ?? '-'} tok/s</b></span>
                {ca?.bottleneck && <span className="text-orange-600 font-semibold">병목: {ca.bottleneck === 'throughput' ? '처리량' : ca.bottleneck === 'kvMemory' ? 'KV메모리' : '동시처리'}</span>}
              </div>
            </div>
          )}

          {/* 히스토리 차트 */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-medium text-gray-500">사용률 추이</span><div className="flex gap-0.5">{[6, 12, 24, 72].map(h => <button key={h} onClick={() => setHrs(h)} className={`px-1.5 py-0.5 text-[9px] rounded ${hrs === h ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{h}h</button>)}</div></div>
            {hist?.businessHoursAvg && <div className="flex items-center gap-2 mb-2 p-1.5 bg-blue-50 rounded text-[9px] text-blue-700"><Clock className="w-3 h-3" /><span>KST 9-18시 영업일 평균 (주말·등록 휴일 제외): GPU <b>{hist.businessHoursAvg.avgGpuUtil}%</b> VRAM <b>{hist.businessHoursAvg.avgMemUtil}%</b> ({hist.businessHoursAvg.sampleCount}건)</span></div>}
            <div className="space-y-3">
              {/* KV Cache + GPU 사용률 */}
              <div><p className="text-[9px] text-gray-400 mb-0.5">KV Cache / GPU 사용률 (%)</p>
              <ResponsiveContainer width="100%" height={140}><AreaChart data={dd}><defs><linearGradient id="gG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} /><Tooltip content={<Tip />} /><Area type="monotone" dataKey="kvCache" name="KV Cache" stroke="#8b5cf6" fill="url(#gG)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="gpuUtil" name="GPU" stroke="#94a3b8" strokeWidth={1} dot={false} /></AreaChart></ResponsiveContainer></div>
              {/* tok/s 처리량 (합산 + LLM별) */}
              {(() => {
                const llmColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];
                const reserved = new Set(['time','fullTime','gpuUtil','memPct','llmPct','kvCache','throughput','effUtil','cpuLoad','ramPct','ttft','preempt']);
                const allKeys = new Set<string>(); dd.forEach((d: any) => Object.keys(d).forEach(k => allKeys.add(k)));
                const llmKeys = [...allKeys].filter(k => !reserved.has(k) && !k.endsWith('_kv') && !k.endsWith('_ttft'));
                const kvKeys = [...allKeys].filter(k => k.endsWith('_kv'));
                return (<>
                  <div><p className="text-[9px] text-gray-400 mb-0.5">처리량 (tok/s){llmKeys.length > 1 && <span className="ml-1 text-blue-500">— LLM별 분리</span>}</p>
                  <ResponsiveContainer width="100%" height={llmKeys.length > 1 ? 130 : 100}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} />
                    {llmKeys.length > 1 && <Line type="monotone" dataKey="throughput" name="합산" stroke="#94a3b8" strokeWidth={1} dot={false} strokeDasharray="4 2" />}
                    {llmKeys.length > 0 ? llmKeys.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={k} stroke={llmColors[i % llmColors.length]} strokeWidth={2} dot={false} />) : <Line type="monotone" dataKey="throughput" name="tok/s" stroke="#3b82f6" strokeWidth={2} dot={false} />}
                  </LineChart></ResponsiveContainer></div>
                  {/* LLM별 KV Cache */}
                  {kvKeys.length >= 1 && (
                    <div><p className="text-[9px] text-gray-400 mb-0.5">KV Cache (%) — LLM별</p>
                    <ResponsiveContainer width="100%" height={80}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} />
                      {kvKeys.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={k.replace('_kv', '')} stroke={llmColors[i % llmColors.length]} strokeWidth={1.5} dot={false} />)}
                    </LineChart></ResponsiveContainer></div>
                  )}
                </>);
              })()}
              {/* CPU / RAM / VRAM */}
              <div><p className="text-[9px] text-gray-400 mb-0.5">시스템 리소스 (%)</p>
              <ResponsiveContainer width="100%" height={80}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} /><Line type="monotone" dataKey="ramPct" name="RAM" stroke="#ec4899" strokeWidth={1} dot={false} /><Line type="monotone" dataKey="memPct" name="VRAM" stroke="#f59e0b" strokeWidth={1} dot={false} /></LineChart></ResponsiveContainer></div>
              {/* TTFT + Preemption (서비스 품질) */}
              {(() => {
                const ttftKeys = [...new Set<string>()]; dd.forEach((d: any) => Object.keys(d).filter(k => k.endsWith('_ttft')).forEach(k => { if (!ttftKeys.includes(k)) ttftKeys.push(k); }));
                const clr = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];
                return (<>
                  <div><p className="text-[9px] text-gray-400 mb-0.5">TTFT — 첫 토큰까지 시간 (ms) {ttftKeys.length > 0 ? '· LLM별' : ''}</p>
                  <ResponsiveContainer width="100%" height={80}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} />
                    {ttftKeys.length > 0 ? ttftKeys.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={k.replace('_ttft', '')} stroke={clr[i % clr.length]} strokeWidth={1.5} dot={false} />) : <Line type="monotone" dataKey="ttft" name="TTFT" stroke="#f59e0b" strokeWidth={1.5} dot={false} />}
                  </LineChart></ResponsiveContainer></div>
                  <div><p className="text-[9px] text-gray-400 mb-0.5">Preemption — VRAM 부족 밀려남 (횟수, 증가 시 증설 시그널)</p>
                  <ResponsiveContainer width="100%" height={60}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} /><Line type="monotone" dataKey="preempt" name="Preemption" stroke="#ef4444" strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer></div>
                </>);
              })()}
            </div>
          </div>

          {/* AI 코칭 */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <button onClick={async () => { setCoachL(true); try { const r = await gpuServerApi.coaching(s.id); setCoach(r.data.coaching); } catch { setCoach(null); } finally { setCoachL(false); } }} className="text-[9px] text-indigo-500 hover:text-indigo-700 underline">{coachL ? '로딩...' : 'AI 코칭 보기'}</button>
              <button onClick={async () => { setCoachL(true); try { const r = await gpuServerApi.runCoaching(s.id); setCoach(r.data.coaching); } catch (e: any) { alert(e?.response?.data?.error || '실패'); } finally { setCoachL(false); } }} className="text-[9px] text-purple-500 hover:text-purple-700 underline">{coachL ? '분석 중...' : '지금 분석'}</button>
            </div>
            {coach && (
              <div className="mt-1.5 p-2 bg-indigo-50 rounded-lg text-[9px] space-y-1">
                <p className="text-[8px] text-indigo-400">{coach.timestamp ? new Date(coach.timestamp).toLocaleString('ko-KR') : ''}</p>
                {coach.paramCheck && <p><b className="text-indigo-600">파라미터 검증:</b> {coach.paramCheck}</p>}
                {coach.precisionAdvice && <p><b className="text-indigo-600">정밀도 최적화:</b> {coach.precisionAdvice}</p>}
                {coach.batchAdvice && <p><b className="text-indigo-600">배치 최적화:</b> {coach.batchAdvice}</p>}
                {coach.qualityIssues && <p><b className="text-indigo-600">품질 이슈:</b> {coach.qualityIssues}</p>}
                {coach.topRecommendations?.length > 0 && (
                  <div className="mt-1 p-1.5 bg-white rounded border border-indigo-200">
                    <b className="text-indigo-700">권고:</b>
                    <ul className="list-disc ml-3 mt-0.5">{coach.topRecommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
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
  const [anaDays] = useState(30);
  const [pred, setPred] = useState<any>(null);
  const [predRunning, setPredRunning] = useState(false);
  const [targetEdit, setTargetEdit] = useState(false);
  const [targetVal, setTargetVal] = useState('');
  const [targetSaving, setTargetSaving] = useState(false);
  const [fleetEdit, setFleetEdit] = useState(false);
  const [fleetList, setFleetList] = useState<Array<{ type: string; count: number; label: string; vramGb: number }>>([]);
  const [fleetSaving, setFleetSaving] = useState(false);
  const [noticeEdit, setNoticeEdit] = useState(false);
  const [noticeText, setNoticeText] = useState('');
  const ref = useRef<ReturnType<typeof setInterval>>();

  const fetch_ = useCallback(async () => { try { const [r, p, s] = await Promise.all([gpuServerApi.realtime(), gpuCapacityApi.latest(), gpuCapacityApi.getSettings()]); setData(r.data.data || []); setPred(p.data.prediction); if (s.data.notice && !noticeText) setNoticeText(s.data.notice); setUpdated(new Date()); } catch {} finally { setLoading(false); } }, []);
  const fetchAna = useCallback(async () => { try { const r = await gpuServerApi.analytics(anaDays); setAna(r.data); } catch {} }, [anaDays]);
  useEffect(() => { fetch_(); fetchAna(); ref.current = setInterval(fetch_, 10000); return () => { if (ref.current) clearInterval(ref.current); }; }, [fetch_]);
  useEffect(() => { fetchAna(); }, [fetchAna]);

  // ── 종합 KPI (벤치마크 기반) ──
  const totGpu = data.reduce((a, e) => a + (e.metrics?.gpus?.length || 0), 0);
  const online = data.filter(e => e.metrics && !e.metrics.error).length;
  const totLlm = data.reduce((a, e) => a + (e.metrics?.llmEndpoints?.length || 0), 0);
  const totTps = data.reduce((a, e) => a + ((e.capacityAnalysis || e.throughputAnalysis)?.currentTps || 0), 0);

  // 종합 용량 % = max(처리량%, KV%, 동시성%) — 벤치마크 대비
  const avgComposite = (() => { const h = data.filter(e => e.capacityAnalysis?.compositeCapacity != null).map(e => e.capacityAnalysis!.compositeCapacity!); return h.length > 0 ? Math.round(h.reduce((a, v) => a + v, 0) / h.length * 10) / 10 : null; })();
  const avgTokPct = (() => { const h = data.filter(e => e.capacityAnalysis?.tokPct != null).map(e => e.capacityAnalysis!.tokPct!); return h.length > 0 ? Math.round(h.reduce((a, v) => a + v, 0) / h.length * 10) / 10 : null; })();
  const avgKvPct = (() => { const h = data.filter(e => e.capacityAnalysis?.kvPct != null).map(e => e.capacityAnalysis!.kvPct!); return h.length > 0 ? Math.round(h.reduce((a, v) => a + v, 0) / h.length * 10) / 10 : null; })();
  const avgConcPct = (() => { const h = data.filter(e => e.capacityAnalysis?.concPct != null).map(e => e.capacityAnalysis!.concPct!); return h.length > 0 ? Math.round(h.reduce((a, v) => a + v, 0) / h.length * 10) / 10 : null; })();
  const headroom = avgComposite != null ? Math.round((100 - avgComposite) * 10) / 10 : null;
  // 전체 병목 (가장 빈번한 병목 차원)
  const fleetBottleneck = (() => {
    const bots = data.filter(e => e.capacityAnalysis?.bottleneck).map(e => e.capacityAnalysis!.bottleneck!);
    if (bots.length === 0) return null;
    const counts = { throughput: 0, kvMemory: 0, concurrency: 0 };
    bots.forEach(b => counts[b]++);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as 'throughput' | 'kvMemory' | 'concurrency';
  })();
  const bottleneckLabel = (b: string | null) => ({ throughput: '처리량', kvMemory: 'KV메모리', concurrency: '동시처리' }[b || ''] || '-');
  // 시스템 리소스
  const avgCpu = (() => { let s = 0, c = 0; data.forEach(e => { if (e.metrics?.cpuLoadAvg && e.metrics.cpuCores) { s += (e.metrics.cpuLoadAvg / e.metrics.cpuCores) * 100; c++; } }); return c > 0 ? Math.round(s / c) : null; })();
  const avgRam = (() => { let s = 0, c = 0; data.forEach(e => { if (e.metrics?.memoryTotalMb && e.metrics.memoryUsedMb) { s += (e.metrics.memoryUsedMb / e.metrics.memoryTotalMb) * 100; c++; } }); return c > 0 ? Math.round(s / c) : null; })();
  const avgDisk = (() => { let s = 0, c = 0; data.forEach(e => { if (e.metrics?.diskTotalGb && e.metrics.diskUsedGb) { s += (e.metrics.diskUsedGb / e.metrics.diskTotalGb) * 100; c++; } }); return c > 0 ? Math.round(s / c) : null; })();

  const handleTest = async (d: any) => { setTesting(true); setTestR(null); try { setTestR((await gpuServerApi.test(d)).data); } catch (e: any) { setTestR({ success: false, message: e?.response?.data?.error || e.message }); } finally { setTesting(false); } };
  const handleSubmit = async (f: any) => {
    try {
      const payload = { ...f };
      if (!payload.sshPassword) delete payload.sshPassword;
      if (payload.description === '') payload.description = null;
      if (edit && edit.id) {
        await gpuServerApi.update(edit.id, payload);
      } else {
        await gpuServerApi.create(payload);
      }
      setModal(false); setEdit(null); setTestR(null); fetch_();
    } catch (e: any) {
      alert(e?.response?.data?.error || '저장 실패');
    }
  };

  if (loading) return <LoadingSpinner />;

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
    {pred && (() => {
      const cd = pred.calculationDetails || {};
      const peakShort = cd.currentPeakShortage || {};
      return (
      <div className="bg-gradient-to-r from-indigo-50 via-blue-50 to-purple-50 rounded-lg border border-indigo-200 p-4 shadow-sm">
        {/* 헤더: 목표 인원 수정 가능 */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center"><BarChart3 className="w-4 h-4 text-indigo-600" /></div>
            <div>
              <p className="text-xs font-bold text-gray-900">GPU 수요 예측</p>
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <span>{new Date(pred.date).toLocaleDateString('ko-KR')} 기준</span>
                <span>|</span>
                {targetEdit ? (
                  <span className="flex items-center gap-1">
                    <span>목표</span>
                    <input type="number" min={100} max={500000} value={targetVal} onChange={e => setTargetVal(e.target.value)} className="w-20 px-1 py-0.5 border rounded text-[10px] text-center" />
                    <span>명</span>
                    <button disabled={targetSaving} onClick={async () => {
                      const n = parseInt(targetVal);
                      if (isNaN(n) || n < 100 || n > 500000) { alert('100 ~ 500,000 범위'); return; }
                      setTargetSaving(true);
                      try { await gpuCapacityApi.updateSettings({ targetUserCount: n }); setTargetEdit(false); setPredRunning(true); const r = await gpuCapacityApi.run(); setPred(r.data.prediction); } catch (e: any) { alert(e?.response?.data?.error || '실패'); } finally { setTargetSaving(false); setPredRunning(false); }
                    }} className="px-1.5 py-0.5 bg-indigo-600 text-white rounded text-[9px] hover:bg-indigo-700 disabled:opacity-50">{targetSaving ? '저장+분석...' : '저장 후 재분석'}</button>
                    <button onClick={() => setTargetEdit(false)} className="text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
                  </span>
                ) : (
                  <button onClick={() => { setTargetVal(String(pred.targetUserCount || 15000)); setTargetEdit(true); }} className="text-indigo-600 hover:text-indigo-800 underline decoration-dotted">목표 {pred.targetUserCount?.toLocaleString()}명 ✏️</button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${pred.aiConfidence === 'HIGH' ? 'bg-emerald-100 text-emerald-700' : pred.aiConfidence === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{pred.aiConfidence}</span>
            <button onClick={async () => {
              setPredRunning(true);
              try {
                const r = await gpuCapacityApi.run();
                setPred(r.data.prediction);
              } catch (e: any) {
                // timeout이어도 서버에서 분석 진행 중일 수 있음 → 폴링으로 결과 확인
                if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
                  alert('분석이 진행 중입니다. 완료되면 자동으로 업데이트됩니다.');
                } else {
                  alert(e?.response?.data?.error || '실패');
                }
              } finally { setPredRunning(false); }
            }} disabled={predRunning} className="text-[10px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50">{predRunning ? '분석 중... (완료 시 자동 반영)' : '재실행'}</button>
          </div>
        </div>

        {/* 추정 조건 공지 (편집 가능) */}
        {(() => {
          const defaultNotice = `1. vLLM metric의 실시간 값을 현재 가져올 수 없어, **과거 약 10일치 데이터**를 기반으로 추정된 상태입니다. (DTGPT 측에서 vLLM 로깅 활성화 시 서빙 안정성 이슈가 발생하여 비활성화한 상태입니다)
2. HPC망 내의 GPU는 **보안상 직접 접근이 어려워**, 연결된 장비의 평균 사용률을 가정하여 추정에 포함하였습니다.
3. 관련 상세 이력은 [DTGPT-122](https://jira.samsungds.net/browse/DTGPT-122)에서 확인하실 수 있습니다.`;
          const activeNotice = noticeText || defaultNotice;
          return (
          <div className="mb-3 p-3 bg-amber-50 rounded-lg border-2 border-amber-300 text-[11px] text-amber-900 shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
              <p className="font-bold text-amber-800 text-xs flex items-center gap-1">⚠ 추정 조건 안내</p>
              <button onClick={() => { if (!noticeEdit && !noticeText) setNoticeText(defaultNotice); setNoticeEdit(!noticeEdit); }} className="text-[9px] text-amber-600 hover:text-amber-800 underline">{noticeEdit ? '닫기' : '편집'}</button>
            </div>
            {noticeEdit ? (
              <div className="space-y-1">
                <textarea value={noticeText} onChange={e => setNoticeText(e.target.value)} rows={5} className="w-full px-2 py-1 border rounded text-[10px] font-mono" placeholder="마크다운 형식으로 작성 (**굵게**, [링크](url))" />
                <div className="flex gap-2">
                  <button onClick={async () => {
                    try {
                      await gpuCapacityApi.updateSettings({ notice: noticeText } as any);
                      setNoticeEdit(false);
                      fetch_();
                    } catch { alert('저장 실패'); }
                  }} className="px-2 py-0.5 bg-amber-600 text-white rounded text-[9px]">저장</button>
                  <button onClick={() => { setNoticeText(defaultNotice); }} className="px-2 py-0.5 bg-gray-200 rounded text-[9px]">기본값 복원</button>
                </div>
              </div>
            ) : (
              <div className="space-y-0.5 [&_a]:text-blue-600 [&_a]:underline" dangerouslySetInnerHTML={{ __html: mdToHtml(activeNotice) }} />
            )}
          </div>
          );
        })()}

        {/* 2-tier: 현재 피크 기준 부족분 + 목표 인원 기준 부족분 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          {/* 현재 피크 기준 */}
          <div className={`bg-white/80 rounded-lg p-3 border ${peakShort.isShort ? 'border-red-200' : 'border-gray-200'}`}>
            <p className="text-[10px] font-bold text-orange-700 mb-2">📊 현재 피크 기준 부족분 <span className="font-normal text-gray-400">(7일 영업시간)</span></p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="cursor-help" title={"KV Cache = AI 모델이 대화 내용을 기억하기 위해 사용하는 메모리입니다.\n\n80% 이상이면 메모리 부족으로 응답이 느려지거나 요청이 밀려날 수 있습니다.\n즉, 사용자가 체감하는 응답 속도가 저하됩니다."}><p className="text-[9px] text-gray-500">피크 KV Cache ⓘ</p><p className={`text-lg font-bold ${peakShort.peakKvMax >= 80 ? 'text-red-600' : peakShort.peakKvMax >= 60 ? 'text-amber-600' : 'text-emerald-600'}`}>{peakShort.peakKvMax ?? '-'}%</p></div>
              <div className="cursor-help" title={"대기 요청 = GPU가 바빠서 처리를 기다리는 요청의 비율입니다.\n\n30% 이상이면 사용자들이 응답 대기 시간이 길어지는 것을 체감합니다.\nGPU 증설이 필요한 직접적인 시그널입니다."}><p className="text-[9px] text-gray-500">대기 요청 빈도 ⓘ</p><p className={`text-lg font-bold ${peakShort.waitingFrequencyPct >= 30 ? 'text-red-600' : 'text-emerald-600'}`}>{peakShort.waitingFrequencyPct ?? 0}%</p></div>
              <div className="cursor-help" title={"VRAM = GPU의 작업 메모리입니다.\n\n이 수치가 0보다 크면 현재 GPU 메모리가 부족하여\n피크 시간대에 서비스 품질이 저하될 수 있습니다."}><p className="text-[9px] text-gray-500">피크 부족 VRAM ⓘ</p><p className={`text-lg font-bold ${peakShort.gapVram > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{peakShort.gapVram > 0 ? `+${peakShort.gapVram}` : '0'}<span className="text-[9px] font-normal text-gray-400 ml-0.5">GB</span></p></div>
              <div className="cursor-help" title={"B300 = NVIDIA의 최신 GPU 장비 (192GB 메모리)입니다.\n\n현재 피크 부하에서 서비스 품질을 유지하기 위해\n당장 추가해야 하는 GPU 장비 수입니다."}><p className="text-[9px] text-gray-500">즉시 필요 ⓘ</p><p className={`text-xl font-black ${peakShort.b300Units > 0 ? 'text-red-700' : 'text-emerald-600'}`}>{peakShort.b300Units || 0}<span className="text-xs font-normal text-gray-500 ml-0.5">B300</span></p></div>
            </div>
            {peakShort.isShort && peakShort.reasons?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {peakShort.reasons.map((r: string, i: number) => <span key={i} className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[9px] font-semibold cursor-help" title={r.includes('KV cache') ? 'KV Cache가 80% 이상이면 메모리 부족으로 새 요청이 밀려나거나 응답이 느려집니다.\n즉시 GPU 증설을 검토하세요.' : r.includes('대기 요청') ? '전체 모니터링 중 30% 이상에서 대기 요청이 발생하고 있습니다.\n사용자들이 응답 대기를 체감하고 있을 가능성이 높습니다.' : r.includes('Preemption') ? 'Preemption = 처리 중이던 요청이 밀려나는 현상입니다.\n빈발하면 응답 실패나 지연이 발생합니다.' : r}>⚠ {r}</span>)}
              </div>
            )}
            {!peakShort.isShort && <p className="text-[9px] text-emerald-600 mt-1">✅ 현재 피크에서는 여유 있음</p>}
          </div>
          {/* 목표 인원 기준 */}
          <div className="bg-white/80 rounded-lg p-3 border border-indigo-200">
            <p className="text-[10px] font-bold text-indigo-700 mb-2">🎯 목표 {pred.targetUserCount?.toLocaleString()}명 기준 부족분</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="cursor-help" title={"현재 보유한 전체 GPU 메모리 용량입니다.\n모든 서버의 GPU VRAM을 합산한 값입니다."}><p className="text-[9px] text-gray-500">현재 VRAM ⓘ</p><p className="text-lg font-bold text-gray-900">{Math.round(pred.currentTotalVramGb)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">GB</span></p></div>
              <div className="cursor-help" title={"목표 사용자 수를 서비스하기 위해 필요한\n총 GPU 메모리 용량입니다.\n안전 마진(1.5배)이 포함되어 있습니다."}><p className="text-[9px] text-gray-500">필요 VRAM ⓘ</p><p className="text-lg font-bold text-indigo-700">{Math.round(pred.predictedTotalVramGb)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">GB</span></p><p className="text-[9px] text-gray-400">+{Math.round(pred.gapVramGb)}GB</p></div>
              <div className="cursor-help" title={"목표 사용자 수 달성을 위해 추가로 구매해야 하는\nB300 GPU 장비 수입니다.\n\n현재 인프라 + 이 수량 = 목표 서비스 가능"}><p className="text-[9px] text-gray-500">추가 필요 ⓘ</p><p className="text-xl font-black text-indigo-700">{pred.predictedB300Units}<span className="text-xs font-normal text-gray-500 ml-0.5">B300</span></p><p className="text-[9px] text-gray-400">(192GB/장)</p></div>
            </div>
          </div>
        </div>

        {/* 포화 시점 + 사용자 현황 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
          <div className="bg-white/60 rounded-lg p-2 border border-gray-100">
            <p className="text-[9px] text-gray-500">현재 사용자</p>
            <p className="text-lg font-bold text-gray-900">{pred.currentUsers?.toLocaleString()}<span className="text-[9px] text-gray-400 ml-0.5">명</span></p>
            <p className="text-[9px] text-gray-400">DAU {Math.round(pred.currentDau)}</p>
          </div>
          {cd.scaling?.weeksUntilSaturated != null && (
            <div className={`rounded-lg p-2 border cursor-help ${cd.scaling.weeksUntilSaturated === 0 ? 'bg-red-100 border-red-300' : 'bg-red-50 border-red-200'}`} title={"현재 성장 추세가 유지되면 GPU 용량이\n한계에 도달하는 예상 시점입니다.\n\n이 시점 전에 GPU 증설이 완료되어야\n서비스 장애를 방지할 수 있습니다."}>
              <p className="text-[9px] text-red-600 font-semibold">포화 예상 ⓘ</p>
              <p className="text-lg font-black text-red-700">{cd.scaling.weeksUntilSaturated === 0 ? '즉시' : `${cd.scaling.weeksUntilSaturated}주 후`}</p>
              <p className="text-[9px] text-red-500">{cd.scaling.weeksUntilSaturated === 0 ? '이미 포화 상태!' : '현재 성장률 유지 시'}</p>
            </div>
          )}
          <div className="bg-white/60 rounded-lg p-2 border border-gray-100 cursor-help" title={"현재 대비 목표까지 필요한 확장 배율입니다.\n\n사용자 수 증가 + 인당 토큰 소비 증가를\n모두 반영한 종합 배율입니다."}><p className="text-[9px] text-gray-500">스케일링 배율 ⓘ</p><p className="text-lg font-bold text-gray-900">x{cd.growth?.growthAdjustedScaling || cd.scaling?.scalingFactor || '-'}</p><p className="text-[9px] text-gray-400">6개월 성장 반영</p></div>
          {cd.dimensionalBreakdown && <div className="bg-white/60 rounded-lg p-2 border border-gray-100 cursor-help" title={`3차원 부족분:\n처리량: B300 ${cd.dimensionalBreakdown.throughput?.b300 ?? '-'}장\nKV메모리: B300 ${cd.dimensionalBreakdown.kvMemory?.b300 ?? '-'}장\n동시처리: B300 ${cd.dimensionalBreakdown.concurrency?.b300 ?? '-'}장`}><p className="text-[9px] text-gray-500">종합 용량 ⓘ</p><p className="text-lg font-bold text-blue-600">{cd.dimensionalBreakdown.bottleneck === 'throughput' ? '처리량' : cd.dimensionalBreakdown.bottleneck === 'kvMemory' ? 'KV메모리' : '동시처리'}<span className="text-xs font-normal text-gray-400 ml-1">병목</span></p></div>}
          {cd.dimensionalBreakdown?.bottleneck && <div className="bg-white/60 rounded-lg p-2 border border-gray-100 cursor-help" title={`병목 차원: 3개 차원 중 가장 부족한 리소스\n처리량 B300 ${cd.dimensionalBreakdown.throughput?.b300 ?? '-'}장\nKV메모리 B300 ${cd.dimensionalBreakdown.kvMemory?.b300 ?? '-'}장\n동시처리 B300 ${cd.dimensionalBreakdown.concurrency?.b300 ?? '-'}장`}><p className="text-[9px] text-gray-500">병목 ⓘ</p><p className="text-lg font-bold text-orange-600">{cd.dimensionalBreakdown.bottleneck === 'throughput' ? '처리량' : cd.dimensionalBreakdown.bottleneck === 'kvMemory' ? 'KV메모리' : '동시처리'}</p></div>}
        </div>

        {/* 배포 모델 분포 */}
        {cd.modelBreakdown?.length > 0 && (
          <div className="mb-2">
            <p className="text-[9px] font-bold text-gray-700 mb-1">배포 모델 (throughput 비율)</p>
            <div className="flex flex-wrap gap-1">
              {cd.modelBreakdown.map((m: any, i: number) => (
                <span key={i} className="px-2 py-1 bg-white/70 rounded-lg text-[9px] border border-gray-200" title={`params: ${m.params || '?'}B | 평균 ${m.avgTps} tok/s | 이론max ${m.theoreticalMaxTps} tok/s | 대역폭max ${m.bandwidthMaxTps || '?'} tok/s | GPU ${m.gpuCount}장`}>
                  <b>{m.name}</b> <span className="text-gray-500">{m.params ? `${m.params}B` : '?'} ({m.precision})</span> <span className="text-indigo-600 font-bold">{m.tpsRatio}%</span>
                  <span className="text-gray-400 ml-1">{m.avgTps} tok/s</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 성장률 + 에러율 */}
        {cd.growth && (
          <div className="flex flex-wrap gap-3 mb-2 text-[10px]">
            <span className="text-gray-500 cursor-help" title={"사용자 1인당 토큰 소비량의 주간 증가율입니다.\n\n이 값이 높으면 같은 사용자 수에도 GPU 부하가\n빠르게 증가하고 있다는 의미입니다.\nagentic AI, 코딩 도구 등이 확산되면 급증합니다."}>인당 토큰 성장: <b>{cd.growth.tokensPerUserGrowthRate}%</b>/주 ⓘ</span>
            <span className="text-gray-500 cursor-help" title={"인당 토큰 성장률을 6개월(26주)간 복리 적용한 배율입니다.\n\n예: 주 5% 성장 → 6개월 후 약 3.6배\n이 배율이 스케일링 계산에 직접 반영됩니다."}>6개월 토큰 성장 배율: <b>x{cd.growth.tokenGrowthMultiplier6mo || cd.growth.growthMultiplier6mo}</b> ⓘ</span>
            {cd.inputs?.errorRate > 0 && <span className="text-gray-500 cursor-help" title={"최근 7일간 전체 요청 중 에러(HTTP 400+)가 발생한 비율입니다.\n\n5% 이상이면 GPU 과부하 또는 서비스 문제의 신호입니다.\n에러율이 높을수록 예측에 안전 마진을 추가합니다."}>에러율: <b className={cd.inputs.errorRate > 5 ? 'text-red-600' : 'text-gray-700'}>{cd.inputs.errorRate}%</b> ⓘ</span>}
          </div>
        )}
        {/* 서비스별 Top */}
        {cd.topServices?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {cd.topServices.map((s: any, i: number) => (
              <span key={i} className="px-1.5 py-0.5 bg-white/60 rounded text-[9px] text-gray-600 border border-gray-200">{s.name}: {(s.tokens / 1000000).toFixed(1)}M tok</span>
            ))}
          </div>
        )}
        {/* 미연결 장비 (모니터링 불가, 추정에 포함) */}
        <div className="mb-2">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[9px] font-bold text-gray-700">미연결 장비 <span className="font-normal text-gray-400">(모니터링 불가, 평균 사용률로 추정에 포함)</span></p>
            <button onClick={async () => {
              if (!fleetEdit) {
                try { const r = await gpuCapacityApi.getSettings(); setFleetList(r.data.unmonitoredFleet || []); } catch {}
              }
              setFleetEdit(!fleetEdit);
            }} className="text-[9px] text-indigo-600 hover:text-indigo-800 underline decoration-dotted">{fleetEdit ? '닫기' : '편집'}</button>
          </div>
          {/* 현재 등록된 미연결 장비 표시 */}
          {cd.unmonitoredFleet?.length > 0 && !fleetEdit && (
            <div className="flex flex-wrap gap-1">
              {cd.unmonitoredFleet.map((f: any, i: number) => (
                <span key={i} className="px-2 py-1 bg-amber-50 rounded-lg text-[9px] border border-amber-200 cursor-help" title={`미연결 장비: 모니터링 데이터 없음\n연결된 장비의 평균 사용률로 가정하여 추정에 포함\nVRAM: ${f.totalVramGb || f.count * (f.vramGb || 80)}GB`}>
                  <b>{f.type}</b> ×{f.count} <span className="text-amber-600">({f.label || '미연결'})</span>
                </span>
              ))}
            </div>
          )}
          {fleetEdit && (
            <div className="p-2 bg-white/80 rounded-lg border border-gray-200 space-y-2">
              {fleetList.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <select value={f.type} onChange={e => { const nl = [...fleetList]; nl[i] = { ...f, type: e.target.value, vramGb: e.target.value === 'H200' ? 141 : e.target.value === 'H100' ? 80 : e.target.value === 'L40S' ? 48 : e.target.value === 'B300' ? 192 : f.vramGb }; setFleetList(nl); }} className="px-1.5 py-1 border rounded text-[10px]">
                    <option value="H200">H200 (141GB)</option>
                    <option value="H100">H100 (80GB)</option>
                    <option value="L40S">L40S (48GB)</option>
                    <option value="B300">B300 (192GB)</option>
                    <option value="A100">A100 (80GB)</option>
                  </select>
                  <input type="number" min={0} value={f.count} onChange={e => { const nl = [...fleetList]; nl[i] = { ...f, count: parseInt(e.target.value) || 0 }; setFleetList(nl); }} className="w-16 px-1.5 py-1 border rounded text-[10px] text-center" placeholder="수량" />
                  <span className="text-gray-400">장</span>
                  <input value={f.label} onChange={e => { const nl = [...fleetList]; nl[i] = { ...f, label: e.target.value }; setFleetList(nl); }} className="flex-1 px-1.5 py-1 border rounded text-[10px]" placeholder="라벨 (예: HPC망)" />
                  <button onClick={() => setFleetList(fleetList.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-xs">×</button>
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={() => setFleetList([...fleetList, { type: 'H200', count: 0, label: '', vramGb: 141 }])} className="px-2 py-1 text-[9px] bg-gray-100 rounded hover:bg-gray-200">+ 장비 추가</button>
                <button disabled={fleetSaving} onClick={async () => {
                  setFleetSaving(true);
                  try {
                    await gpuCapacityApi.updateSettings({ unmonitoredFleet: fleetList.filter(f => f.count > 0) });
                    setFleetEdit(false);
                    // 재분석
                    setPredRunning(true);
                    const r = await gpuCapacityApi.run();
                    setPred(r.data.prediction);
                  } catch (e: any) { alert(e?.response?.data?.error || '실패'); }
                  finally { setFleetSaving(false); setPredRunning(false); }
                }} className="px-2 py-1 text-[9px] bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">{fleetSaving ? '저장+재분석...' : '저장 후 재분석'}</button>
              </div>
            </div>
          )}
        </div>

        {/* 계산 논리 */}
        {cd && (
          <details className="text-[10px]">
            <summary className="cursor-pointer text-indigo-600 font-medium hover:text-indigo-800">계산 논리 보기</summary>
            <div className="mt-2 p-2 bg-white/70 rounded-lg space-y-1 text-gray-600">
              <p><b>1. 스케일링:</b> DAU 비율 {(cd.inputs?.dauRatio * 100).toFixed(1)}% → x{cd.scaling?.scalingFactor} × 인당 토큰 성장 x{cd.growth?.tokenGrowthMultiplier6mo || cd.growth?.growthMultiplier6mo} = <b>x{cd.growth?.growthAdjustedScaling}</b></p>
              <p className="text-[9px] text-gray-400 ml-2">DAU 증가는 target에 이미 포함. 인당 토큰 소비 증가만 추가 반영.</p>
              <p><b>2. Method A</b> (실측 피크 throughput 기반): <b>B300 {cd.methodA?.b300 ?? cd.methodA?.totalVramA}장</b></p>
              {cd.methodA?.detail && <p className="text-[9px] text-gray-400 ml-2">{cd.methodA.detail}</p>}
              <p><b>3. Method B</b> (VRAM 복제 기반): <b>B300 {cd.methodB?.b300 ?? '?'}장</b> {cd.methodB?.totalVramNeeded ? `(필요 ${cd.methodB.totalVramNeeded}GB)` : ''}</p>
              <p><b>4. 최종:</b> max(A,B) × 안전마진 {pred.safetyMargin} × 에러보정 {cd.scaling?.errorMargin} = <b>B300 {pred.predictedB300Units}장</b> ({Math.round(pred.predictedTotalVramGb)}GB)</p>
              {cd.inputs?.detectedModels?.length > 0 && <p><b>감지 모델:</b> {cd.inputs.detectedModels.join(', ')}</p>}
              {cd.modelBreakdown?.length > 0 && <div><b>모델별:</b><ul className="list-disc ml-4">{cd.modelBreakdown.map((m: any, i: number) => <li key={i}>{m.name}: {m.params || '?'}B ({m.precision}), throughput {m.tpsRatio}%, 이론max {m.theoreticalMaxTps} tok/s, GPU {m.gpuCount}장</li>)}</ul></div>}
              {cd.confidenceIssues?.length > 0 && <p className="text-amber-600"><b>주의:</b> {cd.confidenceIssues.join(', ')}</p>}
              {cd.recommendations?.length > 0 && <div className="mt-1"><b>권고:</b><ul className="list-disc ml-4">{cd.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></div>}
              {/* 월별 예측 테이블 */}
              {cd.monthlyForecast?.length > 0 && (
                <div className="mt-3 pt-2 border-t border-gray-200">
                  <p className="font-bold text-gray-700 mb-1">📅 월별 GPU 수요 예측 (올해 말까지, 인당 토큰 성장 반영)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[9px] border-collapse">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="px-2 py-1 text-left border border-gray-200 font-semibold">월</th>
                          <th className="px-2 py-1 text-right border border-gray-200 font-semibold cursor-help" title="인당 토큰 소비 증가율을 해당 월까지 복리 적용한 배율입니다.">토큰 성장</th>
                          <th className="px-2 py-1 text-right border border-gray-200 font-semibold cursor-help" title="현재 인프라 유지 시, 토큰 성장만으로 추가 필요한 B300 수.\n목표 인원 무관 — 순수 성장 대응 비용입니다.">성장만 B300</th>
                          <th className="px-2 py-1 text-right border border-gray-200 font-semibold cursor-help" title="목표 인원 달성 + 토큰 성장 대응에 필요한 총 추가 B300 수.">목표 기준 B300</th>
                          <th className="px-2 py-1 text-right border border-gray-200 font-semibold cursor-help" title="해당 월에 목표 기준 필요한 총 GPU 메모리(VRAM) 예측치입니다.">필요 VRAM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cd.monthlyForecast.map((f: any, i: number) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-2 py-1 border border-gray-200 font-medium">{f.month}</td>
                            <td className="px-2 py-1 border border-gray-200 text-right">x{f.tokenGrowthMultiplier}</td>
                            <td className={`px-2 py-1 border border-gray-200 text-right font-bold ${f.growthOnlyB300 > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>+{f.growthOnlyB300}장</td>
                            <td className={`px-2 py-1 border border-gray-200 text-right font-bold ${f.b300Units > 0 ? 'text-indigo-700' : 'text-emerald-600'}`}>+{f.b300Units}장</td>
                            <td className="px-2 py-1 border border-gray-200 text-right">{f.predictedVramGb?.toLocaleString()}GB</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[8px] text-gray-400 mt-1">* 안전마진 1.5배 및 에러보정 포함. 인당 토큰 소비 증가만 반영 (DAU 증가는 목표에 이미 포함).</p>
                </div>
              )}
            </div>
          </details>
        )}
        {/* AI 분석 — 2탭: 기술 분석 + 경영 보고서 */}
        {pred.aiAnalysis && pred.modelId !== 'none' && (
          <details className="text-[10px] mt-1">
            <summary className="cursor-pointer text-purple-600 font-medium hover:text-purple-800">AI 분석 리포트</summary>
            <div className="mt-2 space-y-2">
              {/* 경영 보고서 (비전문가용) */}
              {cd.executiveReport && (
                <div className="p-3 bg-blue-50/80 rounded-lg border border-blue-200">
                  <p className="text-[10px] font-bold text-blue-700 mb-1">경영 의사결정 보고서</p>
                  <div className="text-gray-700 text-[11px] leading-snug" dangerouslySetInnerHTML={{ __html: mdToHtml(cd.executiveReport || '') }} />
                </div>
              )}
              {/* 기술 분석 (전문가용) */}
              <div className="p-3 bg-white/70 rounded-lg">
                <p className="text-[10px] font-bold text-purple-700 mb-1">기술 상세 분석</p>
                <div className="text-gray-700 text-[11px] leading-snug" dangerouslySetInnerHTML={{ __html: mdToHtml(pred.aiAnalysis || '') }} />
              </div>
            </div>
          </details>
        )}
      </div>
      );
    })()}

    {/* ── 종합 KPI (실시간 + 5영업일 평균) ── */}
    {data.length > 0 && (
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-3 pt-2">
          <p className="text-[9px] text-gray-500">종합 용량 = max(처리량%, KV메모리%, 동시처리%) — 벤치마크(관측 P95 피크) 대비 | 영업시간: KST 9-18시 영업일</p>
        </div>
        {/* 실시간 */}
        <div className="px-3 pt-1">
          <p className="text-[9px] font-bold text-blue-600 mb-1">실시간 (Current)</p>
        </div>
        <div className="px-3 pb-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-2 border border-blue-200 cursor-help" title={`종합 용량 = max(처리량 ${avgTokPct ?? '-'}%, KV메모리 ${avgKvPct ?? '-'}%, 동시처리 ${avgConcPct ?? '-'}%)\n\n가장 빡빡한 차원이 전체를 대표합니다.\n벤치마크(관측 P95 피크) 대비 현재 사용량.\n\n50% 미만: 여유\n50~80%: 주의 (증설 계획 수립)\n80% 이상: 위험 (증설 시급)`}>
            <p className="text-[8px] text-blue-700 font-semibold">종합 용량 ⓘ</p>
            <p className={`text-xl font-black ${avgComposite != null ? utilTxt(avgComposite) : 'text-gray-300'}`}>{avgComposite ?? '-'}%</p>
            <p className="text-[7px] text-gray-400">처리량 {avgTokPct ?? '-'}% · KV {avgKvPct ?? '-'}% · 동시 {avgConcPct ?? '-'}%</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 cursor-help" title="여유 = 100% - 종합 용량\n\n추가 부하를 수용할 수 있는 여유분입니다.\n20% 이하면 증설이 시급합니다.">
            <p className="text-[8px] text-gray-600 font-semibold">여유 ⓘ</p>
            <p className={`text-xl font-black ${headroom != null ? (headroom <= 20 ? 'text-red-600' : 'text-emerald-600') : 'text-gray-300'}`}>{headroom ?? '-'}%</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 cursor-help" title="병목 = 3차원 중 가장 사용률이 높은 차원\n\n이 차원이 증설의 주된 이유입니다.">
            <p className="text-[8px] text-gray-600 font-semibold">병목 ⓘ</p>
            <p className="text-lg font-black text-orange-600">{fleetBottleneck ? bottleneckLabel(fleetBottleneck) : '-'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 cursor-help" title="전체 서버의 현재 초당 토큰 생성 수 합계">
            <p className="text-[8px] text-gray-600 font-semibold">처리량</p>
            <p className="text-xl font-black text-blue-600">{totTps > 0 ? totTps.toFixed(1) : '-'}<span className="text-[9px] font-normal"> tok/s</span></p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
            <p className="text-[8px] text-gray-600 font-semibold">인프라</p>
            <p className="text-xs font-bold text-gray-900">{totGpu}GPU · {totLlm}LLM · {online}/{data.length}서버</p>
            <div className="flex gap-1.5 text-[8px] text-gray-500">
              <span>CPU <b>{avgCpu ?? '-'}%</b></span>
              <span>RAM <b>{avgRam ?? '-'}%</b></span>
              <span>Disk <b>{avgDisk ?? '-'}%</b></span>
            </div>
          </div>
        </div>
        {/* 14일 영업일 평균 */}
        <div className="px-3 pt-1 border-t border-gray-100">
          <p className="text-[9px] font-bold text-emerald-600 mb-1">영업일 평균 (KST 9-18시, 최근 {anaDays}일, 주말·등록 휴일 제외)</p>
        </div>
        {(() => {
          const bh = ana?.businessHours;
          // 벤치마크 기반 평균: analytics 데이터를 벤치마크로 나눔
          const totalBmTps = data.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakTps || 0), 0);
          const totalBmConc = data.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakConcurrent || 0), 0);
          const avgTps = bh?.avgTps || null;
          const avgBhKv = bh?.avgKvCache || null;
          const avgBhConc = (bh?.avgRunningReqs || 0) + (bh?.avgWaitingReqs || 0);
          const avgBhTokPct = (avgTps != null && totalBmTps > 0) ? Math.round((avgTps / totalBmTps) * 1000) / 10 : null;
          const avgBhKvPct = avgBhKv;
          const avgBhConcPct = (totalBmConc > 0 && avgBhConc > 0) ? Math.round((avgBhConc / totalBmConc) * 1000) / 10 : null;
          const avgBhComposite = Math.max(avgBhTokPct || 0, avgBhKvPct || 0, avgBhConcPct || 0) || null;
          const avgHeadroom = avgBhComposite != null ? Math.round((100 - avgBhComposite) * 10) / 10 : null;
          return (
        <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <div className="bg-emerald-50 rounded-lg p-2 border border-emerald-200 cursor-help" title={`영업일 종합 용량 = max(처리량 ${avgBhTokPct ?? '-'}%, KV ${avgBhKvPct ?? '-'}%, 동시 ${avgBhConcPct ?? '-'}%)\n\n영업시간(KST 9-18시) 평균.\n벤치마크(P95 피크) 대비 사용량.`}>
            <p className="text-[8px] text-emerald-700 font-semibold">영업일 종합 용량 ⓘ</p>
            <p className={`text-xl font-black ${avgBhComposite != null ? utilTxt(avgBhComposite) : 'text-gray-300'}`}>{avgBhComposite ? Math.round(avgBhComposite * 10) / 10 : '-'}%</p>
            <p className="text-[7px] text-gray-400">처리 {avgBhTokPct ?? '-'}% · KV {avgBhKvPct ?? '-'}% · 동시 {avgBhConcPct ?? '-'}%</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 cursor-help" title="평균 여유 = 100% - 종합 용량\n\n20% 이하면 증설 시급.">
            <p className="text-[8px] text-gray-600 font-semibold">평균 여유 ⓘ</p>
            <p className={`text-xl font-black ${avgHeadroom != null ? (avgHeadroom <= 20 ? 'text-red-600' : 'text-emerald-600') : 'text-gray-300'}`}>{avgHeadroom ?? '-'}%</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
            <p className="text-[8px] text-gray-600 font-semibold">평균 처리량</p>
            <p className="text-xl font-black text-blue-600">{avgTps ?? '-'}<span className="text-[9px] font-normal"> tok/s</span></p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 cursor-help" title="GPU: nvidia-smi 사용률\nKV: KV Cache 사용률 — 80%+ 메모리 부족\nW: 대기 요청 수 — >0 과부하">
            <p className="text-[8px] text-gray-600 font-semibold">GPU / KV / 대기 ⓘ</p>
            <div className="flex gap-1.5 text-[9px] mt-0.5">
              <span>GPU <b>{bh?.avgGpuUtil ?? '-'}%</b></span>
              <span>KV <b>{bh?.avgKvCache ?? '-'}%</b></span>
              <span>W <b>{bh?.avgWaitingReqs ?? '-'}</b></span>
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
            <p className="text-[8px] text-gray-600 font-semibold">분석 기간</p>
            <p className="text-xs font-bold text-gray-900">{anaDays}일 ({bh?.sampleCount || 0}건)</p>
          </div>
        </div>
          );
        })()}
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
    {tab === 'analysis' && !ana && (
      <div className="flex items-center justify-center py-20"><div className="text-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-xs text-gray-500">분석 데이터 로딩 중...</p></div></div>
    )}
    {tab === 'analysis' && ana && (<div className="space-y-4">
      <div className="flex items-center justify-between"><span className="text-xs font-medium text-gray-600">30일 기간 분석 (휴일 {ana.period?.holidayCount || 0}일 제외, DTGPT 과거 데이터 포함, {ana.totalSnapshots?.toLocaleString() || 0}건)</span></div>

      {/* 서버별 종합 용량 비교 (벤치마크 기반) */}
      {data.length > 0 && (
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-gray-600 mb-3">서버별 종합 용량 비교 (벤치마크 대비)</p>
          <div className="space-y-2">
            {data.filter(e => e.metrics && !e.metrics.error).map(e => {
              const ca = e.capacityAnalysis;
              const comp = ca?.compositeCapacity || 0;
              const tooltip = [
                `서버: ${e.server.name}`,
                `종합 용량: ${comp}% (벤치마크 대비)`,
                `  처리량: ${ca?.tokPct ?? '-'}% (현재 ${ca?.currentTps ?? 0} / 벤치마크 ${ca?.benchmark?.peakTps ?? '?'} tok/s)`,
                `  KV 메모리: ${ca?.kvPct ?? '-'}%`,
                `  동시처리: ${ca?.concPct ?? '-'}%`,
                `  병목: ${ca?.bottleneck === 'throughput' ? '처리량' : ca?.bottleneck === 'kvMemory' ? 'KV메모리' : ca?.bottleneck === 'concurrency' ? '동시처리' : '-'}`,
                `  벤치마크 출처: ${ca?.benchmark?.source || '-'}`,
              ].join('\n');
              return (
                <div key={e.server.id} className="grid grid-cols-12 gap-2 items-center text-[10px] cursor-help" title={tooltip}>
                  <span className="col-span-2 text-gray-700 font-medium truncate">{e.server.name}</span>
                  <div className="col-span-3"><span className="text-gray-400">종합 {Math.round(comp)}%</span><MiniBar pct={comp} color={utilCls(comp)} h="h-2" /></div>
                  <div className="col-span-2"><span className="text-gray-400">처리량 {ca?.tokPct ?? '-'}%</span><MiniBar pct={ca?.tokPct || 0} color="bg-blue-400" h="h-2" /></div>
                  <div className="col-span-2"><span className="text-gray-400">KV {ca?.kvPct ?? '-'}%</span><MiniBar pct={ca?.kvPct || 0} color="bg-purple-400" h="h-2" /></div>
                  <div className="col-span-2 text-right"><span className="text-blue-600 font-bold">{ca?.currentTps?.toFixed(1) || '-'}</span><span className="text-gray-400"> tok/s</span></div>
                  <div className="col-span-1 text-right"><span className={`px-1 py-0.5 rounded text-[8px] ${comp > 80 ? 'bg-red-100 text-red-600' : comp > 50 ? 'bg-amber-100 text-amber-600' : comp < 20 ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>{comp > 80 ? '위험' : comp > 50 ? '주의' : comp < 20 ? '여유' : '정상'}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 3대 지표 시간대별 평균 카드 (기록 없는 날 제외) ── */}
      {(() => {
        const hm = ana.dateHourHeatmap || [];
        const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;
        // 피크: 14~16시 영업일만
        const peak = hm.filter((d: any) => d.hour >= 14 && d.hour <= 16 && d.samples > 0);
        // 비업무: 20시~06시
        const off = hm.filter((d: any) => (d.hour >= 20 || d.hour < 6) && d.samples > 0);
        // 전체
        const all = hm.filter((d: any) => d.samples > 0);
        // 벤치마크 합산 (% 계산용)
        const totalBmTps = data.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakTps || 0), 0);
        const totalBmConc = data.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakConcurrent || 0), 0);
        const calcPct = (arr: any[], field: string, bm: number) => {
          const vals = arr.map((d: any) => d[field]).filter((v: number) => v > 0);
          if (vals.length === 0 || bm === 0) return null;
          return Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length / bm * 1000) / 10;
        };

        const Card = ({ title, color, border, d }: { title: string; color: string; border: string; d: any[] }) => (
          <div className={`bg-white rounded-lg border p-3 shadow-sm ${border}`}>
            <p className={`text-[10px] font-semibold ${color} mb-2 flex items-center gap-1`}><Clock className="w-3 h-3" />{title} <span className="font-normal text-gray-400">({d.length}건)</span></p>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[10px]">
              <div><span className="text-gray-400">tok/s</span><p className="text-lg font-black text-blue-600">{avg(d.filter((x: any) => x.tps > 0).map((x: any) => x.tps)) ?? '-'}</p></div>
              <div><span className="text-gray-400">KV %</span><p className="text-lg font-black text-purple-600">{avg(d.filter((x: any) => x.kv > 0).map((x: any) => x.kv)) ?? '-'}%</p></div>
              <div><span className="text-gray-400">대기 건수</span><p className={`text-lg font-black ${(avg(d.map((x: any) => x.wait)) || 0) > 1 ? 'text-red-600' : 'text-emerald-600'}`}>{avg(d.map((x: any) => x.wait)) ?? '0'}</p></div>
              <div><span className="text-gray-300">처리량%</span><p className="text-sm font-bold text-blue-400">{calcPct(d, 'tps', totalBmTps) ?? '-'}%</p></div>
              <div><span className="text-gray-300">KV%</span><p className="text-sm font-bold text-purple-400">{avg(d.filter((x: any) => x.kv > 0).map((x: any) => x.kv)) ?? '-'}%</p></div>
              <div><span className="text-gray-300">동시처리%</span><p className={`text-sm font-bold ${(calcPct(d, 'wait', totalBmConc) || 0) > 100 ? 'text-red-500' : 'text-amber-400'}`}>{calcPct(d, 'wait', totalBmConc) ?? '-'}%</p></div>
            </div>
          </div>
        );

        return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card title="피크타임 (14~16시)" color="text-red-600" border="border-red-100" d={peak} />
          <Card title="비업무시간 (20~06시)" color="text-gray-500" border="border-gray-100" d={off} />
          <Card title="전체 (24시간)" color="text-blue-600" border="border-blue-100" d={all} />
        </div>);
      })()}

      {/* ── 6개 히트맵 (날짜×시간, 30일, 탭 전환) ── */}
      {(() => {
        const hm = (ana.dateHourHeatmap || []) as Array<{ date: string; hour: number; tps: number; kv: number; wait: number }>;
        const dates = [...new Set(hm.map(d => d.date))].sort();
        const [hmTab, setHmTab] = useState<string>('tps');
        const totalBmTps = data.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakTps || 0), 0);
        const totalBmConc = data.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakConcurrent || 0), 0);

        const tabs = [
          { key: 'tps', label: 'tok/s 실제값', color: (v: number) => v > 500 ? '#dc2626' : v > 100 ? '#f59e0b' : v > 0 ? '#3b82f6' : '#f3f4f6' },
          { key: 'kv', label: 'KV Cache %', color: (v: number) => v >= 80 ? '#dc2626' : v >= 50 ? '#f59e0b' : v > 0 ? '#8b5cf6' : '#f3f4f6' },
          { key: 'wait', label: '대기 건수', color: (v: number) => v >= 5 ? '#dc2626' : v >= 1 ? '#f59e0b' : '#10b981' },
          { key: 'tpsPct', label: '처리량 %', color: (v: number) => v >= 80 ? '#dc2626' : v >= 50 ? '#f59e0b' : v > 0 ? '#3b82f6' : '#f3f4f6' },
          { key: 'kvPct', label: 'KV %', color: (v: number) => v >= 80 ? '#dc2626' : v >= 50 ? '#f59e0b' : v > 0 ? '#8b5cf6' : '#f3f4f6' },
          { key: 'concPct', label: '동시처리 %', color: (v: number) => v >= 120 ? '#7f1d1d' : v >= 100 ? '#dc2626' : v >= 50 ? '#f59e0b' : v > 0 ? '#f97316' : '#f3f4f6' },
        ];
        const activeTab = tabs.find(t => t.key === hmTab) || tabs[0];

        const getValue = (d: any) => {
          if (hmTab === 'tps') return d.tps;
          if (hmTab === 'kv') return d.kv;
          if (hmTab === 'wait') return d.wait;
          if (hmTab === 'tpsPct') return totalBmTps > 0 ? Math.round(d.tps / totalBmTps * 1000) / 10 : 0;
          if (hmTab === 'kvPct') return d.kv;
          if (hmTab === 'concPct') return totalBmConc > 0 ? Math.round(d.wait / totalBmConc * 1000) / 10 : 0;
          return 0;
        };

        return (
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            <p className="text-[10px] font-semibold text-gray-600 mr-2">3대 지표 히트맵 (날짜 × 시간)</p>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setHmTab(t.key)} className={`px-2 py-0.5 text-[9px] rounded ${hmTab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{t.label}</button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <div className="inline-block">
              {/* 시간 헤더 */}
              <div className="flex">
                <div className="w-16 shrink-0" />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="w-5 text-center text-[7px] text-gray-400">{h}</div>
                ))}
              </div>
              {/* 날짜 행 */}
              {dates.map(dt => (
                <div key={dt} className="flex items-center">
                  <div className="w-16 shrink-0 text-[8px] text-gray-500 pr-1 text-right">{dt.slice(5)}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = hm.find(d => d.date === dt && d.hour === h);
                    const val = cell ? getValue(cell) : 0;
                    const bg = activeTab.color(val);
                    return (
                      <div key={h} className="w-5 h-4 border border-white/50 cursor-help" style={{ backgroundColor: bg }} title={`${dt} ${h}시\ntok/s: ${cell?.tps ?? '-'}\nKV: ${cell?.kv ?? '-'}%\n대기: ${cell?.wait ?? '-'}건${hmTab.includes('Pct') ? `\n${activeTab.label}: ${val}%` : ''}`} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>);
      })()}
    </div>)}

    <ServerModal open={modal} onClose={() => { setModal(false); setEdit(null); setTestR(null); }} onSubmit={handleSubmit} edit={edit} testing={testing} testResult={testR} onTest={handleTest} existingHosts={data.map(e => e.server.host)} />
  </div>);
}
