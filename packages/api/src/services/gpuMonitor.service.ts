/**
 * GPU Monitor Service (v2)
 *
 * SSH 한 번 접속으로 종합 수집:
 * 1. nvidia-smi → GPU 하드웨어 메트릭
 * 2. 시스템 메트릭 (CPU, RAM)
 * 3. docker ps → LLM 컨테이너 자동 탐지
 * 4. curl /metrics → vLLM/SGLang Prometheus 메트릭 자동 수집
 * 5. ollama ps → Ollama 모델 상태 자동 수집
 */

import { Client as SSHClient } from 'ssh2';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { prisma } from '../index.js';

const execAsync = promisify(exec);

// ================================================================
// 암호화 (AES-256-GCM, JWT_SECRET 기반)
// ================================================================
const ALGO = 'aes-256-gcm';
function getEncKey(): Buffer {
  return crypto.scryptSync(process.env['JWT_SECRET'] || 'default-key', 'gpu-ssh-salt', 32);
}

export function encryptPassword(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, getEncKey(), iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc}`;
}

export function decryptPassword(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted password format');
  const [ivHex, tagHex, data] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, getEncKey(), iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(data, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

// ================================================================
// SSH 실행
// ================================================================
function sshExec(host: string, port: number, username: string, password: string, command: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    const timer = setTimeout(() => { conn.end(); reject(new Error('SSH timeout')); }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(command, (err: any, stream: any) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        let stdout = '';
        stream.on('data', (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on('data', () => {});
        stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(stdout); });
      });
    });
    conn.on('error', (err: any) => { clearTimeout(timer); reject(err); });
    conn.connect({
      host, port, username, password,
      readyTimeout: 10000,
      algorithms: {
        kex: [
          'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
          'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256',
          'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1',
          'diffie-hellman-group1-sha1',
        ],
      },
    });
  });
}

// ================================================================
// SSH 명령어: GPU + 시스템 + LLM 자동 탐지 (모든 정보 수집)
// ================================================================
const METRICS_CMD = [
  // nvidia-smi PATH 탐지
  'NSMI=$(which nvidia-smi 2>/dev/null); [ -z "$NSMI" ] && [ -x /usr/lib/wsl/lib/nvidia-smi ] && NSMI=/usr/lib/wsl/lib/nvidia-smi; [ -z "$NSMI" ] && NSMI=nvidia-smi',
  'echo "==GPU=="',
  '$NSMI --query-gpu=index,uuid,name,memory.total,memory.used,utilization.gpu,utilization.memory,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits 2>/dev/null || echo "NO_GPU"',
  'echo "==PROC=="',
  '$NSMI --query-compute-apps=gpu_uuid,pid,process_name,used_gpu_memory --format=csv,noheader,nounits 2>/dev/null || echo "NO_PROC"',
  'echo "==SYS=="',
  "awk '{print $1}' /proc/loadavg",
  "free -m | awk '/Mem:/{print $2,$3}'",
  'nproc',
  'hostname',
  // LLM 탐지: vllm/sglang/tgi/lmdeploy 이미지 컨테이너만 스캔
  'echo "==LLM=="',
  'docker ps --format "{{.Ports}}|{{.Names}}|{{.Image}}" 2>/dev/null | grep -iE "vllm|sglang|tgi|text-generation|lmdeploy|aphrodite" | while IFS="|" read PORTS CNAME CIMAGE; do'
  + ' port=$(echo "$PORTS" | grep -o "0\\.0\\.0\\.0:[0-9]*" | head -1 | sed "s/0\\.0\\.0\\.0://");'
  + ' [ -z "$port" ] && continue;'
  + ' MODELS=$(curl -s --max-time 2 "http://localhost:$port/v1/models" 2>/dev/null);'
  + ' METRICS=$(curl -s --max-time 3 "http://localhost:$port/metrics" 2>/dev/null);'
  + ' echo "PORT:$port|CONTAINER:$PORTS|$CNAME|$CIMAGE";'
  + ' echo "MODELS_JSON:$MODELS";'
  + ' echo "$METRICS" | grep -vE "^#|^$" | head -200;'
  + ' echo "---ENDPORT---";'
  + ' done',
  // Ollama 탐지 (기본 포트 11434)
  'OLLAMA_PS=$(ollama ps 2>/dev/null); if [ -n "$OLLAMA_PS" ]; then echo "OLLAMA_CLI:$OLLAMA_PS"; fi',
  'OLLAMA_API=$(curl -s --max-time 2 http://localhost:11434/api/ps 2>/dev/null); if [ -n "$OLLAMA_API" ] && echo "$OLLAMA_API" | grep -q "models"; then echo "OLLAMA_PS:$OLLAMA_API"; fi',
  'echo "==ENDLLM=="',
].join('\n');

// ================================================================
// LLM 프로세스 감지 패턴
// ================================================================
const LLM_PATTERNS = [
  'vllm', 'sglang', 'ollama', 'text-generation', 'tritonserver',
  'tgi', 'lmdeploy', 'fastchat', 'openllm', 'ray::',
  'transformers', 'llama.cpp', 'exllama', 'koboldcpp', 'tabbyml',
  'aphrodite', 'tensorrt_llm',
];

function isLlmProcess(processName: string): boolean {
  const lower = processName.toLowerCase();
  return LLM_PATTERNS.some(p => lower.includes(p));
}

// ================================================================
// GPU 스펙 테이블 (H200/H100/L40S + 기타)
// ================================================================
interface GpuSpec {
  fp16Tflops: number;      // FP16 이론 성능 (TFLOPS)
  memBandwidthGBs: number; // 메모리 대역폭 (GB/s)
  tdpW: number;            // TDP (W)
  vramGb: number;          // VRAM (GB)
  label: string;           // 표시 이름
}

const GPU_SPECS: Array<{ pattern: RegExp; spec: GpuSpec }> = [
  { pattern: /H200.*SXM/i,  spec: { fp16Tflops: 989, memBandwidthGBs: 4800, tdpW: 700, vramGb: 141, label: 'H200 SXM' } },
  { pattern: /H200/i,       spec: { fp16Tflops: 989, memBandwidthGBs: 4800, tdpW: 700, vramGb: 141, label: 'H200' } },
  { pattern: /H100.*SXM/i,  spec: { fp16Tflops: 989, memBandwidthGBs: 3350, tdpW: 700, vramGb: 80, label: 'H100 SXM' } },
  { pattern: /H100.*PCIe/i, spec: { fp16Tflops: 756, memBandwidthGBs: 2000, tdpW: 350, vramGb: 80, label: 'H100 PCIe' } },
  { pattern: /H100/i,       spec: { fp16Tflops: 989, memBandwidthGBs: 3350, tdpW: 700, vramGb: 80, label: 'H100' } },
  { pattern: /L40S/i,       spec: { fp16Tflops: 362, memBandwidthGBs: 864, tdpW: 350, vramGb: 48, label: 'L40S' } },
  { pattern: /A100.*80/i,   spec: { fp16Tflops: 312, memBandwidthGBs: 2039, tdpW: 400, vramGb: 80, label: 'A100 80GB' } },
  { pattern: /A100/i,       spec: { fp16Tflops: 312, memBandwidthGBs: 1555, tdpW: 400, vramGb: 40, label: 'A100 40GB' } },
  { pattern: /RTX.*4090/i,  spec: { fp16Tflops: 165, memBandwidthGBs: 1008, tdpW: 450, vramGb: 24, label: 'RTX 4090' } },
  { pattern: /RTX.*4070/i,  spec: { fp16Tflops: 73,  memBandwidthGBs: 504,  tdpW: 200, vramGb: 12, label: 'RTX 4070' } },
];

export function lookupGpuSpec(gpuName: string): GpuSpec | null {
  for (const entry of GPU_SPECS) {
    if (entry.pattern.test(gpuName)) return entry.spec;
  }
  return null;
}

// ================================================================
// 타입 정의
// ================================================================
export interface GpuInfo {
  index: number; uuid: string; name: string;
  memTotalMb: number; memUsedMb: number;
  utilGpu: number; utilMem: number;
  temp: number; powerW: number; powerMaxW: number;
  spec: GpuSpec | null; // 자동 매칭된 GPU 스펙
}

export interface GpuProcess {
  gpuIndex: number; pid: number; name: string; memMb: number; isLlm: boolean;
}

export interface LlmEndpointMetrics {
  port: number;
  containerName: string;
  containerImage: string;
  type: 'vllm' | 'sglang' | 'tgi' | 'ollama' | 'unknown';
  modelNames: string[];               // /v1/models에서 가져온 모델 목록
  runningRequests: number | null;
  waitingRequests: number | null;
  kvCacheUsagePct: number | null;
  promptThroughputTps: number | null;
  genThroughputTps: number | null;
  rawMetrics: Record<string, number>; // AI 분석용 전체 Prometheus 메트릭
}

export interface ServerMetrics {
  serverId: string;
  serverName: string;
  timestamp: Date;
  error?: string;
  gpus: GpuInfo[];
  processes: GpuProcess[];
  llmEndpoints: LlmEndpointMetrics[];
  cpuLoadAvg: number | null;
  cpuCores: number | null;
  memoryTotalMb: number | null;
  memoryUsedMb: number | null;
  hostname: string | null;
}

// ================================================================
// Prometheus 메트릭 파싱
// ================================================================
interface PromLine { name: string; labels: string; value: number; }

function parsePrometheusLines(lines: string[]): { metrics: Map<string, number>; raw: PromLine[] } {
  const metrics = new Map<string, number>();
  const raw: PromLine[] = [];
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    // "metric_name{label="val",...} value" 또는 "metric_name value"
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([0-9.eE+\-]+)/);
    if (match) {
      const name = match[1];
      const labels = match[2] || '';
      const value = parseFloat(match[3]);
      metrics.set(name, value); // 같은 이름이면 마지막 값 (단일 모델 기준)
      raw.push({ name, labels, value });
    }
  }
  return { metrics, raw };
}

function extractLlmType(prom: Map<string, number>, containerImage: string): 'vllm' | 'sglang' | 'tgi' | 'unknown' {
  // 1. 메트릭 키에서 탐지
  for (const key of prom.keys()) {
    if (key.startsWith('vllm:') || key.startsWith('vllm_')) return 'vllm';
    if (key.startsWith('sglang:') || key.startsWith('sglang_')) return 'sglang';
    if (key.startsWith('tgi_') || key.startsWith('tgi:')) return 'tgi';
  }
  // 2. 컨테이너 이미지명에서 탐지
  const img = containerImage.toLowerCase();
  if (img.includes('vllm')) return 'vllm';
  if (img.includes('sglang')) return 'sglang';
  if (img.includes('tgi') || img.includes('text-generation')) return 'tgi';
  return 'unknown';
}

// 여러 가능한 키 이름 중 첫 번째로 매칭되는 값 반환 (_ 또는 : 경계 기반)
function promGet(prom: Map<string, number>, ...keys: string[]): number | null {
  for (const k of keys) {
    for (const [mk, mv] of prom) {
      if (mk === k || mk.endsWith('_' + k) || mk.endsWith(':' + k)) return mv;
    }
  }
  return null;
}

function extractLlmMetricsFromProm(prom: Map<string, number>, type: string): Partial<LlmEndpointMetrics> {
  if (type === 'vllm' || type === 'unknown') {
    const running = promGet(prom, 'num_requests_running');
    const waiting = promGet(prom, 'num_requests_waiting');
    const kvRaw = promGet(prom, 'gpu_cache_usage_perc', 'gpu_cache_usage', 'cache_usage');
    const kv = kvRaw != null ? (kvRaw <= 1 ? kvRaw * 100 : kvRaw) : null; // 0.xx → %, xx → %
    const promptTps = promGet(prom, 'avg_prompt_throughput_toks_per_s', 'prompt_throughput');
    const genTps = promGet(prom, 'avg_generation_throughput_toks_per_s', 'generation_throughput');
    if (running != null || kv != null || promptTps != null) {
      return { runningRequests: running, waitingRequests: waiting, kvCacheUsagePct: kv, promptThroughputTps: promptTps, genThroughputTps: genTps };
    }
  }
  if (type === 'sglang' || type === 'unknown') {
    const running = promGet(prom, 'num_running_reqs', 'running_req');
    const waiting = promGet(prom, 'num_waiting_reqs', 'waiting_req');
    const kvRaw = promGet(prom, 'token_usage', 'cache_usage');
    const kv = kvRaw != null ? (kvRaw <= 1 ? kvRaw * 100 : kvRaw) : null;
    const genTps = promGet(prom, 'gen_throughput', 'generation_throughput');
    if (running != null || kv != null || genTps != null) {
      return { runningRequests: running, waitingRequests: waiting, kvCacheUsagePct: kv, genThroughputTps: genTps };
    }
  }
  if (type === 'tgi') {
    return { runningRequests: promGet(prom, 'request_count'), waitingRequests: promGet(prom, 'queue_size') };
  }
  return {};
}

// ================================================================
// 전체 출력 파싱
// ================================================================
function parseFullOutput(output: string): Omit<ServerMetrics, 'serverId' | 'serverName' | 'timestamp'> {
  const gpus: GpuInfo[] = [];
  const processes: GpuProcess[] = [];
  const llmEndpoints: LlmEndpointMetrics[] = [];
  let cpuLoadAvg: number | null = null;
  let cpuCores: number | null = null;
  let memoryTotalMb: number | null = null;
  let memoryUsedMb: number | null = null;
  let hostname: string | null = null;

  const sections = output.split(/==(?:GPU|PROC|SYS|LLM|ENDLLM)==/);
  const uuidToIndex = new Map<string, number>();

  // GPU 파싱
  const gpuSection = (sections[1] || '').trim();
  if (gpuSection && gpuSection !== 'NO_GPU') {
    for (const line of gpuSection.split('\n')) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length >= 10) {
        const idx = parseInt(parts[0], 10);
        uuidToIndex.set(parts[1], idx);
        gpus.push({
          index: idx, uuid: parts[1], name: parts[2],
          memTotalMb: parseFloat(parts[3]) || 0, memUsedMb: parseFloat(parts[4]) || 0,
          utilGpu: parseFloat(parts[5]) || 0, utilMem: parseFloat(parts[6]) || 0,
          temp: parseFloat(parts[7]) || 0, powerW: parseFloat(parts[8]) || 0, powerMaxW: parseFloat(parts[9]) || 0,
          spec: lookupGpuSpec(parts[2]),
        });
      }
    }
  }

  // 프로세스 파싱
  const procSection = (sections[2] || '').trim();
  if (procSection && procSection !== 'NO_PROC') {
    for (const line of procSection.split('\n')) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length >= 4) {
        const procName = parts[2];
        processes.push({
          gpuIndex: uuidToIndex.get(parts[0]) ?? -1,
          pid: parseInt(parts[1], 10) || 0,
          name: procName,
          memMb: parseFloat(parts[3]) || 0,
          isLlm: isLlmProcess(procName),
        });
      }
    }
  }

  // 시스템 메트릭 파싱
  const sysSection = (sections[3] || '').trim();
  if (sysSection) {
    const lines = sysSection.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines[0]) cpuLoadAvg = parseFloat(lines[0]) || null;
    if (lines[1]) {
      const [total, used] = lines[1].split(/\s+/);
      memoryTotalMb = parseFloat(total) || null;
      memoryUsedMb = parseFloat(used) || null;
    }
    if (lines[2]) cpuCores = parseInt(lines[2], 10) || null;
    if (lines[3]) hostname = lines[3];
  }

  // LLM 자동 탐지 파싱
  const llmSection = (sections[4] || '').trim();
  if (llmSection) {
    // 포트별 블록 파싱
    const portBlocks = llmSection.split('---ENDPORT---').filter(Boolean);
    for (const block of portBlocks) {
      const lines = block.trim().split('\n').filter(Boolean);
      if (lines.length === 0) continue;

      const headerMatch = lines[0].match(/PORT:(\d+)\|CONTAINER:(.*)/);
      if (!headerMatch) continue;

      const port = parseInt(headerMatch[1], 10);
      const containerParts = (headerMatch[2] || '').split('|');
      const containerName = containerParts[1] || '';
      const containerImage = containerParts[2] || '';

      // /v1/models JSON에서 모델명 추출 (가장 확실)
      const modelNames: string[] = [];
      const modelsLine = lines.find(l => l.startsWith('MODELS_JSON:'));
      if (modelsLine) {
        try {
          const json = JSON.parse(modelsLine.replace('MODELS_JSON:', ''));
          const models = json.data || json.models || [];
          for (const m of models) {
            const name = m.id || m.model || m.name;
            if (name) modelNames.push(name);
          }
        } catch { /* json parse fail */ }
      }

      // Prometheus 메트릭 파싱 (MODELS_JSON 줄 제외)
      const promLines = lines.slice(1).filter(l => !l.startsWith('MODELS_JSON:'));
      const { metrics: prom, raw: promRaw } = parsePrometheusLines(promLines);
      const rawMetrics: Record<string, number> = {};
      for (const [k, v] of prom) rawMetrics[k] = v;

      const type = extractLlmType(prom, containerImage);
      const extracted = extractLlmMetricsFromProm(prom, type);

      // 모델명 fallback: Prometheus 라벨에서 model_name 추출
      if (modelNames.length === 0) {
        for (const pl of promRaw) {
          const m = pl.labels.match(/model_name="([^"]+)"/);
          if (m && !modelNames.includes(m[1])) { modelNames.push(m[1]); break; }
        }
      }
      if (modelNames.length === 0 && containerName) {
        modelNames.push(containerName);
      }

      llmEndpoints.push({
        port, containerName, containerImage, type,
        modelNames,
        runningRequests: extracted.runningRequests ?? null,
        waitingRequests: extracted.waitingRequests ?? null,
        kvCacheUsagePct: extracted.kvCacheUsagePct ?? null,
        promptThroughputTps: extracted.promptThroughputTps ?? null,
        genThroughputTps: extracted.genThroughputTps ?? null,
        rawMetrics,
      });
    }

    // Ollama (CLI)
    const ollamaCli = llmSection.match(/OLLAMA_CLI:([\s\S]*?)(?=OLLAMA_PS:|==ENDLLM==|$)/);
    if (ollamaCli) {
      const cliLines = ollamaCli[1].trim().split('\n').filter(l => l && !l.startsWith('NAME'));
      for (const line of cliLines) {
        const parts = line.trim().split(/\s+/);
        if (parts[0]) {
          llmEndpoints.push({
            port: 11434, containerName: 'ollama', containerImage: 'ollama', type: 'ollama',
            modelNames: [parts[0]], runningRequests: null, waitingRequests: null,
            kvCacheUsagePct: null, promptThroughputTps: null, genThroughputTps: null, rawMetrics: {},
          });
        }
      }
    }

    // Ollama (API)
    const ollamaApi = llmSection.match(/OLLAMA_PS:(.+)/);
    if (ollamaApi && !ollamaCli) {
      try {
        const data = JSON.parse(ollamaApi[1]);
        if (data.models && Array.isArray(data.models)) {
          for (const m of data.models) {
            llmEndpoints.push({
              port: 11434, containerName: 'ollama', containerImage: 'ollama', type: 'ollama',
              modelNames: [m.name || m.model || 'unknown'],
              runningRequests: null, waitingRequests: null, kvCacheUsagePct: null,
              promptThroughputTps: null, genThroughputTps: null, rawMetrics: {},
            });
          }
        }
      } catch { /* ignore */ }
    }
  }

  return { gpus, processes, llmEndpoints, cpuLoadAvg, cpuCores, memoryTotalMb, memoryUsedMb, hostname };
}

// ================================================================
// 인메모리 캐시 & 폴링 관리
// ================================================================
const latestMetrics = new Map<string, ServerMetrics>();
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();
const pollLocks = new Map<string, boolean>();

export function getAllLatestMetrics(): ServerMetrics[] {
  return Array.from(latestMetrics.values());
}

export function getLatestMetrics(serverId: string): ServerMetrics | undefined {
  return latestMetrics.get(serverId);
}

async function pollServer(server: { id: string; name: string; host: string; sshPort: number; sshUsername: string; sshPassword: string; isLocal: boolean }) {
  if (pollLocks.get(server.id)) return;
  pollLocks.set(server.id, true);

  try {
    let output: string;
    if (server.isLocal) {
      const { stdout } = await execAsync(METRICS_CMD, { timeout: 30000, shell: '/bin/sh' });
      output = stdout;
    } else {
      const password = decryptPassword(server.sshPassword);
      output = await sshExec(server.host, server.sshPort, server.sshUsername, password, METRICS_CMD);
    }

    const parsed = parseFullOutput(output);
    const metrics: ServerMetrics = {
      serverId: server.id, serverName: server.name, timestamp: new Date(),
      ...parsed,
    };

    latestMetrics.set(server.id, metrics);

    // GPU 데이터가 없으면 DB 저장 스킵 (간헐적 SSH 파싱 실패 방지)
    if (parsed.gpus.length === 0 && parsed.cpuLoadAvg == null) {
      return;
    }

    await prisma.gpuMetricSnapshot.create({
      data: {
        serverId: server.id,
        gpuMetrics: parsed.gpus as any,
        cpuLoadAvg: parsed.cpuLoadAvg,
        cpuCores: parsed.cpuCores,
        memoryTotalMb: parsed.memoryTotalMb,
        memoryUsedMb: parsed.memoryUsedMb,
        hostname: parsed.hostname,
        gpuProcesses: parsed.processes as any,
        llmMetrics: parsed.llmEndpoints as any,
      },
    });
  } catch (err: any) {
    // 에러 시 이전 메트릭에 에러 표시만 추가 (빈 데이터로 덮어쓰지 않음)
    const prev = latestMetrics.get(server.id);
    latestMetrics.set(server.id, {
      serverId: server.id, serverName: server.name, timestamp: new Date(),
      error: err.message || 'Unknown error',
      gpus: prev?.gpus || [], processes: prev?.processes || [], llmEndpoints: prev?.llmEndpoints || [],
      cpuLoadAvg: prev?.cpuLoadAvg ?? null, cpuCores: prev?.cpuCores ?? null,
      memoryTotalMb: prev?.memoryTotalMb ?? null, memoryUsedMb: prev?.memoryUsedMb ?? null,
      hostname: prev?.hostname ?? null,
    });
  } finally {
    pollLocks.set(server.id, false);
  }
}

export async function startPolling(server: { id: string; name: string; host: string; sshPort: number; sshUsername: string; sshPassword: string; isLocal: boolean; pollIntervalSec: number }) {
  stopPolling(server.id);
  console.log(`[GPU Monitor] Starting polling for "${server.name}" (${server.host}) every ${server.pollIntervalSec}s`);
  await pollServer(server);
  const interval = setInterval(() => pollServer(server), server.pollIntervalSec * 1000);
  pollTimers.set(server.id, interval);
}

export function stopPolling(serverId: string) {
  const existing = pollTimers.get(serverId);
  if (existing) { clearInterval(existing); pollTimers.delete(serverId); }
  latestMetrics.delete(serverId);
  pollLocks.delete(serverId);
}

export async function testSshConnection(
  host: string, port: number, username: string, password: string
): Promise<{ success: boolean; message: string; gpuInfo?: string; hostname?: string }> {
  try {
    const testCmd = 'echo "==GPU=="; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "NO_GPU"; echo "==HOST=="; hostname; echo "==DOCKER=="; docker ps --format "{{.Names}}: {{.Image}}" 2>/dev/null | head -10 || echo "NO_DOCKER"';
    const output = await sshExec(host, port, username, password, testCmd, 10000);

    const gpuPart = (output.split('==HOST==')[0] || '').replace('==GPU==', '').trim();
    const hostPart = (output.split('==HOST==')[1] || '').split('==DOCKER==')[0].trim();
    const dockerPart = (output.split('==DOCKER==')[1] || '').trim();

    const info = [
      gpuPart === 'NO_GPU' ? 'GPU: 없음' : `GPU:\n${gpuPart}`,
      dockerPart === 'NO_DOCKER' ? 'Docker: 없음' : `Docker 컨테이너:\n${dockerPart}`,
    ].join('\n\n');

    return { success: true, message: 'SSH 연결 성공', gpuInfo: info, hostname: hostPart };
  } catch (err: any) {
    return { success: false, message: `SSH 연결 실패: ${err.message}` };
  }
}

export async function startGpuMonitorCron() {
  try {
    const servers = await prisma.gpuServer.findMany({ where: { enabled: true } });
    console.log(`[GPU Monitor] Found ${servers.length} enabled server(s)`);

    for (const server of servers) {
      startPolling(server).catch(err =>
        console.error(`[GPU Monitor] Failed to start polling for "${server.name}":`, err)
      );
    }

    // 오래된 스냅샷 정리 (매 6시간, 30일 이상 삭제)
    setInterval(async () => {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const result = await prisma.gpuMetricSnapshot.deleteMany({ where: { timestamp: { lt: cutoff } } });
        if (result.count > 0) console.log(`[GPU Monitor] Cleaned up ${result.count} old snapshots`);
      } catch (err) {
        console.error('[GPU Monitor] Cleanup error:', err);
      }
    }, 6 * 60 * 60 * 1000);
  } catch (err) {
    console.error('[GPU Monitor] Failed to start cron:', err);
  }
}
