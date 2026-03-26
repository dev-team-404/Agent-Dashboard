/**
 * GPU Monitor Service
 *
 * SSH 기반 GPU 서버 실시간 모니터링
 * - nvidia-smi로 GPU 메트릭 수집
 * - 시스템 메트릭 (CPU, RAM) 수집
 * - 프로세스 목록에서 LLM 서빙 감지
 * - 주기적 폴링 + DB 저장 + 인메모리 캐시
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
function sshExec(host: string, port: number, username: string, password: string, command: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('SSH timeout'));
    }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        let stdout = '';
        stream.on('data', (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on('data', () => {}); // ignore stderr
        stream.on('close', () => {
          clearTimeout(timer);
          conn.end();
          resolve(stdout);
        });
      });
    });
    conn.on('error', (err) => { clearTimeout(timer); reject(err); });
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
// nvidia-smi 메트릭 수집 명령어
// ================================================================
const METRICS_CMD = [
  'echo "==GPU=="',
  'nvidia-smi --query-gpu=index,uuid,name,memory.total,memory.used,utilization.gpu,utilization.memory,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits 2>/dev/null || echo "NO_GPU"',
  'echo "==PROC=="',
  'nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_gpu_memory --format=csv,noheader,nounits 2>/dev/null || echo "NO_PROC"',
  'echo "==SYS=="',
  "awk '{print $1}' /proc/loadavg",
  "free -m | awk '/Mem:/{print $2,$3}'",
  'nproc',
  'hostname',
].join('; ');

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
// 출력 파싱
// ================================================================
export interface GpuInfo {
  index: number;
  uuid: string;
  name: string;
  memTotalMb: number;
  memUsedMb: number;
  utilGpu: number;
  utilMem: number;
  temp: number;
  powerW: number;
  powerMaxW: number;
}

export interface GpuProcess {
  gpuIndex: number;
  pid: number;
  name: string;
  memMb: number;
  isLlm: boolean;
}

export interface ServerMetrics {
  serverId: string;
  serverName: string;
  timestamp: Date;
  error?: string;
  gpus: GpuInfo[];
  processes: GpuProcess[];
  cpuLoadAvg: number | null;
  cpuCores: number | null;
  memoryTotalMb: number | null;
  memoryUsedMb: number | null;
  hostname: string | null;
}

function parseMetricsOutput(output: string): Omit<ServerMetrics, 'serverId' | 'serverName' | 'timestamp'> {
  const gpus: GpuInfo[] = [];
  const processes: GpuProcess[] = [];
  let cpuLoadAvg: number | null = null;
  let cpuCores: number | null = null;
  let memoryTotalMb: number | null = null;
  let memoryUsedMb: number | null = null;
  let hostname: string | null = null;

  const sections = output.split(/==(?:GPU|PROC|SYS)==/);
  // sections[0] = before ==GPU== (empty)
  // sections[1] = GPU data
  // sections[2] = PROC data
  // sections[3] = SYS data

  // UUID → index 매핑
  const uuidToIndex = new Map<string, number>();

  // GPU 파싱
  const gpuSection = (sections[1] || '').trim();
  if (gpuSection && gpuSection !== 'NO_GPU') {
    for (const line of gpuSection.split('\n')) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length >= 10) {
        const idx = parseInt(parts[0], 10);
        const uuid = parts[1];
        uuidToIndex.set(uuid, idx);
        gpus.push({
          index: idx,
          uuid,
          name: parts[2],
          memTotalMb: parseFloat(parts[3]) || 0,
          memUsedMb: parseFloat(parts[4]) || 0,
          utilGpu: parseFloat(parts[5]) || 0,
          utilMem: parseFloat(parts[6]) || 0,
          temp: parseFloat(parts[7]) || 0,
          powerW: parseFloat(parts[8]) || 0,
          powerMaxW: parseFloat(parts[9]) || 0,
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
        const gpuUuid = parts[0];
        const gpuIndex = uuidToIndex.get(gpuUuid) ?? -1;
        const procName = parts[2];
        processes.push({
          gpuIndex,
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
    // Line 0: load average (1 min)
    if (lines[0]) cpuLoadAvg = parseFloat(lines[0]) || null;
    // Line 1: "totalMb usedMb"
    if (lines[1]) {
      const [total, used] = lines[1].split(/\s+/);
      memoryTotalMb = parseFloat(total) || null;
      memoryUsedMb = parseFloat(used) || null;
    }
    // Line 2: nproc
    if (lines[2]) cpuCores = parseInt(lines[2], 10) || null;
    // Line 3: hostname
    if (lines[3]) hostname = lines[3];
  }

  return { gpus, processes, cpuLoadAvg, cpuCores, memoryTotalMb, memoryUsedMb, hostname };
}

// ================================================================
// 인메모리 캐시 & 폴링 관리
// ================================================================
const latestMetrics = new Map<string, ServerMetrics>();
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();
const pollLocks = new Map<string, boolean>();

/** 모든 서버의 최신 메트릭 조회 */
export function getAllLatestMetrics(): ServerMetrics[] {
  return Array.from(latestMetrics.values());
}

