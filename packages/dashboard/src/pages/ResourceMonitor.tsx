import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import LoadingSpinner from '../components/LoadingSpinner';
import { gpuServerApi, gpuCapacityApi } from '../services/api';
import {
  Server, Plus, Trash2, RefreshCw, WifiOff, Cpu, MemoryStick,
  ChevronDown, ChevronUp, TestTube, Pencil, X, Copy,
  Activity, Clock, Layers, HardDrive, BarChart3,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
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
  const { t } = useTranslation();
  const [f, setF] = useState<FormData>(EMPTY_FORM);
  const set = (k: keyof FormData, v: any) => setF(p => ({ ...p, [k]: v }));
  const dupHost = !edit && existingHosts.includes(f.host);

  useEffect(() => {
    if (edit) setF({ name: edit.name, host: edit.host, sshPort: edit.sshPort, sshUsername: edit.sshUsername, sshPassword: '', description: edit.description || '', isLocal: edit.isLocal, pollIntervalSec: edit.pollIntervalSec });
    else setF(EMPTY_FORM);
  }, [edit, open]);

  if (!open) return null;
  return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
    <div className="flex items-center justify-between px-4 py-3 border-b"><h3 className="font-semibold text-sm text-gray-900">{edit ? t('resourceMonitor.modal.editServer') : t('resourceMonitor.modal.addServer')}</h3><button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button></div>
    <div className="p-4 space-y-3"><div className="grid grid-cols-2 gap-3">
      <div className="col-span-2"><label className="block text-[10px] font-medium text-gray-500 mb-0.5">{t('resourceMonitor.modal.serverName')}</label><input className={ic} placeholder="GPU-Server-1" value={f.name} onChange={e => set('name', e.target.value)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">{t('resourceMonitor.modal.hostIp')}{dupHost && <span className="text-red-500 ml-1">{t('resourceMonitor.modal.duplicate')}</span>}</label><input className={`${ic} ${dupHost ? 'border-red-400' : ''}`} placeholder="192.168.1.100" value={f.host} onChange={e => set('host', e.target.value)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">{t('resourceMonitor.modal.sshPort')}</label><input type="number" className={ic} value={f.sshPort} onChange={e => set('sshPort', parseInt(e.target.value) || 22)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">{t('resourceMonitor.modal.username')}</label><input className={ic} placeholder="root" value={f.sshUsername} onChange={e => set('sshUsername', e.target.value)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">{t('resourceMonitor.modal.password')}{edit && <span className="text-gray-400 ml-1">{t('resourceMonitor.modal.passwordEditHint')}</span>}</label><input type="password" className={ic} placeholder="••••" value={f.sshPassword} onChange={e => set('sshPassword', e.target.value)} /></div>
      <div className="col-span-2"><label className="block text-[10px] font-medium text-gray-500 mb-0.5">{t('resourceMonitor.modal.description')}</label><input className={ic} placeholder={t('resourceMonitor.modal.descriptionPlaceholder')} value={f.description} onChange={e => set('description', e.target.value)} /></div>
      <div><label className="block text-[10px] font-medium text-gray-500 mb-0.5">{t('resourceMonitor.modal.pollingSec')}</label><input type="number" className={ic} value={f.pollIntervalSec} onChange={e => set('pollIntervalSec', parseInt(e.target.value) || 60)} /></div>
      <div className="flex items-end pb-0.5"><label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" className="rounded text-blue-600" checked={f.isLocal} onChange={e => set('isLocal', e.target.checked)} />{t('resourceMonitor.modal.localServer')}</label></div>
    </div>
    {testResult && <div className={`p-2 rounded text-xs ${testResult.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}><p className="font-medium">{testResult.message}</p>{testResult.gpuInfo && <pre className="mt-1 text-[10px] opacity-80 whitespace-pre-wrap max-h-32 overflow-y-auto">{testResult.gpuInfo}</pre>}</div>}
    </div>
    <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
      <button onClick={() => onTest({ host: f.host, sshPort: f.sshPort, sshUsername: f.sshUsername, sshPassword: f.sshPassword })} disabled={testing || !f.host || !f.sshUsername || !f.sshPassword} className="text-xs text-gray-600 hover:text-gray-800 disabled:opacity-50 flex items-center gap-1"><TestTube className="w-3 h-3" />{testing ? t('resourceMonitor.modal.testingConn') : t('resourceMonitor.modal.connTest')}</button>
      <div className="flex gap-2"><button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500">{t('common.cancel')}</button><button onClick={() => onSubmit(f)} disabled={!f.name || !f.host || !f.sshUsername || (!edit && !f.sshPassword) || dupHost} className="px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg disabled:opacity-50">{edit ? t('resourceMonitor.modal.modify') : t('resourceMonitor.modal.register')}</button></div>
    </div>
  </div></div>);
}

// ── Model Group Card (K8s 모델 중심 뷰) ──
interface ModelGroup {
  modelName: string;
  instance: string; // containerName (e.g., "glm-47-h200-tp8")
  isShared: boolean;
  endpoints: { entry: RealtimeEntry; ep: LlmEndpoint }[];
  nodes: { name: string; host: string; gpuCount: number; gpuUtil: number | null }[];
}

function ModelGroupCard({ group }: { group: ModelGroup }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [dbg, setDbg] = useState(false);
  const [hist, setHist] = useState<any[]>([]);
  const { modelName, endpoints, nodes, isShared } = group;

  // 집계
  const totalGpus = nodes.reduce((a, n) => a + n.gpuCount, 0);
  const avgGpuUtil = (() => { const v = nodes.filter(n => n.gpuUtil != null); return v.length > 0 ? Math.round(v.reduce((a, n) => a + n.gpuUtil!, 0) / v.length) : null; })();
  const totalRunning = endpoints.reduce((a, e) => a + (e.ep.runningRequests || 0), 0);
  const totalWaiting = endpoints.reduce((a, e) => a + (e.ep.waitingRequests || 0), 0);
  const kvVals = endpoints.filter(e => e.ep.kvCacheUsagePct != null);
  const avgKv = kvVals.length > 0 ? Math.round(kvVals.reduce((a, e) => a + e.ep.kvCacheUsagePct!, 0) / kvVals.length * 10) / 10 : null;
  const totalPromptTps = endpoints.reduce((a, e) => a + (e.ep.promptThroughputTps || 0), 0);
  const totalGenTps = endpoints.reduce((a, e) => a + (e.ep.genThroughputTps || 0), 0);
  const totalTps = Math.round((totalPromptTps + totalGenTps) * 10) / 10;
  const preemptCount = endpoints.reduce((a, e) => a + (e.ep.preemptionCount || 0), 0);
  const avgTtft = (() => { const v = endpoints.filter(e => e.ep.ttftMs != null); return v.length > 0 ? Math.round(v.reduce((a, e) => a + e.ep.ttftMs!, 0) / v.length) : null; })();

  // 벤치마크 기반 3차원 % (서버별 capacityAnalysis 평균)
  const serverCas = endpoints.map(e => e.entry.capacityAnalysis).filter((ca): ca is CapacityAnalysis => ca != null);
  const uniqueCas = serverCas.filter((ca, i, arr) => arr.findIndex(c => c.modelName === ca.modelName && c.currentTps === ca.currentTps) === i);
  const avgCa = (field: 'compositeCapacity' | 'tokPct' | 'kvPct' | 'concPct') => {
    const vals = uniqueCas.filter(ca => ca[field] != null).map(ca => ca[field]!);
    return vals.length > 0 ? Math.round(vals.reduce((a, v) => a + v, 0) / vals.length * 10) / 10 : null;
  };
  const compositeCapacity = avgCa('compositeCapacity');
  const tokPct = avgCa('tokPct');
  const kvPctBm = avgCa('kvPct');
  const concPct = avgCa('concPct');
  const modelHeadroom = compositeCapacity != null ? Math.round((100 - compositeCapacity) * 10) / 10 : null;

  const kvColor = avgKv != null ? (avgKv >= 80 ? 'text-red-600' : avgKv >= 50 ? 'text-amber-600' : 'text-emerald-600') : 'text-gray-400';
  const gpuColor = avgGpuUtil != null ? (avgGpuUtil >= 90 ? 'text-red-600' : avgGpuUtil >= 70 ? 'text-amber-600' : 'text-emerald-600') : 'text-gray-400';

  // 히스토리 로드 (펼침 시 모든 노드에서)
  const loadHist = useCallback(async () => {
    const serverIds = endpoints.map(e => e.entry.server.id).filter((v, i, a) => a.indexOf(v) === i);
    const all: any[] = [];
    for (const sid of serverIds) {
      try {
        const r = await gpuServerApi.history(sid, 24);
        for (const snap of (r.data?.snapshots || [])) {
          const ls = (snap.llmMetrics || []) as LlmEndpoint[];
          const matched = ls.filter((l: any) => l.containerName === group.instance || l.modelNames?.some((n: string) => n === modelName));
          if (matched.length === 0 && !isShared) continue;
          const t = new Date(snap.timestamp);
          const kv = matched.filter((l: any) => l.kvCacheUsagePct != null);
          all.push({
            time: t.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            fullTime: t.toLocaleString('ko-KR'),
            tps: matched.some((l: any) => l.promptThroughputTps != null || l.genThroughputTps != null)
              ? Math.round(matched.reduce((a: number, l: any) => a + (l.promptThroughputTps || 0) + (l.genThroughputTps || 0), 0) * 10) / 10
              : null, // throughput이 전부 null이면 null 유지 (차트에서 gap 표시)
            kv: kv.length > 0 ? Math.round(kv.reduce((a: number, l: any) => a + l.kvCacheUsagePct, 0) / kv.length * 10) / 10 : null,
            running: matched.reduce((a: number, l: any) => a + (l.runningRequests || 0), 0),
            waiting: matched.reduce((a: number, l: any) => a + (l.waitingRequests || 0), 0),
            ts: t.getTime(),
          });
        }
      } catch {}
    }
    all.sort((a, b) => a.ts - b.ts);
    const sampled = all.length > 150 ? all.filter((_, i) => i % Math.ceil(all.length / 150) === 0) : all;
    setHist(sampled);
  }, [endpoints, group.instance, modelName, isShared]);

  useEffect(() => { if (open) loadHist(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 디버그 데이터
  const debugData = {
    modelName, instance: group.instance, isShared,
    nodes: nodes.map(n => ({ name: n.name, gpuCount: n.gpuCount, gpuUtil: n.gpuUtil })),
    endpoints: endpoints.map(e => ({
      server: e.entry.server.name,
      containerName: e.ep.containerName,
      modelNames: e.ep.modelNames,
      running: e.ep.runningRequests, waiting: e.ep.waitingRequests,
      kvCachePct: e.ep.kvCacheUsagePct,
      promptTps: e.ep.promptThroughputTps, genTps: e.ep.genThroughputTps,
      ttftMs: e.ep.ttftMs, preemption: e.ep.preemptionCount,
    })),
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-3 py-2.5">
        {/* 모델명 + 노드 요약 */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${totalRunning > 0 || totalTps > 0 ? 'bg-emerald-500 animate-pulse' : avgKv != null ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          <span className="text-xs font-bold text-gray-900 truncate">{modelName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">
            {isShared ? 'Shared' : `${totalGpus} GPU`}
          </span>
          <span className="text-[10px] text-gray-400 ml-auto truncate max-w-[200px]">
            {nodes.map(n => n.name.replace('DTGPT-', '')).join(' + ')}
          </span>
          <button onClick={() => setOpen(!open)} className="p-0.5 text-gray-400 hover:text-gray-600">
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* 핵심 지표 */}
        <div className="grid grid-cols-5 gap-1.5 text-center">
          <div>
            <p className="text-[9px] text-gray-400">GPU</p>
            <p className={`text-sm font-bold ${gpuColor}`}>{avgGpuUtil != null ? `${avgGpuUtil}%` : '-'}</p>
          </div>
          <div>
            <p className="text-[9px] text-gray-400">KV Cache</p>
            <p className={`text-sm font-bold ${kvColor}`}>{avgKv != null ? `${avgKv}%` : '-'}</p>
          </div>
          <div>
            <p className="text-[9px] text-gray-400">tok/s</p>
            <p className="text-sm font-bold text-blue-600">{totalTps > 0 ? totalTps : '-'}</p>
          </div>
          <div>
            <p className="text-[9px] text-gray-400">{t('resourceMonitor.modelCard.processing')}</p>
            <p className="text-sm font-bold text-emerald-600">{totalRunning}</p>
          </div>
          <div>
            <p className="text-[9px] text-gray-400">{t('resourceMonitor.modelCard.waiting')}</p>
            <p className={`text-sm font-bold ${totalWaiting > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{totalWaiting}</p>
          </div>
        </div>

        {/* 벤치마크 기반 용량 */}
        {compositeCapacity != null && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1"><MiniBar pct={compositeCapacity} color={utilCls(compositeCapacity)} h="h-1.5" /></div>
            <span className={`text-[9px] font-bold ${utilTxt(compositeCapacity)}`}>{compositeCapacity}%</span>
            <span className={`text-[9px] ${modelHeadroom != null && modelHeadroom <= 20 ? 'text-red-500' : 'text-emerald-500'}`}>{t('resourceMonitor.modelCard.headroom')} {modelHeadroom}%</span>
          </div>
        )}
        {(tokPct != null || kvPctBm != null || concPct != null) && (
          <div className="flex gap-2 mt-0.5 text-[7px] text-gray-400">
            <span>{t('resourceMonitor.modelCard.throughput')} <b className="text-gray-600">{tokPct ?? '-'}%</b></span>
            <span>KV <b className={`${(kvPctBm || 0) >= 80 ? 'text-red-600' : 'text-gray-600'}`}>{kvPctBm ?? '-'}%</b></span>
            <span>{t('resourceMonitor.modelCard.concurrent')} <b className="text-gray-600">{concPct ?? '-'}%</b></span>
          </div>
        )}
      </div>

      {/* 펼침 */}
      {open && (
        <div className="border-t px-3 py-2 space-y-3 bg-gray-50/50">
          {/* 추가 메트릭 */}
          <div className="flex flex-wrap gap-3 text-[10px] text-gray-500">
            {avgTtft != null && <span>TTFT: <b className="text-gray-700">{avgTtft >= 1000 ? `${(avgTtft / 1000).toFixed(1)}s` : `${avgTtft}ms`}</b></span>}
            {totalPromptTps > 0 && <span>Prefill: <b className="text-gray-700">{Math.round(totalPromptTps)} tok/s</b></span>}
            {totalGenTps > 0 && <span>Decode: <b className="text-gray-700">{Math.round(totalGenTps)} tok/s</b></span>}
            {preemptCount > 0 && <span className="text-red-500">Preemption: <b>{t('resourceMonitor.modelCard.preemptionCount', { count: preemptCount })}</b></span>}
          </div>

          {/* 노드별 GPU */}
          <div className="space-y-1">
            <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider">{t('resourceMonitor.modelCard.nodeGpu')}</p>
            {nodes.map((n, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className="text-gray-500 w-28 truncate" title={n.name}>{n.name.replace('DTGPT-', '')}</span>
                <span className="text-gray-400 w-14">{n.gpuCount} GPU</span>
                <div className="flex-1"><MiniBar pct={n.gpuUtil || 0} color={utilCls(n.gpuUtil || 0)} h="h-1.5" /></div>
                <span className={`w-10 text-right font-medium ${utilTxt(n.gpuUtil || 0)}`}>{n.gpuUtil != null ? `${Math.round(n.gpuUtil)}%` : '-'}</span>
              </div>
            ))}
          </div>

          {/* 24시간 차트 */}
          {hist.length > 0 && (<div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider">{t('resourceMonitor.modelCard.trend24h')}</p>
              {hist.every(h => !h.tps || h.tps === 0) && <span className="text-[8px] text-amber-500">{t('resourceMonitor.modelCard.tpsCollecting')}</span>}
            </div>
            {/* KV Cache + tok/s */}
            <div>
              <p className="text-[9px] text-gray-400 mb-0.5">{t('resourceMonitor.modelCard.kvCacheTps')}</p>
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={hist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="kv" domain={[0, 100]} tick={{ fontSize: 8 }} tickFormatter={v => `${v}%`} />
                  <YAxis yAxisId="tps" orientation="right" tick={{ fontSize: 8 }} />
                  <Tooltip content={<Tip />} />
                  <Area yAxisId="kv" type="monotone" dataKey="kv" name="KV Cache %" stroke="#8b5cf6" fill="#8b5cf620" strokeWidth={1.5} dot={false} />
                  <Line yAxisId="tps" type="monotone" dataKey="tps" name="tok/s" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {/* 대기/처리 요청 */}
            <div>
              <p className="text-[9px] text-gray-400 mb-0.5">{t('resourceMonitor.modelCard.runningWaiting')}</p>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={hist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 8 }} />
                  <Tooltip content={<Tip />} />
                  <Area type="monotone" dataKey="running" name={t('resourceMonitor.modelCard.chartRunning')} stroke="#10b981" fill="#10b98120" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="waiting" name={t('resourceMonitor.modelCard.chartWaiting')} stroke="#f59e0b" fill="#f59e0b20" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>)}

          {/* 디버그 */}
          <div className="flex items-center gap-2">
            <button onClick={() => setDbg(!dbg)} className="text-[9px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
              <Activity className="w-3 h-3" />{dbg ? t('resourceMonitor.modelCard.debugClose') : t('resourceMonitor.modelCard.debugLog')}
            </button>
            {dbg && <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(debugData, null, 2)); }} className="text-[9px] text-blue-500 hover:text-blue-700 flex items-center gap-0.5"><Copy className="w-3 h-3" />{t('common.copy')}</button>}
          </div>
          {dbg && (
            <pre className="text-[9px] bg-gray-900 text-green-400 p-2 rounded overflow-x-auto max-h-48 overflow-y-auto select-all whitespace-pre-wrap">
              {JSON.stringify(debugData, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Compact Server Card ──
function ServerCard({ entry, onEdit, onDelete, onToggle, onCopy }: { entry: RealtimeEntry; onEdit: () => void; onDelete: () => void; onToggle: () => void; onCopy: () => void; }) {
  const { t } = useTranslation();
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
            <button onClick={onEdit} className="p-1 text-gray-300 hover:text-gray-500" title={t('resourceMonitor.serverCard.editTooltip')}><Pencil className="w-3 h-3" /></button>
            <button onClick={onCopy} className="p-1 text-gray-300 hover:text-blue-500" title={t('resourceMonitor.serverCard.copyTooltip')}><Copy className="w-3 h-3" /></button>
            <button onClick={onToggle} className={`px-1.5 py-0.5 text-[9px] rounded ${s.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>{s.enabled ? 'ON' : 'OFF'}</button>
            <button onClick={onDelete} className="p-1 text-gray-300 hover:text-red-400" title={t('resourceMonitor.serverCard.deleteTooltip')}><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>

        {m?.error ? <p className="text-[10px] text-red-500"><WifiOff className="w-3 h-3 inline mr-0.5" />{m.error}</p> : ok ? (<>
          {/* ── 1) 벤치마크 기반 4개 게이지 ── */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-1.5">
            <div className="flex items-center gap-1.5 text-[10px]" title={t('resourceMonitor.serverCard.compositeTooltip', { tokPct: ca?.tokPct ?? '-', kvPct: ca?.kvPct ?? '-', concPct: ca?.concPct ?? '-', bottleneck: ca?.bottleneck === 'throughput' ? t('resourceMonitor.serverCard.bottleneckThroughput') : ca?.bottleneck === 'kvMemory' ? t('resourceMonitor.serverCard.bottleneckKvMemory') : ca?.bottleneck === 'concurrency' ? t('resourceMonitor.serverCard.bottleneckConcurrency') : '-' })}>
              <span className="text-gray-500 w-10 shrink-0">{t('resourceMonitor.serverCard.composite')}</span>
              <div className="flex-1"><MiniBar pct={serverComposite || 0} color={utilCls(serverComposite || 0)} h="h-2" /></div>
              <b className={`w-7 text-right ${serverComposite != null ? utilTxt(serverComposite) : 'text-gray-300'}`}>{serverComposite != null ? Math.round(serverComposite) : '-'}%</b>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]" title={t('resourceMonitor.serverCard.throughputTooltip')}>
              <span className="text-gray-500 w-10 shrink-0">{t('resourceMonitor.serverCard.throughput')}</span>
              <div className="flex-1"><MiniBar pct={ca?.tokPct || 0} color="bg-blue-400" h="h-2" /></div>
              <b className={`w-7 text-right ${ca?.tokPct != null ? utilTxt(ca.tokPct) : 'text-gray-300'}`}>{ca?.tokPct ?? '-'}%</b>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]" title={t('resourceMonitor.serverCard.kvTooltip')}>
              <span className="text-gray-500 w-10 shrink-0">{t('resourceMonitor.serverCard.kv')}</span>
              <div className="flex-1"><MiniBar pct={ca?.kvPct || 0} color="bg-purple-400" h="h-2" /></div>
              <b className={`w-7 text-right ${ca?.kvPct != null && ca.kvPct >= 80 ? 'text-red-600' : ca?.kvPct != null && ca.kvPct >= 50 ? 'text-amber-600' : 'text-gray-700'}`}>{ca?.kvPct ?? '-'}%</b>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]" title={t('resourceMonitor.serverCard.headroomTooltip')}>
              <span className="text-gray-500 w-10 shrink-0">{t('resourceMonitor.serverCard.headroom')}</span>
              <div className="flex-1"><MiniBar pct={serverHeadroom || 0} color={serverHeadroom != null && serverHeadroom <= 20 ? 'bg-red-400' : 'bg-emerald-400'} h="h-2" /></div>
              <b className={`w-7 text-right ${serverHeadroom != null ? (serverHeadroom <= 20 ? 'text-red-600' : 'text-emerald-600') : 'text-gray-300'}`}>{serverHeadroom ?? '-'}%</b>
            </div>
          </div>

          {/* ── 2) 3대 지표: tok/s + KV% + 대기건수 ── */}
          <div className="flex items-center gap-2 mb-1.5 text-[10px] flex-wrap">
            <span className="text-blue-600 font-semibold">{currentTps > 0 ? currentTps.toFixed(1) : '-'} <span className="font-normal">tok/s</span></span>
            {kvPct != null && <span className="text-gray-400">KV <b className={kvPct >= 80 ? 'text-red-600' : kvPct >= 50 ? 'text-amber-600' : 'text-emerald-600'}>{kvPct.toFixed(0)}%</b></span>}
            {(() => { const w = eps.reduce((a, e) => a + (e.waitingRequests || 0), 0); return w > 0 ? <span className="text-red-500 font-semibold">{t('resourceMonitor.serverCard.waitingCount', { count: w })}</span> : <span className="text-emerald-500">{t('resourceMonitor.serverCard.waitingZero')}</span>; })()}
            {ca?.benchmark && <span className="text-gray-300 text-[8px]">{t('resourceMonitor.serverCard.benchmark', { tps: ca.benchmark.peakTps })}</span>}
            {!ca && !kvPct && <span className="text-gray-300">{t('resourceMonitor.serverCard.dataCollecting')}</span>}
          </div>

          {/* ── 3) 영업시간 평균 ── */}
          <div className="mb-1.5 p-1.5 bg-blue-50/50 rounded border border-blue-100/50">
            <p className="text-[8px] text-blue-500 mb-1">{t('resourceMonitor.serverCard.businessHoursLabel')}</p>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="text-[9px]"><span className="text-blue-600 font-medium">{t('resourceMonitor.serverCard.gpuUtil')}</span><div className="flex items-center gap-1"><MiniBar pct={hist?.businessHoursAvg?.avgGpuUtil || 0} color={utilCls(hist?.businessHoursAvg?.avgGpuUtil || 0)} h="h-1.5" /><b className={utilTxt(hist?.businessHoursAvg?.avgGpuUtil || 0)}>{hist?.businessHoursAvg?.avgGpuUtil ?? '-'}%</b></div></div>
              <div className="text-[9px]"><span className="text-blue-600 font-medium">{t('resourceMonitor.serverCard.vramUtil')}</span><div className="flex items-center gap-1"><MiniBar pct={hist?.businessHoursAvg?.avgMemUtil || 0} color="bg-indigo-400" h="h-1.5" /><b>{hist?.businessHoursAvg?.avgMemUtil ?? '-'}%</b></div></div>
              <div className="text-[9px]"><span className="text-blue-600 font-medium">{t('resourceMonitor.serverCard.compositeCapacity')}</span><div className="flex items-center gap-1"><MiniBar pct={ca?.compositeCapacity || 0} color={utilCls(ca?.compositeCapacity || 0)} h="h-1.5" /><b className={utilTxt(ca?.compositeCapacity || 0)}>{ca?.compositeCapacity != null ? Math.round(ca.compositeCapacity) : '-'}%</b></div></div>
            </div>
          </div>

          {/* ── 4) 시스템 리소스 한 줄 ── */}
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            {cpuPct != null && <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />CPU <b className={cpuPct > 80 ? 'text-red-600' : 'text-gray-700'}>{cpuPct}%</b></span>}
            {ramPct != null && <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" />RAM <b className={ramPct > 85 ? 'text-red-600' : 'text-gray-700'}>{ramPct}%</b></span>}
            {diskPct != null && <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />Disk <b className={diskPct > 90 ? 'text-red-600' : 'text-gray-700'}>{diskPct}%</b><span className="text-gray-400">({m.diskFreeGb}GB free)</span></span>}
            {currentTps > 0 && <span className="flex items-center gap-1 text-blue-600"><Activity className="w-3 h-3" /><b>{currentTps.toFixed(1)}</b> tok/s</span>}
            {eps.length > 0 && <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{t('resourceMonitor.serverCard.llmCount', { count: eps.length })}</span>}
            {kvPct != null && <span>KV <b className={utilTxt(kvPct)}>{kvPct.toFixed(0)}%</b></span>}
          </div>

          {/* ── LLM 인스턴스 태그 ── */}
          {eps.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {eps.map((ep, i) => (
                <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${llmBadge(ep.type)} cursor-help`}
                  title={[
                    t('resourceMonitor.serverCard.ttftLabel', { value: ep.ttftMs != null ? Math.round(ep.ttftMs) + 'ms' : '-' }),
                    t('resourceMonitor.serverCard.tpotLabel', { value: ep.tpotMs != null ? Math.round(ep.tpotMs) + 'ms' : '-' }),
                    t('resourceMonitor.serverCard.e2eLabel', { value: ep.e2eLatencyMs != null ? Math.round(ep.e2eLatencyMs) + 'ms' : '-' }),
                    t('resourceMonitor.serverCard.cacheHitLabel', { value: ep.prefixCacheHitRate != null ? (ep.prefixCacheHitRate * 100).toFixed(1) + '%' : '-' }),
                    t('resourceMonitor.serverCard.preemptionLabel', { value: t('resourceMonitor.modelCard.preemptionCount', { count: ep.preemptionCount ?? 0 }) }),
                    t('resourceMonitor.serverCard.queueLabel', { value: ep.queueTimeMs != null ? Math.round(ep.queueTimeMs) + 'ms' : '-' }),
                  ].join('\n')}>
                  {(() => {
                    const overloaded = (ep.kvCacheUsagePct != null && ep.kvCacheUsagePct > 80) || (ep.waitingRequests || 0) > 0 || (ep.preemptionCount || 0) > 0;
                    return overloaded ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" title={t('resourceMonitor.serverCard.overloadTitle')} /> : null;
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
        </>) : <p className="text-[10px] text-gray-400">{t('resourceMonitor.serverCard.waitingPending')}</p>}
      </div>

      {/* ── 상세 펼침 ── */}
      {ok && (<>
        <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 border-t border-gray-100">
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{open ? t('resourceMonitor.serverCard.collapse') : t('resourceMonitor.serverCard.expand')}
        </button>
        {open && (<div className="border-t border-gray-100 text-xs">
          {/* GPU별 상세 */}
          <div className="px-3 py-2 space-y-1">
            <p className="text-[10px] font-medium text-gray-500 mb-1">{t('resourceMonitor.serverCard.gpuDetail')}</p>
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
              <p className="text-[10px] font-medium text-gray-500 mb-1.5">{t('resourceMonitor.serverCard.benchmarkVs')} {ca?.benchmark?.source === 'manual' ? t('resourceMonitor.serverCard.benchmarkManual') : t('resourceMonitor.serverCard.benchmarkAutoP95')}</p>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5"><span className="text-[9px] text-gray-400 w-14 text-right">{t('resourceMonitor.serverCard.benchmarkThroughput')}</span><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(ca?.tokPct || 0, 100)}%` }} /></div><span className="text-[9px] w-14 text-right text-blue-600">{ca?.tokPct ?? '-'}%</span></div>
                <div className="flex items-center gap-1.5"><span className="text-[9px] text-gray-400 w-14 text-right">{t('resourceMonitor.serverCard.benchmarkKvMemory')}</span><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.min(ca?.kvPct || 0, 100)}%` }} /></div><span className={`text-[9px] w-14 text-right ${(ca?.kvPct || 0) >= 80 ? 'text-red-600' : 'text-purple-600'}`}>{ca?.kvPct ?? '-'}%</span></div>
                <div className="flex items-center gap-1.5"><span className="text-[9px] text-gray-400 w-14 text-right">{t('resourceMonitor.serverCard.benchmarkConcurrency')}</span><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(ca?.concPct || 0, 100)}%` }} /></div><span className={`text-[9px] w-14 text-right ${(ca?.concPct || 0) >= 100 ? 'text-red-600' : 'text-amber-600'}`}>{ca?.concPct ?? '-'}%</span></div>
              </div>
              <div className="flex gap-4 mt-1.5 text-[9px]">
                <span className="text-gray-500">{t('resourceMonitor.serverCard.current')} <b className="text-blue-600">{(ca?.currentTps || 0).toFixed(1)} tok/s</b></span>
                <span className="text-gray-500">{t('resourceMonitor.serverCard.benchmarkLabel')} <b>{ca?.benchmark?.peakTps ?? '-'} tok/s</b></span>
                {ca?.bottleneck && <span className="text-orange-600 font-semibold">{t('resourceMonitor.serverCard.bottleneckLabel')} {ca.bottleneck === 'throughput' ? t('resourceMonitor.serverCard.bottleneckThroughput') : ca.bottleneck === 'kvMemory' ? t('resourceMonitor.serverCard.bottleneckKvMemory') : t('resourceMonitor.serverCard.bottleneckConcurrency')}</span>}
              </div>
            </div>
          )}

          {/* 히스토리 차트 */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-medium text-gray-500">{t('resourceMonitor.serverCard.usageTrend')}</span><div className="flex gap-0.5">{[6, 12, 24, 72].map(h => <button key={h} onClick={() => setHrs(h)} className={`px-1.5 py-0.5 text-[9px] rounded ${hrs === h ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{h}h</button>)}</div></div>
            {hist?.businessHoursAvg && <div className="flex items-center gap-2 mb-2 p-1.5 bg-blue-50 rounded text-[9px] text-blue-700"><Clock className="w-3 h-3" /><span>{t('resourceMonitor.serverCard.businessHoursAvgLabel', { gpu: hist.businessHoursAvg.avgGpuUtil, vram: hist.businessHoursAvg.avgMemUtil, count: hist.businessHoursAvg.sampleCount })}</span></div>}
            <div className="space-y-3">
              {/* KV Cache + GPU 사용률 */}
              <div><p className="text-[9px] text-gray-400 mb-0.5">{t('resourceMonitor.serverCard.kvCacheGpu')}</p>
              <ResponsiveContainer width="100%" height={140}><AreaChart data={dd}><defs><linearGradient id="gG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} /><Tooltip content={<Tip />} /><Area type="monotone" dataKey="kvCache" name="KV Cache" stroke="#8b5cf6" fill="url(#gG)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="gpuUtil" name="GPU" stroke="#94a3b8" strokeWidth={1} dot={false} /></AreaChart></ResponsiveContainer></div>
              {/* tok/s 처리량 (합산 + LLM별) */}
              {(() => {
                const llmColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];
                const reserved = new Set(['time','fullTime','gpuUtil','memPct','llmPct','kvCache','throughput','effUtil','cpuLoad','ramPct','ttft','preempt']);
                const allKeys = new Set<string>(); dd.forEach((d: any) => Object.keys(d).forEach(k => allKeys.add(k)));
                const llmKeys = [...allKeys].filter(k => !reserved.has(k) && !k.endsWith('_kv') && !k.endsWith('_ttft'));
                const kvKeys = [...allKeys].filter(k => k.endsWith('_kv'));
                return (<>
                  <div><p className="text-[9px] text-gray-400 mb-0.5">{t('resourceMonitor.serverCard.throughputTps')}{llmKeys.length > 1 && <span className="ml-1 text-blue-500">{t('resourceMonitor.serverCard.throughputPerLlm')}</span>}</p>
                  <ResponsiveContainer width="100%" height={llmKeys.length > 1 ? 130 : 100}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} />
                    {llmKeys.length > 1 && <Line type="monotone" dataKey="throughput" name={t('resourceMonitor.serverCard.sumLabel')} stroke="#94a3b8" strokeWidth={1} dot={false} strokeDasharray="4 2" />}
                    {llmKeys.length > 0 ? llmKeys.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={k} stroke={llmColors[i % llmColors.length]} strokeWidth={2} dot={false} />) : <Line type="monotone" dataKey="throughput" name="tok/s" stroke="#3b82f6" strokeWidth={2} dot={false} />}
                  </LineChart></ResponsiveContainer></div>
                  {/* LLM별 KV Cache */}
                  {kvKeys.length >= 1 && (
                    <div><p className="text-[9px] text-gray-400 mb-0.5">{t('resourceMonitor.serverCard.kvCachePerLlm')}</p>
                    <ResponsiveContainer width="100%" height={80}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} />
                      {kvKeys.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={k.replace('_kv', '')} stroke={llmColors[i % llmColors.length]} strokeWidth={1.5} dot={false} />)}
                    </LineChart></ResponsiveContainer></div>
                  )}
                </>);
              })()}
              {/* CPU / RAM / VRAM */}
              <div><p className="text-[9px] text-gray-400 mb-0.5">{t('resourceMonitor.serverCard.systemResource')}</p>
              <ResponsiveContainer width="100%" height={80}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} /><Line type="monotone" dataKey="ramPct" name="RAM" stroke="#ec4899" strokeWidth={1} dot={false} /><Line type="monotone" dataKey="memPct" name="VRAM" stroke="#f59e0b" strokeWidth={1} dot={false} /></LineChart></ResponsiveContainer></div>
              {/* TTFT + Preemption (서비스 품질) */}
              {(() => {
                const ttftKeys = [...new Set<string>()]; dd.forEach((d: any) => Object.keys(d).filter(k => k.endsWith('_ttft')).forEach(k => { if (!ttftKeys.includes(k)) ttftKeys.push(k); }));
                const clr = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];
                return (<>
                  <div><p className="text-[9px] text-gray-400 mb-0.5">{t('resourceMonitor.serverCard.ttftFirstToken')} {ttftKeys.length > 0 ? t('resourceMonitor.serverCard.ttftPerLlm') : ''}</p>
                  <ResponsiveContainer width="100%" height={80}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} />
                    {ttftKeys.length > 0 ? ttftKeys.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={k.replace('_ttft', '')} stroke={clr[i % clr.length]} strokeWidth={1.5} dot={false} />) : <Line type="monotone" dataKey="ttft" name="TTFT" stroke="#f59e0b" strokeWidth={1.5} dot={false} />}
                  </LineChart></ResponsiveContainer></div>
                  <div><p className="text-[9px] text-gray-400 mb-0.5">{t('resourceMonitor.serverCard.preemptionVram')}</p>
                  <ResponsiveContainer width="100%" height={60}><LineChart data={dd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 9 }} /><Tooltip content={<Tip />} /><Line type="monotone" dataKey="preempt" name="Preemption" stroke="#ef4444" strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer></div>
                </>);
              })()}
            </div>
          </div>

          {/* AI 코칭 */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <button onClick={async () => { setCoachL(true); try { const r = await gpuServerApi.coaching(s.id); setCoach(r.data.coaching); } catch { setCoach(null); } finally { setCoachL(false); } }} className="text-[9px] text-indigo-500 hover:text-indigo-700 underline">{coachL ? t('resourceMonitor.serverCard.aiCoachLoading') : t('resourceMonitor.serverCard.aiCoachView')}</button>
              <button onClick={async () => { setCoachL(true); try { const r = await gpuServerApi.runCoaching(s.id); setCoach(r.data.coaching); } catch (e: any) { alert(e?.response?.data?.error || t('resourceMonitor.failed')); } finally { setCoachL(false); } }} className="text-[9px] text-purple-500 hover:text-purple-700 underline">{coachL ? t('resourceMonitor.serverCard.analyzing') : t('resourceMonitor.serverCard.analyzeNow')}</button>
            </div>
            {coach && (
              <div className="mt-1.5 p-2 bg-indigo-50 rounded-lg text-[9px] space-y-1">
                <p className="text-[8px] text-indigo-400">{coach.timestamp ? new Date(coach.timestamp).toLocaleString('ko-KR') : ''}</p>
                {coach.paramCheck && <p><b className="text-indigo-600">{t('resourceMonitor.serverCard.paramCheck')}</b> {coach.paramCheck}</p>}
                {coach.precisionAdvice && <p><b className="text-indigo-600">{t('resourceMonitor.serverCard.precisionAdvice')}</b> {coach.precisionAdvice}</p>}
                {coach.batchAdvice && <p><b className="text-indigo-600">{t('resourceMonitor.serverCard.batchAdvice')}</b> {coach.batchAdvice}</p>}
                {coach.qualityIssues && <p><b className="text-indigo-600">{t('resourceMonitor.serverCard.qualityIssues')}</b> {coach.qualityIssues}</p>}
                {coach.topRecommendations?.length > 0 && (
                  <div className="mt-1 p-1.5 bg-white rounded border border-indigo-200">
                    <b className="text-indigo-700">{t('resourceMonitor.serverCard.recommendations')}</b>
                    <ul className="list-disc ml-3 mt-0.5">{coach.topRecommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 디버그 */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <button onClick={async () => { setDbgL(true); try { const r = await gpuServerApi.debug(s.id); setDbg(r.data.raw); } catch (e: any) { setDbg('Error: ' + e.message); } finally { setDbgL(false); } }} className="text-[9px] text-gray-400 hover:text-gray-600 underline">{dbgL ? t('resourceMonitor.serverCard.querying') : t('resourceMonitor.serverCard.sshRawDebug')}</button>
              {dbg && <button onClick={() => { try { navigator.clipboard.writeText(dbg); } catch { const ta = document.createElement('textarea'); ta.value = dbg; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } alert(t('resourceMonitor.serverCard.copied')); }} className="text-[9px] text-blue-400 hover:text-blue-600 underline">{t('common.copy')}</button>}
            </div>
            {dbg && <pre className="mt-1 p-2 bg-gray-900 text-green-400 rounded text-[9px] max-h-48 overflow-auto whitespace-pre-wrap">{dbg}</pre>}
          </div>
        </div>)}
      </>)}
    </div>
  );
}


