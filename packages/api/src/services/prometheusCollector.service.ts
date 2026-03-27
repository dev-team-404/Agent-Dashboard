/**
 * DTGPT Prometheus Collector Service
 *
 * DTGPT K8s 클러스터의 GPU/LLM 메트릭을 Prometheus API로 수집하여
 * 기존 gpu_metric_snapshots 테이블에 저장.
 * SSH 기반 서버와 동일하게 UI/예측에 자동 반영.
 *
 * 기능:
 * 1. 서버 시작 시 DTGPT 노드를 GpuServer로 자동 등록
 * 2. 과거 vLLM 메트릭 backfill (disable 전 데이터)
 * 3. 실시간 DCGM 메트릭 주기적 수집 (60초)
 * 4. vLLM 메트릭 자동 감지 (복구 시 자동 수집 시작)
 */

import { prisma } from '../index.js';

const PROM_URL = 'https://cloud.dtgpt.samsungds.net/prometheus/api/v1';
const POLL_INTERVAL_MS = 60_000; // 60초
const VLLM_LAST_AVAILABLE = 1774321200; // KST 2026-03-24 12:00 — vLLM 메트릭 마지막 시점
const BACKFILL_STEP = 300; // 5분 간격
const BACKFILL_LOOKBACK_HOURS = 72; // 3일 전부터 backfill
const SERVER_DESC_PREFIX = '[DTGPT-Prometheus]';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let backfillDone = false;