/** 특정 서버의 최신 메트릭 조회 */
export function getLatestMetrics(serverId: string): ServerMetrics | undefined {
  return latestMetrics.get(serverId);
}

/** 단일 서버 폴링 */
async function pollServer(server: { id: string; name: string; host: string; sshPort: number; sshUsername: string; sshPassword: string; isLocal: boolean }) {
  if (pollLocks.get(server.id)) return;
  pollLocks.set(server.id, true);

  try {
    let output: string;
    if (server.isLocal) {
      const { stdout } = await execAsync(`bash -c '${METRICS_CMD}'`, { timeout: 15000 });
      output = stdout;
    } else {
      const password = decryptPassword(server.sshPassword);
      output = await sshExec(server.host, server.sshPort, server.sshUsername, password, METRICS_CMD);
    }

    const parsed = parseMetricsOutput(output);
    const metrics: ServerMetrics = {
      serverId: server.id,
      serverName: server.name,
      timestamp: new Date(),
      ...parsed,
    };

    latestMetrics.set(server.id, metrics);

    // DB 저장
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
      },
    });
  } catch (err: any) {
    latestMetrics.set(server.id, {
      serverId: server.id,
      serverName: server.name,
      timestamp: new Date(),
      error: err.message || 'Unknown error',
      gpus: [],
      processes: [],
      cpuLoadAvg: null,
      cpuCores: null,
      memoryTotalMb: null,
      memoryUsedMb: null,
      hostname: null,
    });
  } finally {
    pollLocks.set(server.id, false);
  }
}

/** 서버 폴링 시작 */
export async function startPolling(server: { id: string; name: string; host: string; sshPort: number; sshUsername: string; sshPassword: string; isLocal: boolean; pollIntervalSec: number }) {
  stopPolling(server.id);
  console.log(`[GPU Monitor] Starting polling for "${server.name}" (${server.host}) every ${server.pollIntervalSec}s`);

  // 즉시 첫 폴링
  await pollServer(server);

  const interval = setInterval(() => pollServer(server), server.pollIntervalSec * 1000);
  pollTimers.set(server.id, interval);
}

/** 서버 폴링 중지 */
export function stopPolling(serverId: string) {
  const existing = pollTimers.get(serverId);
  if (existing) {
    clearInterval(existing);
    pollTimers.delete(serverId);
  }
  latestMetrics.delete(serverId);
  pollLocks.delete(serverId);
}

/** SSH 연결 테스트 */
export async function testSshConnection(
  host: string, port: number, username: string, password: string
): Promise<{ success: boolean; message: string; gpuInfo?: string; hostname?: string }> {
  try {
    const testCmd = 'echo "==GPU=="; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "NO_GPU"; echo "==HOST=="; hostname';
    const output = await sshExec(host, port, username, password, testCmd, 10000);

    const parts = output.split('==HOST==');
    const gpuPart = (parts[0] || '').replace('==GPU==', '').trim();
    const hostPart = (parts[1] || '').trim();

    return {
      success: true,
      message: 'SSH 연결 성공',
      gpuInfo: gpuPart === 'NO_GPU' ? '(GPU 없음)' : gpuPart,
      hostname: hostPart,
    };
  } catch (err: any) {
    return { success: false, message: `SSH 연결 실패: ${err.message}` };
  }
}

/** 서버 시작 시 모든 활성 서버 폴링 시작 + 오래된 데이터 정리 크론 */
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
        const result = await prisma.gpuMetricSnapshot.deleteMany({
          where: { timestamp: { lt: cutoff } },
        });
        if (result.count > 0) {
          console.log(`[GPU Monitor] Cleaned up ${result.count} old snapshots`);
        }
      } catch (err) {
        console.error('[GPU Monitor] Cleanup error:', err);
      }
    }, 6 * 60 * 60 * 1000);
  } catch (err) {
    console.error('[GPU Monitor] Failed to start cron:', err);
  }
}
