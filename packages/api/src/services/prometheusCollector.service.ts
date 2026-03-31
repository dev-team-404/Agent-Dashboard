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
const BACKFILL_LOOKBACK_HOURS = 336; // 14일 (Prometheus 기본 보존 기간) — 가능한 모든 과거 데이터
const SERVER_DESC_PREFIX = '[DTGPT-Prometheus]';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let backfillDone = false;
let lastPowerHour: number | null = null;

// tok/s 직접 계산용 — rate() 대신 counter delta 방식 (recording rule counter reset 문제 회피)
const prevTokenCounters = new Map<string, { promptTotal: number; genTotal: number; ts: number }>();

// ── Prometheus API 호출 ──
async function promQuery(query: string, time?: number): Promise<any[]> {
  try {
    const params = new URLSearchParams({ query });
    if (time) params.set('time', String(time));
    const res = await fetch(`${PROM_URL}/query?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`[PromCollector] query failed (HTTP ${res.status}): ${query}`);
      return [];
    }
    const data = await res.json() as any;
    return data?.data?.result || [];
  } catch (err: any) {
    console.warn(`[PromCollector] query error: ${query} — ${err.message}`);
    return [];
  }
}

async function promQueryRange(query: string, start: number, end: number, step: number): Promise<any[]> {
  try {
    const params = new URLSearchParams({ query, start: String(start), end: String(end), step: String(step) });
    const res = await fetch(`${PROM_URL}/query_range?${params}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.warn(`[PromCollector] range query failed (HTTP ${res.status}): ${query}`);
      return [];
    }
    const data = await res.json() as any;
    return data?.data?.result || [];
  } catch (err: any) {
    console.warn(`[PromCollector] range query error: ${query} — ${err.message}`);
    return [];
  }
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
  const [gpuUtil, fbUsed, fbFree, power, powerLimit, dramActive, tensorActive] = await Promise.all([
    promQuery('DCGM_FI_DEV_GPU_UTIL'),
    promQuery('DCGM_FI_DEV_FB_USED'),
    promQuery('DCGM_FI_DEV_FB_FREE'),
    promQuery('DCGM_FI_DEV_POWER_USAGE'),
    promQuery('DCGM_FI_DEV_POWER_MGMT_LIMIT'),
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
    const pwLimit = findVal(powerLimit) || 700; // fallback H200 TDP
    const dram = findVal(dramActive);
    const tensor = findVal(tensorActive);

    const gpuInfo = {
      index: idx, uuid, name: gpuModel,
      memTotalMb: used + free, memUsedMb: used,
      utilGpu: util, utilMem: (used + free) > 0 ? (used / (used + free)) * 100 : 0,
      temp: 0, powerW: pw, powerMaxW: pwLimit,
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
  const [running, waiting, kvCacheOld, kvCacheNew, promptCounters, genCounters] = await Promise.all([
    promQuery('vllm:num_requests_running'),
    promQuery('vllm:num_requests_waiting'),
    promQuery('vllm:gpu_cache_usage_perc'),   // 구 이름
    promQuery('vllm:kv_cache_usage_perc'),    // 신 이름
    promQuery('vllm:prompt_tokens_total'),    // counter → delta로 tok/s 직접 계산
    promQuery('vllm:generation_tokens_total'),
  ]);
  const kvCache = kvCacheOld.length > 0 ? kvCacheOld : kvCacheNew;

  const vllmAvailable = running.length > 0 || kvCache.length > 0;
  if (vllmAvailable && !backfillDone) {
    console.log('[PromCollector] vLLM metrics detected! Real-time LLM metrics now available.');
  }
  if (!vllmAvailable) {
    console.log('[PromCollector] vLLM metrics not found (running=%d, waiting=%d, kvOld=%d, kvNew=%d)',
      running.length, waiting.length, kvCacheOld.length, kvCacheNew.length);
  }

  // vLLM 인스턴스 → 노드 매핑
  const instanceToNodes = new Map<string, string[]>();

  // 1차: DCGM pod 라벨 기반 (tp8 등 전용 GPU 모델)
  for (const [node, gpus] of nodeGpus) {
    for (const gpu of gpus) {
      if (gpu.pod) {
        const match = gpu.pod.match(/^llm-(.+?)(-[a-f0-9]+-[a-z0-9]+)?$/);
        if (match) {
          const nodes = instanceToNodes.get(match[1]) || [];
          if (!nodes.includes(node)) nodes.push(node);
          instanceToNodes.set(match[1], nodes);
        }
      }
    }
  }

  // 2차: kube_pod_info 보조 매핑 (DCGM에 안 잡히는 shared pod 등)
  const kubePodInfo = await promQuery('kube_pod_info{pod=~"llm-.*"}');
  for (const r of kubePodInfo) {
    const pod = r.metric?.pod || '';
    const node = r.metric?.node || '';
    if (!pod || !node) continue;
    const match = pod.match(/^llm-(.+?)(-[a-f0-9]+-[a-z0-9]+)?$/);
    if (!match) continue;
    const instanceKey = match[1];
    if (instanceToNodes.has(instanceKey)) continue; // DCGM에서 이미 매핑됨

    // 노드가 GpuServer로 미등록 → 등록
    if (!nodeToServerId.has(node)) {
      const desc = `${SERVER_DESC_PREFIX} ${node} | shared pods (via kube_pod_info)`;
      let server = await prisma.gpuServer.findFirst({
        where: { description: { contains: `${SERVER_DESC_PREFIX} ${node}` } },
      });
      if (!server) {
        server = await prisma.gpuServer.create({
          data: {
            name: `DTGPT-${node}`, host: node, sshPort: 0,
            sshUsername: 'prometheus', sshPassword: '',
            description: desc, isLocal: false, enabled: true, pollIntervalSec: 60,
          },
        });
        console.log(`[PromCollector] Created shared node server: ${server.name} (${node})`);
      }
      nodeToServerId.set(node, server.id);
    }

    const nodes = instanceToNodes.get(instanceKey) || [];
    if (!nodes.includes(node)) nodes.push(node);
    instanceToNodes.set(instanceKey, nodes);
  }

  if (kubePodInfo.length > 0) {
    console.log(`[PromCollector] Instance mapping: DCGM=${Array.from(instanceToNodes.entries()).filter(([k]) => !k.startsWith('shared-')).map(([k, v]) => `${k}→[${v}]`).join(', ')}, kube_pod_info shared=${Array.from(instanceToNodes.entries()).filter(([k]) => k.startsWith('shared-')).map(([k, v]) => `${k}→[${v}]`).join(', ')}`);
  }

  // 노드별 LLM 메트릭 구축
  const nodeLlms = new Map<string, any[]>();
  const vllmInstances = new Set<string>();

  // running + kvCache에서 유효한 인스턴스 통합 (pod 파생 이름 기준)
  const allVllmResults = [...running, ...kvCache];
  const seenInstances = new Set<string>();

  for (const r of allVllmResults) {
    const instance = r.metric?.instance || '';

    // IP:port 형식 (프록시/라우터 메트릭) → 스킵
    if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(instance)) continue;

    if (seenInstances.has(instance)) continue;
    seenInstances.add(instance);
    vllmInstances.add(instance);

    // model_name: running/kvCache 양쪽에서 확보
    const modelName = r.metric?.model_name
      || running.find(x => x.metric?.instance === instance)?.metric?.model_name
      || kvCache.find(x => x.metric?.instance === instance)?.metric?.model_name
      || instance;

    // instance → 모든 관련 노드에 LLM 메트릭 배포
    let targetNodes = instanceToNodes.get(instance) || [];
    if (targetNodes.length === 0) {
      // fallback: instance 이름에서 추론
      for (const [node, gpus] of nodeGpus) {
        if (gpus.some(g => g.pod?.includes(instance.replace(/^shared-/, '')))) {
          targetNodes = [node];
          break;
        }
      }
    }
    if (targetNodes.length === 0) {
      console.warn(`[PromCollector] vLLM instance "${instance}" (model: ${modelName}) has no node mapping. instanceToNodes keys: [${Array.from(instanceToNodes.keys()).join(', ')}]`);
      continue;
    }

    const findVllmVal = (arr: any[]) => {
      const m = arr.find(x => x.metric?.instance === instance);
      return m ? parseFloat(m.value?.[1]) || 0 : null;
    };

    // replica 수로 나눠서 각 노드에 균등 배분
    const replicaCount = targetNodes.length;
    const runVal = findVllmVal(running);
    const waitVal = findVllmVal(waiting);
    const kvVal = findVllmVal(kvCache);

    // tok/s: counter delta 방식 (rate() 대신 — recording rule counter reset 문제 회피)
    const promptTotal = findVllmVal(promptCounters);
    const genTotal = findVllmVal(genCounters);
    let promptTps: number | null = null;
    let genTps: number | null = null;
    const now = Date.now();
    const prev = prevTokenCounters.get(instance);
    if (prev && promptTotal != null && genTotal != null) {
      const dtSec = (now - prev.ts) / 1000;
      if (dtSec > 5) {
        const pDelta = promptTotal - prev.promptTotal;
        const gDelta = genTotal - prev.genTotal;
        promptTps = pDelta >= 0 ? pDelta / dtSec : null;
        genTps = gDelta >= 0 ? gDelta / dtSec : null;
      }
    }
    // 디버그: 전용 모델 counter delta 추적
    if (!instance.startsWith('shared-')) {
      console.log(`[PromCollector][TPS] ${instance}: promptTotal=${promptTotal}, genTotal=${genTotal}, prev=${prev ? `p=${prev.promptTotal},g=${prev.genTotal},age=${Math.round((now-prev.ts)/1000)}s` : 'NONE'} → promptTps=${promptTps}, genTps=${genTps}`);
    }
    if (promptTotal != null || genTotal != null) {
      prevTokenCounters.set(instance, { promptTotal: promptTotal || 0, genTotal: genTotal || 0, ts: now });
    }

    for (const targetNode of targetNodes) {
      const llm = {
        port: 0, containerName: instance, containerImage: 'vllm', type: 'vllm' as const,
        modelNames: [modelName],
        runningRequests: runVal != null ? Math.round(runVal / replicaCount) : null,
        waitingRequests: waitVal != null ? Math.round(waitVal / replicaCount) : null,
        kvCacheUsagePct: kvVal, // KV cache %는 replica별 동일 (비율이므로)
        promptThroughputTps: promptTps != null ? promptTps / replicaCount : null,
        genThroughputTps: genTps != null ? genTps / replicaCount : null,
        ttftMs: null, tpotMs: null, e2eLatencyMs: null,
        prefixCacheHitRate: null, preemptionCount: null, queueTimeMs: null,
        precision: 'fp16' as const,
        rawMetrics: {} as Record<string, number>,
      };

      const existing = nodeLlms.get(targetNode) || [];
      existing.push(llm);
      nodeLlms.set(targetNode, existing);
    }
  }

  // 노드별 스냅샷 저장
  const sanitizeJson = (obj: any): any => {
    try { return JSON.parse(JSON.stringify(obj, (_k, v) => typeof v === 'number' && !isFinite(v) ? null : v)); }
    catch { return []; }
  };

  // DCGM 노드: GPU + LLM 메트릭
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

  // shared 노드: LLM 메트릭만 (DCGM에 없는 kube_pod_info 매핑 노드)
  for (const [node, llms] of nodeLlms) {
    if (nodeGpus.has(node)) continue; // DCGM 노드는 위에서 이미 저장
    const serverId = nodeToServerId.get(node);
    if (!serverId || llms.length === 0) continue;

    await prisma.gpuMetricSnapshot.create({
      data: {
        serverId,
        gpuMetrics: sanitizeJson([]),
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

  // 이미 backfill 된 데이터 확인 — LLM 메트릭이 있는 스냅샷이 충분한지 체크
  const serverIds = Array.from(nodeToServerId.values());
  const existingWithLlm = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM gpu_metric_snapshots
    WHERE server_id = ANY(${serverIds})
      AND timestamp <= ${new Date(endTime * 1000)}
      AND timestamp >= ${new Date(startTime * 1000)}
      AND llm_metrics IS NOT NULL
      AND llm_metrics::text != '[]'
      AND llm_metrics::text != 'null'`;
  const llmCount = Number(existingWithLlm[0]?.count || 0);
  if (llmCount > 100) {
    console.log(`[PromCollector] Historical LLM data already exists (${llmCount} snapshots with LLM), skipping backfill`);
    backfillDone = true;
    return;
  }
  console.log(`[PromCollector] Found ${llmCount} snapshots with LLM data — need backfill`);

  // 주요 vLLM 메트릭 range query (KV cache: 두 이름 모두 조회, preemption 추가)
  const [runningRange, waitingRange, kvRange1, kvRange2, promptRange, genRange, preemptRange] = await Promise.all([
    promQueryRange('vllm:num_requests_running', startTime, endTime, BACKFILL_STEP),
    promQueryRange('vllm:num_requests_waiting', startTime, endTime, BACKFILL_STEP),
    promQueryRange('vllm:gpu_cache_usage_perc', startTime, endTime, BACKFILL_STEP),    // 구 이름
    promQueryRange('vllm:kv_cache_usage_perc', startTime, endTime, BACKFILL_STEP),     // 신 이름
    promQueryRange('vllm:prompt_tokens_total', startTime, endTime, BACKFILL_STEP),
    promQueryRange('vllm:generation_tokens_total', startTime, endTime, BACKFILL_STEP),
    promQueryRange('vllm:num_preemptions_total', startTime, endTime, BACKFILL_STEP),   // preemption 추가
  ]);
  // KV cache: 두 이름 중 데이터 있는 쪽 사용
  const kvRange = kvRange1.length > 0 ? kvRange1 : kvRange2;
  console.log(`[PromCollector] Backfill metrics: running=${runningRange.length}, waiting=${waitingRange.length}, kv=${kvRange.length}(old:${kvRange1.length},new:${kvRange2.length}), prompt=${promptRange.length}, gen=${genRange.length}, preempt=${preemptRange.length}`);

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

  // instance → node 매핑: CURRENT instant query 사용 (range query pod 라벨 신뢰 불가 이슈 해결)
  const instanceToNodes = new Map<string, string[]>();
  const currentFbUsed = await promQuery('DCGM_FI_DEV_FB_USED');
  for (const r of currentFbUsed) {
    const node = r.metric?.node || r.metric?.Hostname;
    const pod = r.metric?.pod || '';
    if (node && pod) {
      const match = pod.match(/^llm-(.+?)(-[a-f0-9]+-[a-z0-9]+)?$/);
      if (match) {
        const nodes = instanceToNodes.get(match[1]) || [];
        if (!nodes.includes(node)) nodes.push(node);
        instanceToNodes.set(match[1], nodes);
      }
    }
  }
  console.log(`[PromCollector] Backfill mapping: ${Array.from(instanceToNodes.entries()).map(([k, v]) => `${k} → [${v.join(',')}]`).join(', ')}`);

  // 각 range 결과에서 키별 값을 타임스탬프로 빠르게 조회하기 위한 인덱스
  // DCGM: UUID로 키 (같은 노드의 GPU 8장을 구분해야 함)
  // vLLM: instance로 키 (모델 인스턴스별 고유)
  const buildIndex = (rangeData: any[], keyFn: (m: any) => string) => {
    const idx = new Map<string, Map<number, number>>();
    for (const r of rangeData) {
      const key = keyFn(r.metric || {});
      if (!key) continue;
      const tsMap = idx.get(key) || new Map();
      for (const [ts, val] of (r.values || [])) {
        tsMap.set(ts, parseFloat(val) || 0);
      }
      idx.set(key, tsMap);
    }
    return idx;
  };

  const dcgmKey = (m: any) => m.UUID || `${m.node || m.Hostname}:${m.device}`;
  const vllmKey = (m: any) => m.instance || '';

  const gpuUtilIdx = buildIndex(gpuUtilRange, dcgmKey);
  const fbUsedIdx = buildIndex(fbUsedRange, dcgmKey);
  const fbFreeIdx = buildIndex(fbFreeRange, dcgmKey);
  const runningIdx = buildIndex(runningRange, vllmKey);
  const waitingIdx = buildIndex(waitingRange, vllmKey);
  const kvIdx = buildIndex(kvRange, vllmKey);
  const promptIdx = buildIndex(promptRange, vllmKey);
  const genIdx = buildIndex(genRange, vllmKey);
  const preemptIdx = buildIndex(preemptRange, vllmKey);

  // counter → rate 변환을 위한 이전 값 저장
  const prevPrompt = new Map<string, number>();
  const prevGen = new Map<string, number>();
  const prevPreempt = new Map<string, number>();

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
        // UUID 또는 node:device로 lookup (buildIndex의 dcgmKey와 동일)
        const gpuKey = uuid || `${node}:${device}`;

        const used = fbUsedIdx.get(gpuKey)?.get(ts) ?? 0;
        const free = fbFreeIdx.get(gpuKey)?.get(ts) ?? 0;
        const util = gpuUtilIdx.get(gpuKey)?.get(ts) ?? 0;

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

      // 이 노드의 LLM 메트릭 (1:N 매핑 — replica가 여러 노드에 배포)
      const llms: any[] = [];
      for (const [instance, targetNodeList] of instanceToNodes) {
        if (!targetNodeList.includes(node)) continue;
        const replicaCount = targetNodeList.length;
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

        // preemption (counter → rate)
        const preemptTotal = preemptIdx.get(instance)?.get(ts);
        let preemptCount: number | null = null;
        if (preemptTotal != null) {
          const prev = prevPreempt.get(instance);
          if (prev != null && preemptTotal >= prev) {
            preemptCount = Math.round(preemptTotal - prev); // 구간 내 발생 횟수
          }
          prevPreempt.set(instance, preemptTotal);
        }

        if (runVal != null || kvVal != null || promptTps != null) {
          llms.push({
            port: 0, containerName: instance, containerImage: 'vllm', type: 'vllm',
            modelNames: [modelName],
            runningRequests: runVal != null ? Math.round(runVal / replicaCount) : null,
            waitingRequests: waitVal != null ? Math.round(waitVal / replicaCount) : null,
            kvCacheUsagePct: kvVal,
            promptThroughputTps: promptTps != null ? promptTps / replicaCount : null,
            genThroughputTps: genTps != null ? genTps / replicaCount : null,
            ttftMs: null, tpotMs: null, e2eLatencyMs: null,
            prefixCacheHitRate: null, preemptionCount: preemptCount, queueTimeMs: null,
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

// ── 시간별 전력 사용률 집계 → gpu_power_usages 저장 ──
async function flushHourlyPowerUsage(): Promise<void> {
  try {
    // 직전 정시 기준
    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const prevHourStart = new Date(hourStart.getTime() - 3600_000);

    // Prometheus 서버 ID 목록
    const promServers = await prisma.gpuServer.findMany({
      where: { description: { startsWith: SERVER_DESC_PREFIX } },
      select: { id: true },
    });
    if (promServers.length === 0) return;
    const serverIds = promServers.map((s: { id: string }) => s.id);

    // 직전 1시간의 스냅샷 조회
    const snapshots = await prisma.gpuMetricSnapshot.findMany({
      where: {
        serverId: { in: serverIds },
        timestamp: { gte: prevHourStart, lt: hourStart },
      },
      select: { gpuMetrics: true },
    });

    if (snapshots.length === 0) return;

    // sum(power) / sum(limit) — 기존 Prometheus 쿼리와 동일한 수식
    // (sum(avg_over_time(DCGM_FI_DEV_POWER_USAGE[1h])) / sum(avg_over_time(DCGM_FI_DEV_POWER_MGMT_LIMIT[1h]))) * 100
    let totalPower = 0;
    let totalLimit = 0;
    for (const snap of snapshots) {
      const gpus = snap.gpuMetrics as any[];
      if (!Array.isArray(gpus)) continue;
      for (const gpu of gpus) {
        const pw = gpu.powerW ?? 0;
        const maxPw = gpu.powerMaxW ?? 0;
        if (maxPw > 0 && pw > 0) {
          totalPower += pw;
          totalLimit += maxPw;
        }
      }
    }

    if (totalLimit === 0) return;
    const avgRatio = (totalPower / totalLimit) * 100; // %

    // upsert (timestamp unique)
    await prisma.gpuPowerUsage.upsert({
      where: { timestamp: prevHourStart },
      create: { timestamp: prevHourStart, powerAvgUsageRatio: Math.round(avgRatio * 100) / 100 },
      update: { powerAvgUsageRatio: Math.round(avgRatio * 100) / 100 },
    });

    console.log(`[PromCollector] Power usage saved: ${prevHourStart.toISOString()} → ${avgRatio.toFixed(1)}% (${snapshots.length} snapshots)`);
  } catch (err: any) {
    console.error('[PromCollector] Power usage flush error:', err.message);
  }
}

// ── 기존 스냅샷 기반 전력 백필 ──
async function backfillPowerUsage(): Promise<void> {
  try {
    const promServers = await prisma.gpuServer.findMany({
      where: { description: { startsWith: SERVER_DESC_PREFIX } },
      select: { id: true },
    });
    if (promServers.length === 0) return;
    const serverIds = promServers.map((s: { id: string }) => s.id);

    // powerW > 0인 스냅샷의 시간 범위 확인
    const snapshots = await prisma.$queryRaw<{ hour: Date; avg_ratio: number }[]>`
      SELECT
        date_trunc('hour', timestamp) AS hour,
        AVG(
          (SELECT AVG((g->>'powerW')::float / NULLIF((g->>'powerMaxW')::float, 0))
           FROM jsonb_array_elements(gpu_metrics::jsonb) AS g
           WHERE (g->>'powerW')::float > 0 AND (g->>'powerMaxW')::float > 0)
        ) AS avg_ratio
      FROM gpu_metric_snapshots
      WHERE server_id = ANY(${serverIds})
        AND gpu_metrics IS NOT NULL
        AND gpu_metrics::text LIKE '%powerW%'
      GROUP BY date_trunc('hour', timestamp)
      HAVING AVG(
        (SELECT AVG((g->>'powerW')::float / NULLIF((g->>'powerMaxW')::float, 0))
         FROM jsonb_array_elements(gpu_metrics::jsonb) AS g
         WHERE (g->>'powerW')::float > 0 AND (g->>'powerMaxW')::float > 0)
      ) IS NOT NULL
      ORDER BY hour`;

    if (snapshots.length === 0) {
      console.log('[PromCollector] Power usage backfill: no snapshots with powerW data');
      return;
    }

    // 이미 존재하는 시간대 조회
    const existing = await prisma.gpuPowerUsage.findMany({
      select: { timestamp: true },
    });
    const existingSet = new Set(existing.map((e: { timestamp: Date }) => e.timestamp.getTime()));

    let inserted = 0;
    for (const row of snapshots) {
      const hourTs = new Date(row.hour);
      if (existingSet.has(hourTs.getTime())) continue;
      const ratio = Number(row.avg_ratio) * 100;
      if (isNaN(ratio) || ratio <= 0) continue;

      await prisma.gpuPowerUsage.create({
        data: {
          timestamp: hourTs,
          powerAvgUsageRatio: Math.round(ratio * 100) / 100,
        },
      });
      inserted++;
    }

    console.log(`[PromCollector] Power usage backfill: ${inserted} hours inserted (${snapshots.length} total hours found)`);
  } catch (err: any) {
    console.error('[PromCollector] Power usage backfill error:', err.message);
  }
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

    // 3-1. 전력 사용률 백필 (기존 스냅샷 기반, 1회)
    await backfillPowerUsage().catch(err =>
      console.error('[PromCollector] Power backfill error:', err.message)
    );
    lastPowerHour = new Date().getHours();

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

        // 시간 변경 시 전력 사용률 집계
        const currentHour = new Date().getHours();
        if (lastPowerHour !== null && currentHour !== lastPowerHour) {
          await flushHourlyPowerUsage();
        }
        lastPowerHour = currentHour;
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