// ── Prometheus API 호출 ──
async function promQuery(query: string, time?: number): Promise<any[]> {
  try {
    const params = new URLSearchParams({ query });
    if (time) params.set('time', String(time));
    const res = await fetch(`${PROM_URL}/query?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data?.data?.result || [];
  } catch { return []; }
}

async function promQueryRange(query: string, start: number, end: number, step: number): Promise<any[]> {
  try {
    const params = new URLSearchParams({ query, start: String(start), end: String(end), step: String(step) });
    const res = await fetch(`${PROM_URL}/query_range?${params}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data?.data?.result || [];
  } catch { return []; }
}

// ── 노드 목록 자동 감지 ──
async function discoverNodes(): Promise<Map<string, { gpuCount: number; pods: string[]; modelName: string }>> {
  const results = await promQuery('DCGM_FI_DEV_FB_USED');
  const nodes = new Map<string, { gpuCount: number; pods: string[]; modelName: string }>();
  type NodeInfo = { gpuCount: number; pods: string[]; modelName: string };

  for (const r of results) {
    const node = r.metric?.node || r.metric?.Hostname || 'unknown';
    const pod = r.metric?.pod || '';
    const gpuModel = r.metric?.modelName || 'NVIDIA H200';
    const existing: NodeInfo = nodes.get(node) || { gpuCount: 0, pods: [], modelName: gpuModel };
    existing.gpuCount++;
    if (pod && !existing.pods.includes(pod)) existing.pods.push(pod);
    nodes.set(node, existing);
  }

  return nodes;
}

// ── GpuServer 자동 등록/갱신 ──
async function ensureServers(nodes: Map<string, any>): Promise<Map<string, string>> {
  const nodeToServerId = new Map<string, string>();

  for (const [nodeName, info] of nodes) {
    const desc = `${SERVER_DESC_PREFIX} ${nodeName} | ${info.gpuCount}x ${info.modelName} | pods: ${info.pods.join(', ')}`;

    // 기존 서버 찾기 (description에 PREFIX + nodeName 포함)
    let server = await prisma.gpuServer.findFirst({
      where: { description: { contains: `${SERVER_DESC_PREFIX} ${nodeName}` } },
    });

    if (!server) {
      server = await prisma.gpuServer.create({
        data: {
          name: `DTGPT-${nodeName}`,
          host: nodeName,
          sshPort: 0, // Prometheus 기반이므로 SSH 미사용
          sshUsername: 'prometheus',
          sshPassword: '',
          description: desc,
          isLocal: false,
          enabled: true,
          pollIntervalSec: 60,
        },
      });
      console.log(`[PromCollector] Created server: ${server.name} (${nodeName})`);
    } else {
      // 설명 업데이트
      await prisma.gpuServer.update({ where: { id: server.id }, data: { description: desc } });
    }

    nodeToServerId.set(nodeName, server.id);
  }

  return nodeToServerId;
}

// ── DCGM 메트릭 → 스냅샷 변환 ──
async function collectDcgmSnapshot(nodeToServerId: Map<string, string>): Promise<void> {
  const [gpuUtil, fbUsed, fbFree, power, dramActive, tensorActive] = await Promise.all([
    promQuery('DCGM_FI_DEV_GPU_UTIL'),
    promQuery('DCGM_FI_DEV_FB_USED'),
    promQuery('DCGM_FI_DEV_FB_FREE'),
    promQuery('DCGM_FI_DEV_POWER_USAGE'),
    promQuery('DCGM_FI_PROF_DRAM_ACTIVE'),
    promQuery('DCGM_FI_PROF_PIPE_TENSOR_ACTIVE'),
  ]);

  // 노드별로 GPU 메트릭 그룹핑
  const nodeGpus = new Map<string, any[]>();
  const nodeTimestamp = new Map<string, Date>();

  for (const r of fbUsed) {
    const node = r.metric?.node || r.metric?.Hostname;
    if (!node || !nodeToServerId.has(node)) continue;

    const device = r.metric?.device || '';
    const idx = parseInt(device.replace('nvidia', ''), 10) || 0;
    const uuid = r.metric?.UUID || '';
    const pod = r.metric?.pod || '';
    const gpuModel = r.metric?.modelName || 'NVIDIA H200';
    const used = parseFloat(r.value?.[1]) || 0; // MB

    // 같은 GPU의 다른 메트릭 찾기
    const findVal = (arr: any[]) => {
      const match = arr.find(x => x.metric?.UUID === uuid || (x.metric?.node === node && x.metric?.device === device));
      return match ? parseFloat(match.value?.[1]) || 0 : 0;
    };

    const free = findVal(fbFree);
    const util = findVal(gpuUtil);
    const pw = findVal(power);
    const dram = findVal(dramActive);
    const tensor = findVal(tensorActive);

    const gpuInfo = {
      index: idx, uuid, name: gpuModel,
      memTotalMb: used + free, memUsedMb: used,
      utilGpu: util, utilMem: (used + free) > 0 ? (used / (used + free)) * 100 : 0,
      temp: 0, powerW: pw, powerMaxW: 700, // H200 TDP
      dramActivePct: dram * 100, // 0-1 → 0-100%
      tensorActivePct: tensor * 100,
      pod, // LLM 모델 식별용
      spec: { fp16Tflops: 989, fp8Tflops: 1979, memBandwidthGBs: 4800, tdpW: 700, vramGb: 141, label: 'H200' },
    };

    const existing = nodeGpus.get(node) || [];
    existing.push(gpuInfo);
    nodeGpus.set(node, existing);

    if (r.value?.[0]) nodeTimestamp.set(node, new Date(r.value[0] * 1000));
  }

  // vLLM 메트릭 시도 (자동 감지 — 복구 시 자동 수집)
  const [running, waiting, kvCache] = await Promise.all([
    promQuery('vllm:num_requests_running'),
    promQuery('vllm:num_requests_waiting'),
    promQuery('vllm:gpu_cache_usage_perc'),
  ]);

  const vllmAvailable = running.length > 0;
  if (vllmAvailable && !backfillDone) {
    console.log('[PromCollector] vLLM metrics detected! Real-time LLM metrics now available.');
  }

  // vLLM 인스턴스 → 노드 매핑 (pod 이름에서 추출)
  const instanceToNode = new Map<string, string>();
  for (const [node, gpus] of nodeGpus) {
    for (const gpu of gpus) {
      if (gpu.pod) {
        // pod: "llm-glm-47-h200-tp8-5d945977c6-tx8dm" → instance: "glm-47-h200-tp8"
        const match = gpu.pod.match(/^llm-(.+?)(-[a-f0-9]+-[a-z0-9]+)?$/);
        if (match) instanceToNode.set(match[1], node);
      }
    }
  }

  // 노드별 LLM 메트릭 구축
  const nodeLlms = new Map<string, any[]>();
  const vllmInstances = new Set<string>();

  for (const r of running) {
    const instance = r.metric?.instance || '';
    const modelName = r.metric?.model_name || instance;
    vllmInstances.add(instance);

    // instance → node 매핑
    let targetNode = instanceToNode.get(instance);
    if (!targetNode) {
      // fallback: instance 이름에서 추론
      for (const [node, gpus] of nodeGpus) {
        if (gpus.some(g => g.pod?.includes(instance.replace(/^shared-/, '')))) {
          targetNode = node;
          break;
        }
      }
    }
    if (!targetNode) continue;

    const findVllmVal = (arr: any[]) => {
      const m = arr.find(x => x.metric?.instance === instance);
      return m ? parseFloat(m.value?.[1]) || 0 : null;
    };

    const llm = {
      port: 0, containerName: instance, containerImage: 'vllm', type: 'vllm' as const,
      modelNames: [modelName],
      runningRequests: findVllmVal(running),
      waitingRequests: findVllmVal(waiting),
      kvCacheUsagePct: findVllmVal(kvCache),
      promptThroughputTps: null as number | null, // counter → rate 필요
      genThroughputTps: null as number | null,
      ttftMs: null, tpotMs: null, e2eLatencyMs: null,
      prefixCacheHitRate: null, preemptionCount: null, queueTimeMs: null,
      precision: 'fp16' as const,
      rawMetrics: {} as Record<string, number>,
    };

    const existing = nodeLlms.get(targetNode) || [];
    existing.push(llm);
    nodeLlms.set(targetNode, existing);
  }

  // 노드별 스냅샷 저장
  const sanitizeJson = (obj: any): any => {
    try { return JSON.parse(JSON.stringify(obj, (_k, v) => typeof v === 'number' && !isFinite(v) ? null : v)); }
    catch { return []; }
  };

  for (const [node, gpus] of nodeGpus) {
    const serverId = nodeToServerId.get(node);
    if (!serverId) continue;

    const llms = nodeLlms.get(node) || [];
    const ts = nodeTimestamp.get(node) || new Date();

    await prisma.gpuMetricSnapshot.create({
      data: {
        serverId,
        gpuMetrics: sanitizeJson(gpus),
        llmMetrics: sanitizeJson(llms),
        cpuLoadAvg: null, cpuCores: null,
        memoryTotalMb: null, memoryUsedMb: null,
        hostname: node,
      },
    });
  }
}

// ── 과거 vLLM 데이터 Backfill ──
async function backfillHistoricalVllm(nodeToServerId: Map<string, string>): Promise<void> {
  console.log('[PromCollector] Starting historical vLLM backfill...');

  const startTime = VLLM_LAST_AVAILABLE - (BACKFILL_LOOKBACK_HOURS * 3600);
  const endTime = VLLM_LAST_AVAILABLE;

  // 이미 backfill 된 데이터 확인
  const existingCount = await prisma.gpuMetricSnapshot.count({
    where: {
      serverId: { in: Array.from(nodeToServerId.values()) },
      timestamp: { lte: new Date(endTime * 1000), gte: new Date(startTime * 1000) },
    },
  });
  if (existingCount > 50) {
    console.log(`[PromCollector] Historical data already exists (${existingCount} snapshots), skipping backfill`);
    backfillDone = true;
    return;
  }

  // 주요 vLLM 메트릭 range query
  const [runningRange, waitingRange, kvRange, promptRange, genRange] = await Promise.all([
    promQueryRange('vllm:num_requests_running', startTime, endTime, BACKFILL_STEP),
    promQueryRange('vllm:num_requests_waiting', startTime, endTime, BACKFILL_STEP),
    promQueryRange('vllm:gpu_cache_usage_perc', startTime, endTime, BACKFILL_STEP),
    promQueryRange('vllm:prompt_tokens_total', startTime, endTime, BACKFILL_STEP),
    promQueryRange('vllm:generation_tokens_total', startTime, endTime, BACKFILL_STEP),
  ]);

  // DCGM GPU 메트릭도 같은 기간 range query
  const [gpuUtilRange, fbUsedRange, fbFreeRange] = await Promise.all([
    promQueryRange('DCGM_FI_DEV_GPU_UTIL', startTime, endTime, BACKFILL_STEP),
    promQueryRange('DCGM_FI_DEV_FB_USED', startTime, endTime, BACKFILL_STEP),
    promQueryRange('DCGM_FI_DEV_FB_FREE', startTime, endTime, BACKFILL_STEP),
  ]);

  // 타임스탬프별 → 노드별 스냅샷 구축
  // range query 결과: [{metric: {...}, values: [[ts, val], [ts, val], ...]}, ...]
  const timestamps = new Set<number>();
  for (const r of gpuUtilRange) {
    for (const [ts] of (r.values || [])) timestamps.add(ts);
  }

  const sortedTs = Array.from(timestamps).sort((a, b) => a - b);
  console.log(`[PromCollector] Backfilling ${sortedTs.length} timestamps for ${BACKFILL_LOOKBACK_HOURS}h`);

  let saved = 0;
  const BATCH_SIZE = 50;
  const batch: any[] = [];

  // instance → node 매핑 (DCGM pod 정보 기반 — 현재 매핑 재사용)
  const instanceToNode = new Map<string, string>();
  for (const r of fbUsedRange) {
    const node = r.metric?.node || r.metric?.Hostname;
    const pod = r.metric?.pod || '';
    if (node && pod) {
      const match = pod.match(/^llm-(.+?)(-[a-f0-9]+-[a-z0-9]+)?$/);
      if (match) instanceToNode.set(match[1], node);
    }
  }

  // 각 range 결과에서 instance별 값을 타임스탬프로 빠르게 조회하기 위한 인덱스
  const buildIndex = (rangeData: any[]) => {
    const idx = new Map<string, Map<number, number>>(); // instance → ts → value
    for (const r of rangeData) {
      const instance = r.metric?.instance || r.metric?.node || '';
      const tsMap = idx.get(instance) || new Map();
      for (const [ts, val] of (r.values || [])) {
        tsMap.set(ts, parseFloat(val) || 0);
      }
      idx.set(instance, tsMap);
    }
    return idx;
  };

  const gpuUtilIdx = buildIndex(gpuUtilRange);
  const fbUsedIdx = buildIndex(fbUsedRange);
  const fbFreeIdx = buildIndex(fbFreeRange);
  const runningIdx = buildIndex(runningRange);
  const waitingIdx = buildIndex(waitingRange);
  const kvIdx = buildIndex(kvRange);
  const promptIdx = buildIndex(promptRange);
  const genIdx = buildIndex(genRange);

  // counter → rate 변환을 위한 이전 값 저장
  const prevPrompt = new Map<string, number>();
  const prevGen = new Map<string, number>();

  for (const ts of sortedTs) {
    const timestamp = new Date(ts * 1000);

    // 노드별 GPU 메트릭 구축
    for (const [node, serverId] of nodeToServerId) {
      const gpus: any[] = [];

      // 이 노드의 GPU 찾기 (fbUsedRange에서)
      for (const r of fbUsedRange) {
        if ((r.metric?.node || r.metric?.Hostname) !== node) continue;
        const device = r.metric?.device || '';
        const uuid = r.metric?.UUID || '';
        const gpuModel = r.metric?.modelName || 'NVIDIA H200';
        const idx = parseInt(device.replace('nvidia', ''), 10) || 0;
        const key = `${node}:${device}`;

        const used = fbUsedIdx.get(key)?.get(ts) ?? fbUsedIdx.get(uuid)?.get(ts) ?? 0;
        const free = fbFreeIdx.get(key)?.get(ts) ?? fbFreeIdx.get(uuid)?.get(ts) ?? 0;
        const util = gpuUtilIdx.get(key)?.get(ts) ?? gpuUtilIdx.get(uuid)?.get(ts) ?? 0;

        // 중복 방지
        if (!gpus.find(g => g.uuid === uuid)) {
          gpus.push({
            index: idx, uuid, name: gpuModel,
            memTotalMb: used + free, memUsedMb: used,
            utilGpu: util, utilMem: (used + free) > 0 ? (used / (used + free)) * 100 : 0,
            temp: 0, powerW: 0, powerMaxW: 700,
            spec: { fp16Tflops: 989, fp8Tflops: 1979, memBandwidthGBs: 4800, tdpW: 700, vramGb: 141, label: 'H200' },
          });
        }
      }

      // 이 노드의 LLM 메트릭
      const llms: any[] = [];
      for (const [instance, targetNode] of instanceToNode) {
        if (targetNode !== node) continue;
        const modelName = runningRange.find(r => r.metric?.instance === instance)?.metric?.model_name || instance;

        const runVal = runningIdx.get(instance)?.get(ts) ?? null;
        const waitVal = waitingIdx.get(instance)?.get(ts) ?? null;
        const kvVal = kvIdx.get(instance)?.get(ts) ?? null;

        // counter → rate (tok/s)
        const promptTotal = promptIdx.get(instance)?.get(ts);
        const genTotal = genIdx.get(instance)?.get(ts);
        let promptTps: number | null = null;
        let genTps: number | null = null;
        if (promptTotal != null) {
          const prev = prevPrompt.get(instance);
          if (prev != null && promptTotal >= prev) {
            promptTps = (promptTotal - prev) / BACKFILL_STEP;
          }
          prevPrompt.set(instance, promptTotal);
        }
        if (genTotal != null) {
          const prev = prevGen.get(instance);
          if (prev != null && genTotal >= prev) {
            genTps = (genTotal - prev) / BACKFILL_STEP;
          }
          prevGen.set(instance, genTotal);
        }

        if (runVal != null || kvVal != null || promptTps != null) {
          llms.push({
            port: 0, containerName: instance, containerImage: 'vllm', type: 'vllm',
            modelNames: [modelName],
            runningRequests: runVal, waitingRequests: waitVal, kvCacheUsagePct: kvVal,
            promptThroughputTps: promptTps, genThroughputTps: genTps,
            ttftMs: null, tpotMs: null, e2eLatencyMs: null,
            prefixCacheHitRate: null, preemptionCount: null, queueTimeMs: null,
            precision: 'fp16', rawMetrics: {},
          });
        }
      }

      if (gpus.length > 0 || llms.length > 0) {
        batch.push({
          serverId, timestamp,
          gpuMetrics: gpus, llmMetrics: llms,
          hostname: node,
        });

        if (batch.length >= BATCH_SIZE) {
          await prisma.gpuMetricSnapshot.createMany({
            data: batch.map(b => ({
              serverId: b.serverId, timestamp: b.timestamp,
              gpuMetrics: b.gpuMetrics as any, llmMetrics: b.llmMetrics as any,
              hostname: b.hostname,
            })),
          });
          saved += batch.length;
          batch.length = 0;
        }
      }
    }
  }

  // 남은 배치 저장
  if (batch.length > 0) {
    await prisma.gpuMetricSnapshot.createMany({
      data: batch.map(b => ({
        serverId: b.serverId, timestamp: b.timestamp,
        gpuMetrics: b.gpuMetrics as any, llmMetrics: b.llmMetrics as any,
        hostname: b.hostname,
      })),
    });
    saved += batch.length;
  }

  console.log(`[PromCollector] Backfill complete: ${saved} snapshots saved`);
  backfillDone = true;
}

// ── 메인 크론 ──
export async function startPrometheusCollector(): Promise<void> {
  console.log('[PromCollector] Starting DTGPT Prometheus collector...');

  try {
    // 1. 노드 자동 감지
    const nodes = await discoverNodes();
    if (nodes.size === 0) {
      console.log('[PromCollector] No DTGPT nodes discovered, will retry later');
      // 5분 후 재시도
      setTimeout(() => startPrometheusCollector(), 5 * 60 * 1000);
      return;
    }
    console.log(`[PromCollector] Discovered ${nodes.size} nodes: ${Array.from(nodes.keys()).join(', ')}`);

    // 2. 서버 자동 등록
    const nodeToServerId = await ensureServers(nodes);

    // 3. 과거 데이터 backfill (1회)
    if (!backfillDone) {
      await backfillHistoricalVllm(nodeToServerId).catch(err =>
        console.error('[PromCollector] Backfill error:', err.message)
      );
    }

    // 4. 실시간 수집 시작
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        // 노드 변경 감지 (5분마다)
        const freshNodes = await discoverNodes();
        if (freshNodes.size !== nodes.size) {
          const freshMapping = await ensureServers(freshNodes);
          for (const [k, v] of freshMapping) nodeToServerId.set(k, v);
        }
        await collectDcgmSnapshot(nodeToServerId);
      } catch (err: any) {
        console.error('[PromCollector] Poll error:', err.message);
      }
    }, POLL_INTERVAL_MS);

    // 즉시 1회 수집
    await collectDcgmSnapshot(nodeToServerId);
    console.log('[PromCollector] Real-time DCGM collection started (60s interval)');

  } catch (err: any) {
    console.error('[PromCollector] Startup error:', err.message);
    // 5분 후 재시도
    setTimeout(() => startPrometheusCollector(), 5 * 60 * 1000);
  }
}