// ── GPU 모니터링 가이드북 ──
const GUIDE_ICONS = ['📊', '☸️', '🏗️', '🔀', '🖥️', '🧠', '⚡', '🚦', '🚨', '🔄', '🔔'];
const getGuideSlides = () => Array.from({ length: 11 }, (_, idx) => ({
  title: i18n.t(`resourceMonitor.guide.title${idx}`),
  icon: GUIDE_ICONS[idx],
  content: i18n.t(`resourceMonitor.guide.content${idx}`),
}));

function GuideBook({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const slides = getGuideSlides();
  const slide = slides[page];
  const total = slides.length;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); setPage(p => Math.min(p + 1, total - 1)); }
      if (e.key === 'ArrowLeft') setPage(p => Math.max(p - 1, 0));
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, total]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{slide.icon}</span>
            <div>
              <h2 className="text-sm font-bold text-gray-900">{slide.title}</h2>
              <p className="text-[10px] text-gray-400">{page + 1} / {total}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${((page + 1) / total) * 100}%` }} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-line" dangerouslySetInnerHTML={{
            __html: slide.content
              .replace(/\*\*(.*?)\*\*/g, '<strong class="text-gray-900">$1</strong>')
              .replace(/^(┌|└|─)/gm, '<span class="font-mono text-blue-500">$1</span>')
              .replace(/\n/g, '<br/>')
          }} />
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button onClick={() => setPage(p => Math.max(p - 1, 0))} disabled={page === 0}
            className="px-4 py-2 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed">
            {t('resourceMonitor.guide.prevSlide')}
          </button>
          <div className="flex gap-1">
            {slides.map((_, i) => (
              <button key={i} onClick={() => setPage(i)}
                className={`w-2 h-2 rounded-full transition-all ${i === page ? 'bg-blue-500 w-4' : 'bg-gray-300 hover:bg-gray-400'}`} />
            ))}
          </div>
          {page < total - 1 ? (
            <button onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700">
              {t('resourceMonitor.guide.nextSlide')}
            </button>
          ) : (
            <button onClick={onClose}
              className="px-4 py-2 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
              {t('resourceMonitor.guide.complete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──
export default function ResourceMonitor() {
  const { t } = useTranslation();
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
  const [anaServerId, setAnaServerId] = useState<string>('');
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
  const [hmTab, setHmTab] = useState('tps');
  const [guideOpen, setGuideOpen] = useState(false);
  const ref = useRef<ReturnType<typeof setInterval>>();
  const lastTsRef = useRef<string>('');

  const fetch_ = useCallback(async () => {
    try {
      const [r, p, s] = await Promise.all([gpuServerApi.realtime(), gpuCapacityApi.latest(), gpuCapacityApi.getSettings()]);
      // 선계산 timestamp 비교 — GPU 데이터 미변경 시 setData 스킵 (차트 리렌더 방지)
      const newTs = r.data?.updatedAt || '';
      const dataChanged = !newTs || newTs !== lastTsRef.current;
      if (dataChanged) {
        lastTsRef.current = newTs;
        setData(r.data.data || []);
      }
      setPred(p.data.prediction);
      if (s.data.notice && !noticeText) setNoticeText(s.data.notice);
      setUpdated(new Date());
    } catch {} finally { setLoading(false); }
  }, []);
  const fetchAna = useCallback(async () => { try { const r = await gpuServerApi.analytics(anaDays, anaServerId || undefined); setAna(r.data); } catch {} }, [anaDays, anaServerId]);
  const [anaLoading, setAnaLoading] = useState(false);
  const fetchAnaWithLoading = useCallback(async () => { if (!ana) setAnaLoading(true); await fetchAna(); setAnaLoading(false); }, [fetchAna, ana]);
  useEffect(() => {
    fetch_();
    fetchAna(); // 분석 데이터 백그라운드 프리페치 (탭 전환 시 즉시 표시)
    ref.current = setInterval(fetch_, 10000);
    // 탭 비활성 시 폴링 중단, 활성화 시 즉시 재개 (Page Visibility API)
    const onVisChange = () => {
      if (document.hidden) {
        if (ref.current) { clearInterval(ref.current); ref.current = undefined; }
      } else {
        if (ref.current) { clearInterval(ref.current); ref.current = undefined; }
        fetch_();
        ref.current = setInterval(fetch_, 10000);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      if (ref.current) clearInterval(ref.current);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [fetch_]);
  // 분석 데이터: 탭 전환 시 또는 serverId 변경 시에만 로드 (초기 로드 시 안 함 → 성능 개선)
  useEffect(() => { if (tab === 'analysis') fetchAnaWithLoading(); }, [tab, fetchAna]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 종합 KPI (3분류: SSH / DT전용 / DT공유) ──
  const totGpu = data.reduce((a, e) => a + (e.metrics?.gpus?.length || 0), 0);
  const online = data.filter(e => e.metrics && !e.metrics.error).length;
  const totLlm = data.reduce((a, e) => a + (e.metrics?.llmEndpoints?.length || 0), 0);
  // totTps — 3분류 KPI에서 각각 계산

  const bottleneckLabel = (b: string | null) => ({ throughput: t('resourceMonitor.kpi.throughput'), kvMemory: t('resourceMonitor.serverCard.benchmarkKvMemory'), concurrency: t('resourceMonitor.kpi.concurrent') }[b || ''] || '-');

  // 3분류 KPI 계산 함수
  const calcGroupKpi = (entries: RealtimeEntry[]) => {
    const withCa = entries.filter(e => e.capacityAnalysis?.compositeCapacity != null);
    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, v) => a + v, 0) / arr.length * 10) / 10 : null;
    const composite = avg(withCa.map(e => e.capacityAnalysis!.compositeCapacity!));
    const tokPct = avg(withCa.filter(e => e.capacityAnalysis!.tokPct != null).map(e => e.capacityAnalysis!.tokPct!));
    const kvPct = avg(withCa.filter(e => e.capacityAnalysis!.kvPct != null).map(e => e.capacityAnalysis!.kvPct!));
    const concPct = avg(withCa.filter(e => e.capacityAnalysis!.concPct != null).map(e => e.capacityAnalysis!.concPct!));
    const tps = Math.round(entries.reduce((a, e) => a + ((e.capacityAnalysis || e.throughputAnalysis)?.currentTps || 0), 0) * 10) / 10;
    const bots = withCa.filter(e => e.capacityAnalysis?.bottleneck).map(e => e.capacityAnalysis!.bottleneck!);
    const counts = { throughput: 0, kvMemory: 0, concurrency: 0 };
    bots.forEach(b => counts[b]++);
    const bottleneck = bots.length > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : null;
    return { composite, headroom: composite != null ? Math.round((100 - composite) * 10) / 10 : null, tokPct, kvPct, concPct, tps, bottleneck, count: entries.length };
  };
  const kpiSsh = calcGroupKpi(data.filter(e => !e.server.isLocal && e.server.sshPort > 0));
  const kpiDedicated = calcGroupKpi(data.filter(e => !e.server.isLocal && e.server.sshPort === 0 && (e.metrics?.llmEndpoints || []).some(ep => !ep.containerName?.startsWith('shared-'))));
  const kpiShared = calcGroupKpi(data.filter(e => !e.server.isLocal && e.server.sshPort === 0 && (e.metrics?.llmEndpoints || []).every(ep => ep.containerName?.startsWith('shared-') || !ep.containerName)));

  // 레거시 호환 (분석 탭 등에서 사용)
  const avgComposite = (() => { const h = data.filter(e => e.capacityAnalysis?.compositeCapacity != null).map(e => e.capacityAnalysis!.compositeCapacity!); return h.length > 0 ? Math.round(h.reduce((a, v) => a + v, 0) / h.length * 10) / 10 : null; })();
  // 레거시 변수 — 영업일 평균 섹션에서 사용
  void avgComposite; // 영업일 평균 계산에서 참조
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
      alert(e?.response?.data?.error || t('resourceMonitor.saveFailed'));
    }
  };

  if (loading) return <LoadingSpinner />;

  return (<div className="space-y-4">
    {/* Header */}
    <div className="flex items-center justify-between">
      <div><h1 className="text-base font-bold text-gray-900 flex items-center gap-1.5"><Server className="w-4 h-4 text-blue-600" />{t('resourceMonitor.header.title')}</h1>
        <p className="text-[10px] text-gray-400 mt-0.5">{t('resourceMonitor.header.subtitle')}{updated && <span className="ml-1">| {updated.toLocaleTimeString('ko-KR')}</span>}</p></div>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setGuideOpen(true)} className="flex items-center gap-1 px-2 py-1.5 text-[10px] text-gray-500 hover:text-blue-600 rounded hover:bg-blue-50 border border-gray-200" title={t('resourceMonitor.header.guideBtn')}>
          <BarChart3 className="w-3 h-3" />{t('resourceMonitor.header.guideBtn')}
        </button>
        <button onClick={fetch_} className="p-1.5 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"><RefreshCw className="w-3.5 h-3.5" /></button>
        <button onClick={() => { setEdit(null); setTestR(null); setModal(true); }} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700"><Plus className="w-3.5 h-3.5" />{t('resourceMonitor.header.addServer')}</button>
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
              <p className="text-xs font-bold text-gray-900">{t('resourceMonitor.prediction.title')}</p>
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <span>{t('resourceMonitor.prediction.basedOn', { date: new Date(pred.date).toLocaleDateString('ko-KR') })}</span>
                <span>|</span>
                {targetEdit ? (
                  <span className="flex items-center gap-1">
                    <span>{t('resourceMonitor.prediction.target')}</span>
                    <input type="number" min={100} max={500000} value={targetVal} onChange={e => setTargetVal(e.target.value)} className="w-20 px-1 py-0.5 border rounded text-[10px] text-center" />
                    <span>{t('resourceMonitor.prediction.personUnit')}</span>
                    <button disabled={targetSaving} onClick={async () => {
                      const n = parseInt(targetVal);
                      if (isNaN(n) || n < 100 || n > 500000) { alert(t('resourceMonitor.prediction.targetRange')); return; }
                      setTargetSaving(true);
                      try { await gpuCapacityApi.updateSettings({ targetUserCount: n }); setTargetEdit(false); setPredRunning(true); const r = await gpuCapacityApi.run(); setPred(r.data.prediction); } catch (e: any) { alert(e?.response?.data?.error || t('resourceMonitor.failed')); } finally { setTargetSaving(false); setPredRunning(false); }
                    }} className="px-1.5 py-0.5 bg-indigo-600 text-white rounded text-[9px] hover:bg-indigo-700 disabled:opacity-50">{targetSaving ? t('resourceMonitor.prediction.savingAndAnalyzing') : t('resourceMonitor.prediction.saveAndReanalyze')}</button>
                    <button onClick={() => setTargetEdit(false)} className="text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
                  </span>
                ) : (
                  <button onClick={() => { setTargetVal(String(pred.targetUserCount || 15000)); setTargetEdit(true); }} className="text-indigo-600 hover:text-indigo-800 underline decoration-dotted">{t('resourceMonitor.prediction.targetEdit', { count: pred.targetUserCount?.toLocaleString() })} ✏️</button>
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
                  alert(t('resourceMonitor.prediction.analysisInProgress'));
                } else {
                  alert(e?.response?.data?.error || t('resourceMonitor.failed'));
                }
              } finally { setPredRunning(false); }
            }} disabled={predRunning} className="text-[10px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50">{predRunning ? t('resourceMonitor.prediction.analyzingAutoUpdate') : t('resourceMonitor.prediction.rerunPrediction')}</button>
            <button onClick={async () => {
              try { await gpuCapacityApi.refreshBenchmarks(); alert(t('resourceMonitor.prediction.refreshBenchmarksComplete')); fetch_(); } catch (e: any) { alert(e?.response?.data?.error || t('resourceMonitor.prediction.refreshBenchmarksFailed')); }
            }} className="text-[10px] text-emerald-600 hover:text-emerald-800">{t('resourceMonitor.prediction.refreshBenchmarks')}</button>
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
              <p className="font-bold text-amber-800 text-xs flex items-center gap-1">⚠ {t('resourceMonitor.prediction.estimationNotice')}</p>
              <button onClick={() => { if (!noticeEdit && !noticeText) setNoticeText(defaultNotice); setNoticeEdit(!noticeEdit); }} className="text-[9px] text-amber-600 hover:text-amber-800 underline">{noticeEdit ? t('resourceMonitor.prediction.closeNotice') : t('resourceMonitor.prediction.editNotice')}</button>
            </div>
            {noticeEdit ? (
              <div className="space-y-1">
                <textarea value={noticeText} onChange={e => setNoticeText(e.target.value)} rows={5} className="w-full px-2 py-1 border rounded text-[10px] font-mono" placeholder={t('resourceMonitor.prediction.markdownPlaceholder')} />
                <div className="flex gap-2">
                  <button onClick={async () => {
                    try {
                      await gpuCapacityApi.updateSettings({ notice: noticeText } as any);
                      setNoticeEdit(false);
                      fetch_();
                    } catch { alert(t('resourceMonitor.saveFailed')); }
                  }} className="px-2 py-0.5 bg-amber-600 text-white rounded text-[9px]">{t('resourceMonitor.prediction.saveNotice')}</button>
                  <button onClick={() => { setNoticeText(defaultNotice); }} className="px-2 py-0.5 bg-gray-200 rounded text-[9px]">{t('resourceMonitor.prediction.restoreDefault')}</button>
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
            <p className="text-[10px] font-bold text-orange-700 mb-2">📊 {t('resourceMonitor.prediction.peakShortage')} <span className="font-normal text-gray-400">{t('resourceMonitor.prediction.peakShortage7d')}</span></p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="cursor-help" title={t('resourceMonitor.prediction.peakKvTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.peakKvCache')} ⓘ</p><p className={`text-lg font-bold ${peakShort.peakKvMax >= 80 ? 'text-red-600' : peakShort.peakKvMax >= 60 ? 'text-amber-600' : 'text-emerald-600'}`}>{peakShort.peakKvMax ?? '-'}%</p></div>
              <div className="cursor-help" title={t('resourceMonitor.prediction.waitingFrequencyTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.waitingFrequency')} ⓘ</p><p className={`text-lg font-bold ${peakShort.waitingFrequencyPct >= 30 ? 'text-red-600' : 'text-emerald-600'}`}>{peakShort.waitingFrequencyPct ?? 0}%</p></div>
              <div className="cursor-help" title={t('resourceMonitor.prediction.peakShortVramTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.peakShortVram')} ⓘ</p><p className={`text-lg font-bold ${peakShort.gapVram > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{peakShort.gapVram > 0 ? `+${peakShort.gapVram}` : '0'}<span className="text-[9px] font-normal text-gray-400 ml-0.5">GB</span></p></div>
              <div className="cursor-help" title={t('resourceMonitor.prediction.immediateNeedTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.immediateNeed')} ⓘ</p><p className={`text-xl font-black ${peakShort.b300Units > 0 ? 'text-red-700' : 'text-emerald-600'}`}>{peakShort.b300Units || 0}<span className="text-xs font-normal text-gray-500 ml-0.5">B300</span></p></div>
            </div>
            {peakShort.isShort && peakShort.reasons?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {peakShort.reasons.map((r: string, i: number) => <span key={i} className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[9px] font-semibold cursor-help" title={r.includes('KV cache') ? t('resourceMonitor.prediction.kvCacheTooltipShort') : r.includes('대기 요청') || r.includes('Waiting') ? t('resourceMonitor.prediction.waitingTooltipShort') : r.includes('Preemption') ? t('resourceMonitor.prediction.preemptionTooltipShort') : r}>⚠ {r}</span>)}
              </div>
            )}
            {!peakShort.isShort && <p className="text-[9px] text-emerald-600 mt-1">✅ {t('resourceMonitor.prediction.peakOk')}</p>}
          </div>
          {/* 목표 인원 기준 */}
          <div className="bg-white/80 rounded-lg p-3 border border-indigo-200">
            <p className="text-[10px] font-bold text-indigo-700 mb-2">🎯 {t('resourceMonitor.prediction.targetShortage', { count: pred.targetUserCount?.toLocaleString() })}</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="cursor-help" title={t('resourceMonitor.prediction.currentVramTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.currentVram')} ⓘ</p><p className="text-lg font-bold text-gray-900">{Math.round(pred.currentTotalVramGb)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">GB</span></p></div>
              <div className="cursor-help" title={t('resourceMonitor.prediction.requiredVramTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.requiredVram')} ⓘ</p><p className="text-lg font-bold text-indigo-700">{Math.round(pred.predictedTotalVramGb)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">GB</span></p><p className="text-[9px] text-gray-400">+{Math.round(pred.gapVramGb)}GB</p></div>
              <div className="cursor-help" title={t('resourceMonitor.prediction.additionalNeededTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.additionalNeeded')} ⓘ</p><p className="text-xl font-black text-indigo-700">{pred.predictedB300Units}<span className="text-xs font-normal text-gray-500 ml-0.5">B300</span></p><p className="text-[9px] text-gray-400">(192GB/{t('resourceMonitor.unitB300')})</p></div>
            </div>
          </div>
        </div>

        {/* 포화 시점 + 사용자 현황 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
          <div className="bg-white/60 rounded-lg p-2 border border-gray-100">
            <p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.currentUsers')}</p>
            <p className="text-lg font-bold text-gray-900">{pred.currentUsers?.toLocaleString()}<span className="text-[9px] text-gray-400 ml-0.5">{t('resourceMonitor.prediction.personUnit')}</span></p>
            <p className="text-[9px] text-gray-400">DAU {Math.round(pred.currentDau)}</p>
          </div>
          {cd.scaling?.weeksUntilSaturated != null && (
            <div className={`rounded-lg p-2 border cursor-help ${cd.scaling.weeksUntilSaturated === 0 ? 'bg-red-100 border-red-300' : 'bg-red-50 border-red-200'}`} title={t('resourceMonitor.prediction.saturationTooltip')}>
              <p className="text-[9px] text-red-600 font-semibold">{t('resourceMonitor.prediction.saturationEstimate')} ⓘ</p>
              <p className="text-lg font-black text-red-700">{cd.scaling.weeksUntilSaturated === 0 ? t('resourceMonitor.prediction.saturationImmediate') : t('resourceMonitor.prediction.saturationWeeks', { count: cd.scaling.weeksUntilSaturated })}</p>
              <p className="text-[9px] text-red-500">{cd.scaling.weeksUntilSaturated === 0 ? t('resourceMonitor.prediction.saturationAlready') : t('resourceMonitor.prediction.saturationGrowth')}</p>
            </div>
          )}
          <div className="bg-white/60 rounded-lg p-2 border border-gray-100 cursor-help" title={t('resourceMonitor.prediction.scalingRatioTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.scalingRatio')} ⓘ</p><p className="text-lg font-bold text-gray-900">x{cd.growth?.growthAdjustedScaling || cd.scaling?.scalingFactor || '-'}</p><p className="text-[9px] text-gray-400">{t('resourceMonitor.prediction.sixMonthGrowth')}</p></div>
          {cd.dimensionalBreakdown && <div className="bg-white/60 rounded-lg p-2 border border-gray-100 cursor-help" title={t('resourceMonitor.prediction.bottleneckDimTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.compositeCapacity')} ⓘ</p><p className="text-lg font-bold text-blue-600">{bottleneckLabel(cd.dimensionalBreakdown.bottleneck)}<span className="text-xs font-normal text-gray-400 ml-1">{t('resourceMonitor.prediction.bottleneckDimLabel')}</span></p></div>}
          {cd.dimensionalBreakdown?.bottleneck && <div className="bg-white/60 rounded-lg p-2 border border-gray-100 cursor-help" title={t('resourceMonitor.prediction.bottleneckDimTooltip')}><p className="text-[9px] text-gray-500">{t('resourceMonitor.prediction.bottleneckDimLabel')} ⓘ</p><p className="text-lg font-bold text-orange-600">{bottleneckLabel(cd.dimensionalBreakdown.bottleneck)}</p></div>}
        </div>

        {/* 배포 모델 분포 */}
        {cd.modelBreakdown?.length > 0 && (
          <div className="mb-2">
            <p className="text-[9px] font-bold text-gray-700 mb-1">{t('resourceMonitor.prediction.deployedModels')}</p>
            <div className="flex flex-wrap gap-1">
              {cd.modelBreakdown.map((m: any, i: number) => (
                <span key={i} className="px-2 py-1 bg-white/70 rounded-lg text-[9px] border border-gray-200" title={`params: ${m.params || '?'}B | avg ${m.avgTps} tok/s | max ${m.theoreticalMaxTps} tok/s | bw max ${m.bandwidthMaxTps || '?'} tok/s | GPU ${m.gpuCount}`}>
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
            <span className="text-gray-500 cursor-help" title={t('resourceMonitor.prediction.tokenGrowthPerUserTooltip')}>{t('resourceMonitor.prediction.tokenGrowthPerUser')} <b>{cd.growth.tokensPerUserGrowthRate}%</b>{t('resourceMonitor.perWeek')} ⓘ</span>
            <span className="text-gray-500 cursor-help" title={t('resourceMonitor.prediction.tokenGrowth6moTooltip')}>{t('resourceMonitor.prediction.tokenGrowth6mo')} <b>x{cd.growth.tokenGrowthMultiplier6mo || cd.growth.growthMultiplier6mo}</b> ⓘ</span>
            {cd.inputs?.errorRate > 0 && <span className="text-gray-500 cursor-help" title={t('resourceMonitor.prediction.errorRateTooltip')}>{t('resourceMonitor.prediction.errorRate')} <b className={cd.inputs.errorRate > 5 ? 'text-red-600' : 'text-gray-700'}>{cd.inputs.errorRate}%</b> ⓘ</span>}
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
            <p className="text-[9px] font-bold text-gray-700">{t('resourceMonitor.prediction.unmonitoredEquip')} <span className="font-normal text-gray-400">{t('resourceMonitor.prediction.unmonitoredEquipDesc')}</span></p>
            <button onClick={async () => {
              if (!fleetEdit) {
                try { const r = await gpuCapacityApi.getSettings(); setFleetList(r.data.unmonitoredFleet || []); } catch {}
              }
              setFleetEdit(!fleetEdit);
            }} className="text-[9px] text-indigo-600 hover:text-indigo-800 underline decoration-dotted">{fleetEdit ? t('resourceMonitor.prediction.closeFleet') : t('resourceMonitor.prediction.editFleet')}</button>
          </div>
          {/* 현재 등록된 미연결 장비 표시 */}
          {cd.unmonitoredFleet?.length > 0 && !fleetEdit && (
            <div className="flex flex-wrap gap-1">
              {cd.unmonitoredFleet.map((f: any, i: number) => (
                <span key={i} className="px-2 py-1 bg-amber-50 rounded-lg text-[9px] border border-amber-200 cursor-help" title={`${t('resourceMonitor.prediction.unmonitoredTooltip')}\nVRAM: ${f.totalVramGb || f.count * (f.vramGb || 80)}GB`}>
                  <b>{f.type}</b> ×{f.count} <span className="text-amber-600">({f.label || t('resourceMonitor.prediction.unmonitoredLabel')})</span>
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
                  <input type="number" min={0} value={f.count} onChange={e => { const nl = [...fleetList]; nl[i] = { ...f, count: parseInt(e.target.value) || 0 }; setFleetList(nl); }} className="w-16 px-1.5 py-1 border rounded text-[10px] text-center" placeholder={t('resourceMonitor.prediction.quantity')} />
                  <span className="text-gray-400">{t('resourceMonitor.prediction.unitCount')}</span>
                  <input value={f.label} onChange={e => { const nl = [...fleetList]; nl[i] = { ...f, label: e.target.value }; setFleetList(nl); }} className="flex-1 px-1.5 py-1 border rounded text-[10px]" placeholder={t('resourceMonitor.prediction.labelPlaceholder')} />
                  <button onClick={() => setFleetList(fleetList.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-xs">×</button>
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={() => setFleetList([...fleetList, { type: 'H200', count: 0, label: '', vramGb: 141 }])} className="px-2 py-1 text-[9px] bg-gray-100 rounded hover:bg-gray-200">{t('resourceMonitor.prediction.addEquipment')}</button>
                <button disabled={fleetSaving} onClick={async () => {
                  setFleetSaving(true);
                  try {
                    await gpuCapacityApi.updateSettings({ unmonitoredFleet: fleetList.filter(f => f.count > 0) });
                    setFleetEdit(false);
                    // 재분석
                    setPredRunning(true);
                    const r = await gpuCapacityApi.run();
                    setPred(r.data.prediction);
                  } catch (e: any) { alert(e?.response?.data?.error || t('resourceMonitor.failed')); }
                  finally { setFleetSaving(false); setPredRunning(false); }
                }} className="px-2 py-1 text-[9px] bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">{fleetSaving ? t('resourceMonitor.prediction.savingAndRerunning') : t('resourceMonitor.prediction.saveAndRerun')}</button>
              </div>
            </div>
          )}
        </div>

        {/* 계산 논리 */}
        {cd && (
          <details className="text-[10px]">
            <summary className="cursor-pointer text-indigo-600 font-medium hover:text-indigo-800">{t('resourceMonitor.prediction.viewCalculation')}</summary>
            <div className="mt-2 p-2 bg-white/70 rounded-lg space-y-1 text-gray-600">
              <p><b>{t('resourceMonitor.prediction.calcScaling')}</b> DAU {(cd.inputs?.dauRatio * 100).toFixed(1)}% → x{cd.scaling?.scalingFactor} × token growth x{cd.growth?.tokenGrowthMultiplier6mo || cd.growth?.growthMultiplier6mo} = <b>x{cd.growth?.growthAdjustedScaling}</b></p>
              <p className="text-[9px] text-gray-400 ml-2">{t('resourceMonitor.prediction.calcDauNote')}</p>
              <p><b>{t('resourceMonitor.prediction.calcMethodA')}</b> {t('resourceMonitor.prediction.calcMethodADesc')} <b>B300 {cd.methodA?.b300 ?? cd.methodA?.totalVramA}{t('resourceMonitor.unitB300')}</b></p>
              {cd.methodA?.detail && <p className="text-[9px] text-gray-400 ml-2">{cd.methodA.detail}</p>}
              <p><b>{t('resourceMonitor.prediction.calcMethodB')}</b> {t('resourceMonitor.prediction.calcMethodBDesc')} <b>B300 {cd.methodB?.b300 ?? '?'}{t('resourceMonitor.unitB300')}</b> {cd.methodB?.totalVramNeeded ? `(${cd.methodB.totalVramNeeded}GB)` : ''}</p>
              <p><b>{t('resourceMonitor.prediction.calcFinal')}</b> max(A,B) × safety {pred.safetyMargin} × error {cd.scaling?.errorMargin} = <b>B300 {pred.predictedB300Units}{t('resourceMonitor.unitB300')}</b> ({Math.round(pred.predictedTotalVramGb)}GB)</p>
              {cd.inputs?.detectedModels?.length > 0 && <p><b>{t('resourceMonitor.prediction.detectedModels')}</b> {cd.inputs.detectedModels.join(', ')}</p>}
              {cd.modelBreakdown?.length > 0 && <div><b>{t('resourceMonitor.prediction.perModelLabel')}</b><ul className="list-disc ml-4">{cd.modelBreakdown.map((m: any, i: number) => <li key={i}>{m.name}: {m.params || '?'}B ({m.precision}), throughput {m.tpsRatio}%, max {m.theoreticalMaxTps} tok/s, GPU {m.gpuCount}</li>)}</ul></div>}
              {cd.confidenceIssues?.length > 0 && <p className="text-amber-600"><b>{t('resourceMonitor.prediction.caution')}</b> {cd.confidenceIssues.join(', ')}</p>}
              {cd.recommendations?.length > 0 && <div className="mt-1"><b>{t('resourceMonitor.prediction.recommendationsLabel')}</b><ul className="list-disc ml-4">{cd.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></div>}
              {/* 월별 예측 테이블 */}
              {cd.monthlyForecast?.length > 0 && (
                <div className="mt-3 pt-2 border-t border-gray-200">
                  <p className="font-bold text-gray-700 mb-1">📅 {t('resourceMonitor.prediction.monthlyForecast')}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[9px] border-collapse">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="px-2 py-1 text-left border border-gray-200 font-semibold">{t('resourceMonitor.prediction.monthCol')}</th>
                          <th className="px-2 py-1 text-right border border-gray-200 font-semibold cursor-help" title={t('resourceMonitor.prediction.tokenGrowthColTooltip')}>{t('resourceMonitor.prediction.tokenGrowthCol')}</th>
                          <th className="px-2 py-1 text-right border border-gray-200 font-semibold cursor-help" title={t('resourceMonitor.prediction.growthOnlyB300Tooltip')}>{t('resourceMonitor.prediction.growthOnlyB300')}</th>
                          <th className="px-2 py-1 text-right border border-gray-200 font-semibold cursor-help" title={t('resourceMonitor.prediction.targetB300Tooltip')}>{t('resourceMonitor.prediction.targetB300')}</th>
                          <th className="px-2 py-1 text-right border border-gray-200 font-semibold cursor-help" title={t('resourceMonitor.prediction.requiredVramColTooltip')}>{t('resourceMonitor.prediction.requiredVramCol')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cd.monthlyForecast.map((f: any, i: number) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-2 py-1 border border-gray-200 font-medium">{f.month}</td>
                            <td className="px-2 py-1 border border-gray-200 text-right">x{f.tokenGrowthMultiplier}</td>
                            <td className={`px-2 py-1 border border-gray-200 text-right font-bold ${f.growthOnlyB300 > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>+{f.growthOnlyB300}{t('resourceMonitor.unitB300')}</td>
                            <td className={`px-2 py-1 border border-gray-200 text-right font-bold ${f.b300Units > 0 ? 'text-indigo-700' : 'text-emerald-600'}`}>+{f.b300Units}{t('resourceMonitor.unitB300')}</td>
                            <td className="px-2 py-1 border border-gray-200 text-right">{f.predictedVramGb?.toLocaleString()}GB</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[8px] text-gray-400 mt-1">{t('resourceMonitor.prediction.safetyNote')}</p>
                </div>
              )}
            </div>
          </details>
        )}
        {/* AI 분석 — 2탭: 기술 분석 + 경영 보고서 */}
        {pred.aiAnalysis && pred.modelId !== 'none' && (
          <details className="text-[10px] mt-1">
            <summary className="cursor-pointer text-purple-600 font-medium hover:text-purple-800">{t('resourceMonitor.prediction.aiAnalysisReport')}</summary>
            <div className="mt-2 space-y-2">
              {/* 경영 보고서 (비전문가용) */}
              {cd.executiveReport && (
                <div className="p-3 bg-blue-50/80 rounded-lg border border-blue-200">
                  <p className="text-[10px] font-bold text-blue-700 mb-1">{t('resourceMonitor.prediction.executiveReport')}</p>
                  <div className="text-gray-700 text-[11px] leading-snug" dangerouslySetInnerHTML={{ __html: mdToHtml(cd.executiveReport || '') }} />
                </div>
              )}
              {/* 기술 분석 (전문가용) */}
              <div className="p-3 bg-white/70 rounded-lg">
                <p className="text-[10px] font-bold text-purple-700 mb-1">{t('resourceMonitor.prediction.technicalAnalysis')}</p>
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
          <p className="text-[9px] text-gray-500">{t('resourceMonitor.kpi.compositeDesc')}</p>
        </div>
        {/* 실시간 3분류 */}
        <div className="px-3 pt-1">
          <p className="text-[9px] font-bold text-blue-600 mb-1">{t('resourceMonitor.kpi.realtimeCurrent')}</p>
        </div>
        <div className="px-3 pb-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { kpi: kpiSsh, label: t('resourceMonitor.kpi.sshServer'), unit: t('resourceMonitor.kpi.unitServers'), from: 'from-emerald-50', to: 'to-teal-50', border: 'border-emerald-200', color: 'text-emerald-700', sub: 'text-emerald-500' },
            { kpi: kpiDedicated, label: t('resourceMonitor.kpi.dtDedicated'), unit: t('resourceMonitor.kpi.unitNodes'), from: 'from-blue-50', to: 'to-indigo-50', border: 'border-blue-200', color: 'text-blue-700', sub: 'text-blue-400' },
            { kpi: kpiShared, label: t('resourceMonitor.kpi.dtShared'), unit: t('resourceMonitor.kpi.unitNodes'), from: 'from-purple-50', to: 'to-fuchsia-50', border: 'border-purple-200', color: 'text-purple-700', sub: 'text-purple-400' },
          ].filter(g => g.kpi.count > 0).map(({ kpi, label, unit, from, to, border, color, sub }) => (
            <div key={label} className={`bg-gradient-to-br ${from} ${to} rounded-lg p-2.5 border ${border}`}>
              <div className="flex items-center justify-between mb-1">
                <p className={`text-[9px] font-bold ${color}`}>{label} <span className={`font-normal ${sub}`}>({kpi.count}{unit})</span></p>
                {kpi.bottleneck && <span className="text-[8px] text-orange-500">{t('resourceMonitor.kpi.bottleneckPrefix')} {bottleneckLabel(kpi.bottleneck)}</span>}
              </div>
              <div className="flex items-end gap-2.5">
                <div><p className="text-[7px] text-gray-400">{t('resourceMonitor.kpi.composite')}</p><p className={`text-lg font-black ${kpi.composite != null ? utilTxt(kpi.composite) : 'text-gray-300'}`}>{kpi.composite ?? '-'}%</p></div>
                <div><p className="text-[7px] text-gray-400">{t('resourceMonitor.kpi.headroom')}</p><p className={`text-lg font-black ${kpi.headroom != null ? (kpi.headroom <= 20 ? 'text-red-600' : 'text-emerald-600') : 'text-gray-300'}`}>{kpi.headroom ?? '-'}%</p></div>
                <div><p className="text-[7px] text-gray-400">tok/s</p><p className="text-lg font-black text-blue-600">{kpi.tps > 0 ? kpi.tps : '-'}</p></div>
              </div>
              <div className="flex gap-2 mt-1 text-[7px] text-gray-400">
                <span>{t('resourceMonitor.kpi.throughput')} <b className="text-gray-600">{kpi.tokPct ?? '-'}%</b></span>
                <span>KV <b className={`${(kpi.kvPct || 0) >= 80 ? 'text-red-600' : (kpi.kvPct || 0) >= 50 ? 'text-amber-600' : 'text-gray-600'}`}>{kpi.kvPct ?? '-'}%</b></span>
                <span>{t('resourceMonitor.kpi.concurrent')} <b className="text-gray-600">{kpi.concPct ?? '-'}%</b></span>
              </div>
            </div>
          ))}
        </div>
        {/* 인프라 요약 (한 줄) */}
        <div className="px-3 pb-2">
          <div className="flex items-center gap-3 text-[9px] text-gray-500">
            <span>{t('resourceMonitor.kpi.serverSummary', { gpu: totGpu, llm: totLlm, online, total: data.length })}</span>
            <span>CPU <b>{avgCpu ?? '-'}%</b></span>
            <span>RAM <b>{avgRam ?? '-'}%</b></span>
            <span>Disk <b>{avgDisk ?? '-'}%</b></span>
          </div>
        </div>
        {/* 영업일 평균 3분류 */}
        <div className="px-3 pt-1 border-t border-gray-100">
          <p className="text-[9px] font-bold text-emerald-600 mb-1">{t('resourceMonitor.kpi.businessHoursAvg', { days: anaDays })} <span className="font-normal text-gray-400">{ana?.businessHours?.sampleCount || 0}</span></p>
        </div>
        {(() => {
          const bh = ana?.businessHours;
          if (!bh) return <div className="px-3 pb-3 text-[9px] text-gray-400">{t('resourceMonitor.kpi.noAnalysisData')}</div>;

          // 3분류별 벤치마크 합산
          const calcBhGroup = (entries: RealtimeEntry[]) => {
            const bmTps = entries.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakTps || 0), 0);
            const bmConc = entries.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakConcurrent || 0), 0);
            const tokPct = (bh.avgTps && bmTps > 0) ? Math.round((bh.avgTps / bmTps) * 1000) / 10 : null;
            const kvPct = bh.avgKvCache ?? null;
            const conc = (bh.avgRunningReqs || 0) + (bh.avgWaitingReqs || 0);
            const concPct = (bmConc > 0 && conc > 0) ? Math.round((conc / bmConc) * 1000) / 10 : null;
            const composite = Math.max(tokPct || 0, kvPct || 0, concPct || 0) || null;
            return { composite, headroom: composite != null ? Math.round((100 - composite) * 10) / 10 : null, tokPct, kvPct, concPct, tps: bh.avgTps, gpu: bh.avgGpuUtil, wait: bh.avgWaitingReqs };
          };
          const bhSsh = calcBhGroup(data.filter(e => !e.server.isLocal && e.server.sshPort > 0));
          const bhDedicated = calcBhGroup(data.filter(e => !e.server.isLocal && e.server.sshPort === 0 && (e.metrics?.llmEndpoints || []).some(ep => !ep.containerName?.startsWith('shared-'))));
          const bhShared = calcBhGroup(data.filter(e => !e.server.isLocal && e.server.sshPort === 0 && (e.metrics?.llmEndpoints || []).every(ep => ep.containerName?.startsWith('shared-') || !ep.containerName)));

          return (
        <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { kpi: bhSsh, label: t('resourceMonitor.kpi.sshServer'), count: data.filter(e => !e.server.isLocal && e.server.sshPort > 0).length, border: 'border-emerald-100', bg: 'bg-emerald-50/50', color: 'text-emerald-700' },
            { kpi: bhDedicated, label: t('resourceMonitor.kpi.dtDedicated'), count: data.filter(e => !e.server.isLocal && e.server.sshPort === 0 && (e.metrics?.llmEndpoints || []).some(ep => !ep.containerName?.startsWith('shared-'))).length, border: 'border-blue-100', bg: 'bg-blue-50/50', color: 'text-blue-700' },
            { kpi: bhShared, label: t('resourceMonitor.kpi.dtShared'), count: data.filter(e => !e.server.isLocal && e.server.sshPort === 0 && (e.metrics?.llmEndpoints || []).every(ep => ep.containerName?.startsWith('shared-') || !ep.containerName)).length, border: 'border-purple-100', bg: 'bg-purple-50/50', color: 'text-purple-700' },
          ].filter(g => g.count > 0).map(({ kpi, label, border, bg, color }) => (
            <div key={label} className={`${bg} rounded-lg p-2 border ${border}`}>
              <p className={`text-[8px] font-semibold ${color} mb-1`}>{label}</p>
              <div className="flex items-end gap-2.5">
                <div><p className="text-[7px] text-gray-400">{t('resourceMonitor.kpi.composite')}</p><p className={`text-lg font-black ${kpi.composite != null ? utilTxt(kpi.composite) : 'text-gray-300'}`}>{kpi.composite ?? '-'}%</p></div>
                <div><p className="text-[7px] text-gray-400">{t('resourceMonitor.kpi.headroom')}</p><p className={`text-lg font-black ${kpi.headroom != null ? (kpi.headroom <= 20 ? 'text-red-600' : 'text-emerald-600') : 'text-gray-300'}`}>{kpi.headroom ?? '-'}%</p></div>
                <div><p className="text-[7px] text-gray-400">tok/s</p><p className="text-lg font-black text-blue-600">{kpi.tps ?? '-'}</p></div>
              </div>
              <div className="flex gap-2 mt-1 text-[7px] text-gray-400">
                <span>{t('resourceMonitor.kpi.throughput')} <b className="text-gray-600">{kpi.tokPct ?? '-'}%</b></span>
                <span>KV <b className={`${(kpi.kvPct || 0) >= 80 ? 'text-red-600' : 'text-gray-600'}`}>{kpi.kvPct ?? '-'}%</b></span>
                <span>{t('resourceMonitor.kpi.concurrentShort')} <b className="text-gray-600">{kpi.concPct ?? '-'}%</b></span>
              </div>
            </div>
          ))}
        </div>
          );
        })()}
      </div>
    )}

    {/* Tabs */}
    {data.length > 0 && (
      <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5 w-fit text-xs">
        <button onClick={() => setTab('live')} className={`px-3 py-1 rounded-md ${tab === 'live' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500'}`}>{t('resourceMonitor.tabs.live')}</button>
        <button onClick={() => setTab('analysis')} className={`px-3 py-1 rounded-md ${tab === 'analysis' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500'}`}>{t('resourceMonitor.tabs.analysis')}</button>
      </div>
    )}

    {/* Live Tab */}
    {tab === 'live' && (data.length === 0 ? (
      <div className="bg-white rounded-lg border p-10 text-center"><Server className="w-10 h-10 text-gray-200 mx-auto mb-2" /><p className="text-xs text-gray-400 mb-3">{t('resourceMonitor.live.noServers')}</p><button onClick={() => { setEdit(null); setTestR(null); setModal(true); }} className="text-xs text-blue-600 hover:underline">{t('resourceMonitor.live.addServer')}</button></div>
    ) : (() => {
      // 3분류: K8s(Prometheus, sshPort=0) / SSH(직접 추가) / 로컬
      const k8sEntries = data.filter(e => !e.server.isLocal && e.server.sshPort === 0);
      const sshEntries = data.filter(e => !e.server.isLocal && e.server.sshPort > 0);
      const localEntries = data.filter(e => e.server.isLocal);

      // K8s: 모델 기준 그룹핑 (LLM 엔드포인트 기반)
      // dedicated/shared 구분 없이 instance(containerName)별로 각각 카드 생성
      const modelMap = new Map<string, ModelGroup>();
      for (const entry of k8sEntries) {
        const eps = entry.metrics?.llmEndpoints || [];
        if (eps.length === 0) continue;
        for (const ep of eps) {
          const instance = ep.containerName || '';
          if (!instance || instance.includes('router') || instance.includes('redis') || instance.includes('litellm')) continue; // 인프라 제외
          const modelName = ep.modelNames?.[0] || instance;
          const isShared = instance.startsWith('shared-');

          const existing = modelMap.get(instance) || {
            modelName,
            instance,
            isShared,
            endpoints: [],
            nodes: [],
          };
          existing.endpoints.push({ entry, ep });
          // 노드 중복 방지
          if (!existing.nodes.some(n => n.name === entry.server.name)) {
            const gpus = entry.metrics?.gpus || [];
            const avgUtil = gpus.length > 0 ? Math.round(gpus.reduce((a, g) => a + g.utilGpu, 0) / gpus.length * 10) / 10 : null;
            existing.nodes.push({ name: entry.server.name, host: entry.server.host, gpuCount: gpus.length, gpuUtil: avgUtil });
          }
          modelMap.set(instance, existing);
        }
      }
      // K8s 노드 중 LLM 없는 서버도 표시 (GPU만 있는 노드)
      const k8sNoLlm = k8sEntries.filter(e => (e.metrics?.llmEndpoints || []).length === 0);

      // 정렬: dedicated 먼저 (GPU 많은 순), shared는 뒤 (이름순)
      const dedicatedGroups = Array.from(modelMap.values()).filter(g => !g.isShared).sort((a, b) => b.nodes.reduce((s, n) => s + n.gpuCount, 0) - a.nodes.reduce((s, n) => s + n.gpuCount, 0));
      const sharedGroups = Array.from(modelMap.values()).filter(g => g.isShared).sort((a, b) => a.modelName.localeCompare(b.modelName));

      const hasK8s = dedicatedGroups.length > 0 || sharedGroups.length > 0 || k8sNoLlm.length > 0;

      return (<div className="space-y-4">
        {/* ── DT Cloud 모델 섹션 ── */}
        {hasK8s && (<div>
          {/* Dedicated 모델 */}
          {dedicatedGroups.length > 0 && (<>
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-semibold text-gray-700">{t('resourceMonitor.live.dtDedicatedModels')}</span>
              <span className="text-[10px] text-gray-400">{t('resourceMonitor.live.modelCount', { count: dedicatedGroups.length })}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
              {dedicatedGroups.map(g => <ModelGroupCard key={g.instance} group={g} />)}
            </div>
          </>)}
          {/* Shared 모델 */}
          {sharedGroups.length > 0 && (<div className={dedicatedGroups.length > 0 ? 'mt-4' : ''}>
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-xs font-semibold text-gray-700">{t('resourceMonitor.live.dtSharedModels')}</span>
              <span className="text-[10px] text-gray-400">{t('resourceMonitor.live.sharedGpu', { count: sharedGroups.length })}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
              {sharedGroups.map(g => <ModelGroupCard key={g.instance} group={g} />)}
            </div>
          </div>)}
          {/* LLM 없는 K8s 노드 */}
          {k8sNoLlm.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
              {k8sNoLlm.map(e => <ServerCard key={e.server.id} entry={e}
                onEdit={() => { setEdit(e.server); setTestR(null); setModal(true); }}
                onCopy={() => { setEdit({ ...e.server, id: '', name: e.server.name + ' ' + i18n.t('resourceMonitor.live.copyName'), host: '' } as any); setTestR(null); setModal(true); }}
                onDelete={async () => { if (confirm(t('resourceMonitor.live.deleteConfirm', { name: e.server.name }))) { try { await gpuServerApi.delete(e.server.id); fetch_(); } catch {} } }}
                onToggle={async () => { try { await gpuServerApi.update(e.server.id, { enabled: !e.server.enabled }); fetch_(); } catch {} }}
              />)}
            </div>
          )}
        </div>)}

        {/* ── SSH 서버 섹션 ── */}
        {sshEntries.length > 0 && (<div>
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-xs font-semibold text-gray-700">{t('resourceMonitor.live.sshServers')}</span>
            <span className="text-[10px] text-gray-400">{t('resourceMonitor.live.sshCount', { count: sshEntries.length })}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {sshEntries.map(e => <ServerCard key={e.server.id} entry={e}
              onEdit={() => { setEdit(e.server); setTestR(null); setModal(true); }}
              onCopy={() => { setEdit({ ...e.server, id: '', name: e.server.name + ' ' + i18n.t('resourceMonitor.live.copyName'), host: '' } as any); setTestR(null); setModal(true); }}
              onDelete={async () => { if (confirm(t('resourceMonitor.live.deleteConfirm', { name: e.server.name }))) { try { await gpuServerApi.delete(e.server.id); fetch_(); } catch {} } }}
              onToggle={async () => { try { await gpuServerApi.update(e.server.id, { enabled: !e.server.enabled }); fetch_(); } catch {} }}
            />)}
          </div>
        </div>)}

        {/* ── 로컬 서버 섹션 ── */}
        {localEntries.length > 0 && (<div>
          <div className="flex items-center gap-2 mb-2">
            <Server className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs font-semibold text-gray-700">{t('resourceMonitor.live.localServers')}</span>
            <span className="text-[10px] text-gray-400">{t('resourceMonitor.live.localCount', { count: localEntries.length })}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {localEntries.map(e => <ServerCard key={e.server.id} entry={e}
              onEdit={() => { setEdit(e.server); setTestR(null); setModal(true); }}
              onCopy={() => { setEdit({ ...e.server, id: '', name: e.server.name + ' ' + i18n.t('resourceMonitor.live.copyName'), host: '' } as any); setTestR(null); setModal(true); }}
              onDelete={async () => { if (confirm(t('resourceMonitor.live.deleteConfirm', { name: e.server.name }))) { try { await gpuServerApi.delete(e.server.id); fetch_(); } catch {} } }}
              onToggle={async () => { try { await gpuServerApi.update(e.server.id, { enabled: !e.server.enabled }); fetch_(); } catch {} }}
            />)}
          </div>
        </div>)}
      </div>);
    })())}

    {/* Analysis Tab */}
    {tab === 'analysis' && (!ana || anaLoading) && (
      <div className="flex items-center justify-center py-20"><div className="text-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-xs text-gray-500">{t('resourceMonitor.analysis.loading')}</p></div></div>
    )}
    {tab === 'analysis' && ana && (<div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-medium text-gray-600">{t('resourceMonitor.analysis.periodLabel', { count: ana.totalSnapshots?.toLocaleString() || 0, serverNote: anaServerId ? '' : t('resourceMonitor.analysis.allServers') })}</span>
        <select value={anaServerId} onChange={e => setAnaServerId(e.target.value)} className="px-2 py-1 text-[10px] border rounded-lg bg-white">
          <option value="">{t('resourceMonitor.analysis.allServersOption')}</option>
          {(() => {
            const k8s = data.filter(e => !e.server.isLocal && e.server.sshPort === 0);
            const dedicatedModels = new Map<string, { modelName: string; serverIds: string[] }>();
            const sharedServerIds = new Set<string>();
            for (const entry of k8s) {
              for (const ep of (entry.metrics?.llmEndpoints || [])) {
                const inst = ep.containerName || '';
                if (!inst || inst.includes('router') || inst.includes('redis') || inst.includes('litellm')) continue; // 인프라 제외
                if (inst.startsWith('shared-')) { sharedServerIds.add(entry.server.id); continue; }
                const existing = dedicatedModels.get(inst) || { modelName: ep.modelNames?.[0] || inst, serverIds: [] };
                if (!existing.serverIds.includes(entry.server.id)) existing.serverIds.push(entry.server.id);
                dedicatedModels.set(inst, existing);
              }
            }
            const sshServers = data.filter(e => !e.server.isLocal && e.server.sshPort > 0);
            return (<>
              {dedicatedModels.size > 0 && <optgroup label={t('resourceMonitor.analysis.dtDedicatedGroup')}>
                {Array.from(dedicatedModels.entries()).map(([inst, { modelName, serverIds }]) =>
                  <option key={inst} value={serverIds.join(',')}>{modelName} ({serverIds.length} {t('resourceMonitor.kpi.unitNodes')})</option>
                )}
              </optgroup>}
              {sharedServerIds.size > 0 && <optgroup label={t('resourceMonitor.analysis.dtSharedGroup')}>
                <option value={Array.from(sharedServerIds).join(',')}>{t('resourceMonitor.analysis.sharedAll', { count: sharedServerIds.size })}</option>
              </optgroup>}
              {sshServers.length > 0 && <optgroup label={t('resourceMonitor.analysis.sshGroup')}>
                {sshServers.map(e => <option key={e.server.id} value={e.server.id}>{e.server.name}</option>)}
              </optgroup>}
            </>);
          })()}
        </select>
      </div>

      {/* ── 시간대별 평균 카드 (기록 없는 날 제외) ── */}
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
            <p className={`text-[10px] font-semibold ${color} mb-2 flex items-center gap-1`}><Clock className="w-3 h-3" />{title} <span className="font-normal text-gray-400">({d.length})</span></p>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1 text-[10px]">
              <div><span className="text-gray-400">tok/s</span><p className="text-lg font-black text-blue-600">{avg(d.filter((x: any) => x.tps > 0).map((x: any) => x.tps)) ?? '-'}</p></div>
              <div><span className="text-gray-400">KV %</span><p className="text-lg font-black text-purple-600">{avg(d.filter((x: any) => x.kv > 0).map((x: any) => x.kv)) ?? '-'}%</p></div>
              <div><span className="text-gray-400">{t('resourceMonitor.analysis.waitingCount')}</span><p className={`text-lg font-black ${(avg(d.map((x: any) => x.wait)) || 0) > 1 ? 'text-red-600' : 'text-emerald-600'}`}>{avg(d.map((x: any) => x.wait)) ?? '0'}</p></div>
              <div><span className="text-gray-400">GPU Util</span><p className="text-lg font-black text-gray-600">{avg(d.filter((x: any) => x.gpu > 0).map((x: any) => x.gpu)) ?? '-'}%</p></div>
              <div><span className="text-gray-300">Preemption</span><p className={`text-sm font-bold ${(avg(d.map((x: any) => x.preempt)) || 0) > 0 ? 'text-red-500' : 'text-emerald-500'}`}>{avg(d.map((x: any) => x.preempt)) ?? '0'}{t('resourceMonitor.analysis.preemptionCount')}</p></div>
              <div><span className="text-gray-300">{t('resourceMonitor.analysis.throughputPct')}</span><p className="text-sm font-bold text-blue-400">{calcPct(d, 'tps', totalBmTps) ?? '-'}%</p></div>
              <div><span className="text-gray-300">KV%</span><p className="text-sm font-bold text-purple-400">{avg(d.filter((x: any) => x.kv > 0).map((x: any) => x.kv)) ?? '-'}%</p></div>
              <div><span className="text-gray-300">{t('resourceMonitor.analysis.concurrentPct')}</span><p className={`text-sm font-bold ${(calcPct(d, 'wait', totalBmConc) || 0) > 100 ? 'text-red-500' : 'text-amber-400'}`}>{calcPct(d, 'wait', totalBmConc) ?? '-'}%</p></div>
            </div>
          </div>
        );

        return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card title={t('resourceMonitor.analysis.peakTime')} color="text-red-600" border="border-red-100" d={peak} />
          <Card title={t('resourceMonitor.analysis.offHours')} color="text-gray-500" border="border-gray-100" d={off} />
          <Card title={t('resourceMonitor.analysis.allDay')} color="text-blue-600" border="border-blue-100" d={all} />
        </div>);
      })()}

      {/* ── 6개 히트맵 (날짜×시간, 30일, 탭 전환) ── */}
      {(() => {
        const hm = (ana.dateHourHeatmap || []) as Array<{ date: string; hour: number; tps: number; kv: number; wait: number; preempt: number; gpu: number }>;
        const dates = [...new Set(hm.map(d => d.date))].sort();
        // hmTab state는 컴포넌트 최상위에 정의됨
        const totalBmTps = data.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakTps || 0), 0);
        const totalBmConc = data.reduce((a, e) => a + (e.capacityAnalysis?.benchmark?.peakConcurrent || 0), 0);

        const tabs: Array<{ key: string; label: string; desc: string; color: (v: number) => string }> = [
          { key: 'tps', label: t('resourceMonitor.analysis.heatmapTps'), desc: t('resourceMonitor.analysis.heatmapTpsDesc'), color: (v: number) => v > 500 ? '#dc2626' : v > 100 ? '#f59e0b' : v > 0 ? '#3b82f6' : '#f3f4f6' },
          { key: 'kv', label: t('resourceMonitor.analysis.heatmapKv'), desc: t('resourceMonitor.analysis.heatmapKvDesc'), color: (v: number) => v >= 80 ? '#dc2626' : v >= 50 ? '#f59e0b' : v > 0 ? '#8b5cf6' : '#f3f4f6' },
          { key: 'wait', label: t('resourceMonitor.analysis.heatmapWait'), desc: t('resourceMonitor.analysis.heatmapWaitDesc'), color: (v: number) => v >= 5 ? '#dc2626' : v >= 1 ? '#f59e0b' : '#10b981' },
          { key: 'preempt', label: t('resourceMonitor.analysis.heatmapPreempt'), desc: t('resourceMonitor.analysis.heatmapPreemptDesc'), color: (v: number) => v >= 3 ? '#dc2626' : v >= 1 ? '#f59e0b' : '#10b981' },
          { key: 'tpsPct', label: t('resourceMonitor.analysis.heatmapTpsPct'), desc: t('resourceMonitor.analysis.heatmapTpsPctDesc'), color: (v: number) => v >= 80 ? '#dc2626' : v >= 50 ? '#f59e0b' : v > 0 ? '#3b82f6' : '#f3f4f6' },
          { key: 'kvPct', label: t('resourceMonitor.analysis.heatmapKvPct'), desc: t('resourceMonitor.analysis.heatmapKvPctDesc'), color: (v: number) => v >= 80 ? '#dc2626' : v >= 50 ? '#f59e0b' : v > 0 ? '#8b5cf6' : '#f3f4f6' },
          { key: 'concPct', label: t('resourceMonitor.analysis.heatmapConcPct'), desc: t('resourceMonitor.analysis.heatmapConcPctDesc'), color: (v: number) => v >= 120 ? '#7f1d1d' : v >= 100 ? '#dc2626' : v >= 50 ? '#f59e0b' : v > 0 ? '#f97316' : '#f3f4f6' },
          { key: 'gpu', label: t('resourceMonitor.analysis.heatmapGpu'), desc: t('resourceMonitor.analysis.heatmapGpuDesc'), color: (v: number) => v >= 90 ? '#dc2626' : v >= 70 ? '#f59e0b' : v > 0 ? '#22c55e' : '#f3f4f6' },
        ];
        const activeTab = tabs.find(t => t.key === hmTab) || tabs[0];

        const getValue = (d: any) => {
          if (hmTab === 'tps') return d.tps;
          if (hmTab === 'kv') return d.kv;
          if (hmTab === 'wait') return d.wait;
          if (hmTab === 'preempt') return d.preempt || 0;
          if (hmTab === 'tpsPct') return totalBmTps > 0 ? Math.round(d.tps / totalBmTps * 1000) / 10 : 0;
          if (hmTab === 'kvPct') return d.kv;
          if (hmTab === 'concPct') return totalBmConc > 0 ? Math.round(d.wait / totalBmConc * 1000) / 10 : 0;
          if (hmTab === 'gpu') return d.gpu || 0;
          return 0;
        };

        return (
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <div className="mb-1">
            <p className="text-[10px] font-semibold text-gray-600 mb-1.5">{t('resourceMonitor.analysis.heatmapTitle')}</p>
            <div className="grid grid-cols-7 gap-0.5 mb-1">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setHmTab(t.key)} className={`py-1.5 text-[10px] rounded font-medium ${hmTab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{t.label}</button>
            ))}
            </div>
          </div>
          <p className="text-[9px] text-gray-500 mb-2">{activeTab.desc}</p>
          <div className="overflow-x-auto">
            <div className="w-full">
              {/* 시간 헤더 */}
              <div className="flex">
                <div className="w-14 shrink-0" />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="flex-1 text-center text-[8px] text-gray-400 font-medium">{h}</div>
                ))}
              </div>
              {/* 날짜 행 */}
              {dates.map(dt => (
                <div key={dt} className="flex items-center">
                  <div className="w-20 shrink-0 text-[8px] text-gray-500 pr-1 text-right">{dt.slice(5)} {(t('resourceMonitor.analysis.dayNames', { returnObjects: true }) as string[])[new Date(dt + 'T00:00:00+09:00').getDay()]}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = hm.find(d => d.date === dt && d.hour === h);
                    const val = cell ? getValue(cell) : 0;
                    const bg = activeTab.color(val);
                    return (
                      <div key={h} className="flex-1 h-7 border border-white/50 cursor-help flex items-center justify-center text-[8px] font-bold" style={{ backgroundColor: bg, color: val > 0 ? (bg === '#dc2626' || bg === '#7f1d1d' ? '#fff' : bg === '#f59e0b' || bg === '#f97316' ? '#fff' : '#1e293b') : '#d1d5db' }} title={`${dt} ${h}h\ntok/s: ${cell?.tps ?? '-'}\nKV: ${cell?.kv ?? '-'}%\n${t('resourceMonitor.analysis.waitingCount')}: ${cell?.wait ?? '-'}\nPreemption: ${cell?.preempt ?? '0'}\nGPU: ${cell?.gpu ?? '-'}%${hmTab.includes('Pct') || hmTab === 'preempt' ? `\n${activeTab.label}: ${val}${hmTab.includes('Pct') ? '%' : ''}` : ''}`}>{val > 0 ? ((hmTab === 'wait' || hmTab === 'preempt') ? Math.round(val) : val >= 1000 ? `${(val/1000).toFixed(1)}k` : val >= 100 ? Math.round(val) : val < 1 ? val.toFixed(1) : Math.round(val)) : ''}</div>
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
    {guideOpen && <GuideBook onClose={() => setGuideOpen(false)} />}
  </div>);
}
