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
  const [ivHex, tagHex, data] = encrypted.split(':');
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
// SSH 명령어: GPU + 시스템 + LLM 자동 탐지 전부 한 번에
// ================================================================
// 줄바꿈 유지 (for/if/do/done 호환) — SSH exec는 multiline 명령을 그대로 지원
const METRICS_CMD = [
  'NSMI=$(which nvidia-smi 2>/dev/null || echo /usr/lib/wsl/lib/nvidia-smi || echo /usr/bin/nvidia-smi)',
  'echo "==GPU=="',
  '$NSMI --query-gpu=index,uuid,name,memory.total,memory.used,utilization.gpu,utilization.memory,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits 2>/dev/null || echo "NO_GPU"',
  'echo "==PROC=="',
  '$NSMI --query-compute-apps=gpu_uuid,pid,process_name,used_gpu_memory --format=csv,noheader,nounits 2>/dev/null || echo "NO_PROC"',
  'echo "==SYS=="',
  "awk '{print $1}' /proc/loadavg",
  "free -m | awk '/Mem:/{print $2,$3}'",
  'nproc',
  'hostname',
  'echo "==LLM=="',
  'for port in $(docker ps --format "{{.Ports}}" 2>/dev/null | grep -oP "0\\.0\\.0\\.0:\\K[0-9]+" | sort -u); do RESP=$(curl -s --max-time 3 "http://localhost:$port/metrics" 2>/dev/null); if echo "$RESP" | grep -qE "vllm:|sglang:|tgi_"; then CNAME=$(docker ps --format "{{.Ports}}|{{.Names}}|{{.Image}}" 2>/dev/null | grep "0\\.0\\.0\\.0:$port->" | head -1); echo "PORT:$port|CONTAINER:$CNAME"; echo "$RESP" | grep -E "^(vllm:|sglang:|tgi_)[a-zA-Z_:]+ "; echo "---ENDPORT---"; fi; done',
  'OLLAMA_OUT=$(curl -s --max-time 3 http://localhost:11434/api/ps 2>/dev/null); if [ -n "$OLLAMA_OUT" ] && echo "$OLLAMA_OUT" | grep -q \'"models"\'; then echo "OLLAMA_PS:$OLLAMA_OUT"; fi',
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
// 타입 정의
// ================================================================
export interface GpuInfo {
  index: number; uuid: string; name: string;
  memTotalMb: number; memUsedMb: number;
  utilGpu: number; utilMem: number;
  temp: number; powerW: number; powerMaxW: number;
}

export interface GpuProcess {
  gpuIndex: number; pid: number; name: string; memMb: number; isLlm: boolean;
}

export interface LlmEndpointMetrics {
  port: number;
  containerName: string;
  containerImage: string;
  type: 'vllm' | 'sglang' | 'tgi' | 'ollama' | 'unknown';
  modelName: string | null;
  runningRequests: number | null;
  waitingRequests: number | null;
  kvCacheUsagePct: number | null;
  promptThroughputTps: number | null;
  genThroughputTps: number | null;
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
function parsePrometheusLines(lines: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    // "metric_name{labels} value" 또는 "metric_name value"
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([0-9.eE+\-]+)/);
    if (match) m.set(match[1], parseFloat(match[2]));
  }
  return m;
}

function extractLlmType(prom: Map<string, number>): 'vllm' | 'sglang' | 'tgi' | 'unknown' {
  for (const key of prom.keys()) {
    if (key.startsWith('vllm:')) return 'vllm';
    if (key.startsWith('sglang:')) return 'sglang';
    if (key.startsWith('tgi_')) return 'tgi';
  }
  return 'unknown';
}

function extractLlmMetricsFromProm(prom: Map<string, number>, type: string): Partial<LlmEndpointMetrics> {
  switch (type) {
    case 'vllm':
      return {
        runningRequests: prom.get('vllm:num_requests_running') ?? null,
        waitingRequests: prom.get('vllm:num_requests_waiting') ?? null,
        kvCacheUsagePct: prom.has('vllm:gpu_cache_usage_perc') ? (prom.get('vllm:gpu_cache_usage_perc')! * 100) : null,
        promptThroughputTps: prom.get('vllm:avg_prompt_throughput_toks_per_s') ?? null,
        genThroughputTps: prom.get('vllm:avg_generation_throughput_toks_per_s') ?? null,
      };
    case 'sglang':
      return {
        runningRequests: prom.get('sglang:num_running_reqs') ?? null,
        waitingRequests: prom.get('sglang:num_waiting_reqs') ?? null,
        kvCacheUsagePct: prom.has('sglang:token_usage') ? (prom.get('sglang:token_usage')! * 100) : null,
        genThroughputTps: prom.get('sglang:gen_throughput') ?? null,
      };
    case 'tgi':
      return {
        runningRequests: prom.get('tgi_request_count') ?? null,
        waitingRequests: prom.get('tgi_queue_size') ?? null,
      };
    default:
      return {};
  }
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
    // Prometheus 기반 (vLLM/SGLang/TGI)
    const portBlocks = llmSection.split('---ENDPORT---').filter(Boolean);
    for (const block of portBlocks) {
      const lines = block.trim().split('\n').filter(Boolean);
      if (lines.length === 0) continue;

      // 첫 줄: PORT:8000|CONTAINER:ports|name|image
      const headerMatch = lines[0].match(/PORT:(\d+)\|CONTAINER:(.*)/);
      if (!headerMatch) continue;

      const port = parseInt(headerMatch[1], 10);
      const containerParts = (headerMatch[2] || '').split('|');
      const containerName = containerParts[1] || '';
      const containerImage = containerParts[2] || '';

      // 나머지: Prometheus 메트릭 라인
      const promLines = lines.slice(1);
      const prom = parsePrometheusLines(promLines);
      const type = extractLlmType(prom);
      const extracted = extractLlmMetricsFromProm(prom, type);

      // 모델명 추출 시도 (이미지명이나 컨테이너명에서)
      let modelName: string | null = null;
      const modelMatch = containerImage.match(/([^/]+)$/);
      if (modelMatch) modelName = modelMatch[1];
      // vLLM model_name 메트릭에서도 시도
      for (const key of prom.keys()) {
        const labelMatch = key.match(/model_name="([^"]+)"/);
        if (labelMatch) { modelName = labelMatch[1]; break; }
      }

      llmEndpoints.push({
        port, containerName, containerImage, type,
        modelName,
        runningRequests: extracted.runningRequests ?? null,
        waitingRequests: extracted.waitingRequests ?? null,
        kvCacheUsagePct: extracted.kvCacheUsagePct ?? null,
        promptThroughputTps: extracted.promptThroughputTps ?? null,
        genThroughputTps: extracted.genThroughputTps ?? null,
      });
    }

    // Ollama
    const ollamaMatch = llmSection.match(/OLLAMA_PS:(.+)/);
    if (ollamaMatch) {
      try {
        const data = JSON.parse(ollamaMatch[1]);
        if (data.models && Array.isArray(data.models)) {
          for (const m of data.models) {
            llmEndpoints.push({
              port: 11434,
              containerName: 'ollama',
              containerImage: 'ollama',
              type: 'ollama',
              modelName: m.name || m.model || null,
              runningRequests: null,
              waitingRequests: null,
              kvCacheUsagePct: null,
              promptThroughputTps: null,
              genThroughputTps: null,
            });
          }
        }
      } catch { /* ignore parse error */ }
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
