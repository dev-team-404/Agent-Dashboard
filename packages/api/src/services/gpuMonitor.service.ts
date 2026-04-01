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
import { prisma, pgPool } from '../index.js';

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
  'df -BG / 2>/dev/null | awk "NR==2{gsub(/G/,\\"\\"); print \\$2,\\$3,\\$4}"',
  // LLM 탐지: vllm/sglang/tgi/lmdeploy 이미지 컨테이너만 스캔
  'echo "==LLM=="',
  'docker ps --format "{{.Ports}}|{{.Names}}|{{.Image}}" 2>/dev/null | grep -iE "vllm|sglang|tgi|text-generation|lmdeploy|aphrodite" | grep -viE "prometheus|exporter|grafana|monitor" | while IFS="|" read PORTS CNAME CIMAGE; do'
  + ' port=$(echo "$PORTS" | grep -o "0\\.0\\.0\\.0:[0-9]*" | head -1 | sed "s/0\\.0\\.0\\.0://");'
  + ' [ -z "$port" ] && continue;'
  + ' MODELS=$(curl -s --max-time 2 "http://localhost:$port/v1/models" 2>/dev/null);'
  + ' METRICS=$(curl -s --max-time 3 "http://localhost:$port/metrics" 2>/dev/null);'
  + ' echo "PORT:$port|CONTAINER:$PORTS|$CNAME|$CIMAGE";'
  + ' echo "MODELS_JSON:$MODELS";'
  + ' echo "$METRICS" | grep -vE "^#|^$" | grep -iE "request|cache|throughput|running|waiting|queue|token|latency|flops|bytes|sleep|model_name|prompt|generation|batch|kv_|accepted|spec_decode|ttft|tpot|first_token|per_output|e2e_|preemption|hit_rate|iteration" | head -200;'
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
  fp8Tflops: number;       // FP8 이론 성능 (TFLOPS)
  memBandwidthGBs: number; // 메모리 대역폭 (GB/s)
  tdpW: number;            // TDP (W)
  vramGb: number;          // VRAM (GB)
  label: string;           // 표시 이름
}

export const B300_SPEC: GpuSpec = { fp16Tflops: 2250, fp8Tflops: 4500, memBandwidthGBs: 8000, tdpW: 1000, vramGb: 192, label: 'B300' };

const GPU_SPECS: Array<{ pattern: RegExp; spec: GpuSpec }> = [
  { pattern: /B300/i,        spec: B300_SPEC },
  { pattern: /H200.*SXM/i,  spec: { fp16Tflops: 989, fp8Tflops: 1979, memBandwidthGBs: 4800, tdpW: 700, vramGb: 141, label: 'H200 SXM' } },
  { pattern: /H200/i,       spec: { fp16Tflops: 989, fp8Tflops: 1979, memBandwidthGBs: 4800, tdpW: 700, vramGb: 141, label: 'H200' } },
  { pattern: /H100.*SXM/i,  spec: { fp16Tflops: 989, fp8Tflops: 1979, memBandwidthGBs: 3350, tdpW: 700, vramGb: 80, label: 'H100 SXM' } },
  { pattern: /H100.*PCIe/i, spec: { fp16Tflops: 756, fp8Tflops: 1513, memBandwidthGBs: 2000, tdpW: 350, vramGb: 80, label: 'H100 PCIe' } },
  { pattern: /H100/i,       spec: { fp16Tflops: 989, fp8Tflops: 1979, memBandwidthGBs: 3350, tdpW: 700, vramGb: 80, label: 'H100' } },
  { pattern: /L40S/i,       spec: { fp16Tflops: 362, fp8Tflops: 733, memBandwidthGBs: 864, tdpW: 350, vramGb: 48, label: 'L40S' } },
  { pattern: /A100.*80/i,   spec: { fp16Tflops: 312, fp8Tflops: 312, memBandwidthGBs: 2039, tdpW: 400, vramGb: 80, label: 'A100 80GB' } }, // A100은 FP8 미지원
  { pattern: /A100/i,       spec: { fp16Tflops: 312, fp8Tflops: 312, memBandwidthGBs: 1555, tdpW: 400, vramGb: 40, label: 'A100 40GB' } },
  { pattern: /RTX.*4090/i,  spec: { fp16Tflops: 165, fp8Tflops: 330, memBandwidthGBs: 1008, tdpW: 450, vramGb: 24, label: 'RTX 4090' } },
  { pattern: /RTX.*4070/i,  spec: { fp16Tflops: 73,  fp8Tflops: 146, memBandwidthGBs: 504,  tdpW: 200, vramGb: 12, label: 'RTX 4070' } },
];

export function lookupGpuSpec(gpuName: string): GpuSpec | null {
  for (const entry of GPU_SPECS) {
    if (entry.pattern.test(gpuName)) return entry.spec;
  }
  return null;
}

// ================================================================
// 모델 파라미터 수 추정 (이름에서 파싱)
// ================================================================
const MODEL_SIZE_PATTERNS: Array<{ pattern: RegExp; billionParams: number }> = [
  { pattern: /(\d+)[xX](\d+)[bB]/i, billionParams: 0 }, // MoE: 8x7B → 특수 처리
  { pattern: /(\d+\.?\d*)\s*[bB]/i, billionParams: 0 },  // 70B, 7.5B → 숫자 추출
];

export function estimateModelParams(modelName: string): number | null {
  if (!modelName) return null;
  const lower = modelName.toLowerCase();
  // 1. A숫자B 형식 (MoE active params): Qwen3.5-35B-A3B → active 3B (최우선)
  const aMatch = modelName.match(/\d+\.?\d*[bB]-A(\d+\.?\d*)[bB]/i);
  if (aMatch) return parseFloat(aMatch[1]);
  // 2. NxMB 형식 (MoE): 8x7B → active ≈ total / 4 (top-2 of 8 가정)
  const moe = modelName.match(/(\d+)[xX](\d+\.?\d*)[bB]/i);
  if (moe) { const total = parseFloat(moe[1]) * parseFloat(moe[2]); return Math.round(total / 4 * 10) / 10; }
  // 3. 일반 모델: 70B, 8B, 0.5B 등 (B suffix 명시)
  const match = modelName.match(/(\d+\.?\d*)\s*[bB](?![a-z])/i);
  if (match && parseFloat(match[1]) > 0) return parseFloat(match[1]);
  // 알려진 모델 매핑 (B suffix 없는 경우)
  // MoE 모델은 active params 반환 (throughput = bandwidth / active_params)
  // GLM-5: 744B total, 40B active (MoE, Zhipu AI 공식)
  if (lower.includes('glm-5') || lower.includes('glm5')) return 40;
  if (lower.includes('glm-4') || lower.includes('glm4')) return 32; // GLM-4.5: 355B total, 32B active
  // Kimi-K2.5: 1T total, 32B active (MoE, Moonshot AI 공식)
  if (lower.includes('kimi-k2') || lower.includes('kimi')) return 32;
  // DeepSeek: MoE
  if (lower.includes('deepseek-v3') || lower.includes('deepseek-r1')) return 37; // 671B total, 37B active
  if (lower.includes('deepseek-v2')) return 21; // 236B total, 21B active
  if (lower.includes('claude')) return 200;
  if (lower.includes('gpt-4')) return 200;
  if (lower.includes('gpt-3.5')) return 20;
  if (lower.includes('llama-3.1-405') || lower.includes('llama-405')) return 405;
  if (lower.includes('llama-3.1-70') || lower.includes('llama-70')) return 70;
  if (lower.includes('llama-3.1-8') || lower.includes('llama-8')) return 8;
  if (lower.includes('qwen') && lower.includes('72')) return 72;
  if (lower.includes('qwen') && lower.includes('32')) return 32;
  if (lower.includes('qwen') && lower.includes('14')) return 14;
  if (lower.includes('qwen') && lower.includes('7')) return 7;
  if (lower.includes('mistral') && lower.includes('large')) return 123;
  if (lower.includes('mistral') && lower.includes('7')) return 7;
  if (lower.includes('gemma') && lower.includes('27')) return 27;
  if (lower.includes('gemma') && lower.includes('9')) return 9;
  if (lower.includes('gemma') && lower.includes('2')) return 2;
  if (lower.includes('phi-4')) return 14;
  if (lower.includes('phi-3')) return 14;
  if (lower.includes('phi-2')) return 2.7;
  // MiniMax / MiniCPM
  if (lower.includes('minimax') || lower.includes('abab')) return 45.9; // MiniMax-01: 456B total, 45.9B active (MoE)
  if (lower.includes('minicpm') && lower.includes('2.4')) return 2.4;
  if (lower.includes('minicpm')) return 4;
  // Command R
  if (lower.includes('command-r-plus') || lower.includes('command-r+')) return 104;
  if (lower.includes('command-r')) return 35;
  // Yi
  if (lower.includes('yi-large') || lower.includes('yi-34')) return 34;
  if (lower.includes('yi-1.5-34') || lower.includes('yi-34')) return 34;
  if (lower.includes('yi-1.5-9') || lower.includes('yi-9')) return 9;
  if (lower.includes('yi-1.5-6') || lower.includes('yi-6')) return 6;
  // InternLM
  if (lower.includes('internlm') && lower.includes('20')) return 20;
  if (lower.includes('internlm') && lower.includes('7')) return 7;
  // Baichuan
  if (lower.includes('baichuan') && lower.includes('13')) return 13;
  if (lower.includes('baichuan') && lower.includes('7')) return 7;
  // ChatGLM
  if (lower.includes('chatglm') && lower.includes('130')) return 130;
  if (lower.includes('chatglm') && lower.includes('66')) return 66;
  if (lower.includes('chatglm') && lower.includes('6')) return 6;
  // SOLAR
  if (lower.includes('solar') && lower.includes('10.7')) return 10.7;
  if (lower.includes('solar')) return 10.7;
  // Mixtral (MoE, active params)
  if (lower.includes('mixtral') && lower.includes('8x22')) return 39; // 176B total, ~39B active
  if (lower.includes('mixtral') && lower.includes('8x7')) return 12.9; // 46.7B total, 12.9B active
  // Falcon
  if (lower.includes('falcon') && lower.includes('180')) return 180;
  if (lower.includes('falcon') && lower.includes('40')) return 40;
  if (lower.includes('falcon') && lower.includes('7')) return 7;
  // Codestral / Codellama
  if (lower.includes('codestral')) return 22;
  if (lower.includes('codellama') && lower.includes('34')) return 34;
  if (lower.includes('codellama') && lower.includes('13')) return 13;
  if (lower.includes('codellama') && lower.includes('7')) return 7;
  // Jamba (MoE, active params)
  if (lower.includes('jamba') && lower.includes('1.5')) return 94; // 398B total, ~94B active
  if (lower.includes('jamba')) return 12; // 52B total, ~12B active
  // Nemotron
  if (lower.includes('nemotron') && lower.includes('340')) return 340;
  if (lower.includes('nemotron') && lower.includes('70')) return 70;
  // Nous / Hermes
  if (lower.includes('hermes') && lower.includes('405')) return 405;
  if (lower.includes('hermes') && lower.includes('70')) return 70;
  if (lower.includes('hermes') && lower.includes('8')) return 8;
  // StarCoder
  if (lower.includes('starcoder') && lower.includes('15')) return 15;
  if (lower.includes('starcoder') && lower.includes('7')) return 7;
  if (lower.includes('starcoder') && lower.includes('3')) return 3;
  // Vicuna / LLaVA
  if (lower.includes('vicuna') && lower.includes('33')) return 33;
  if (lower.includes('vicuna') && lower.includes('13')) return 13;
  if (lower.includes('vicuna') && lower.includes('7')) return 7;
  if (lower.includes('llava')) return 13;
  // EXAONE
  if (lower.includes('exaone') && lower.includes('32')) return 32;
  if (lower.includes('exaone') && lower.includes('7.8')) return 7.8;
  if (lower.includes('exaone') && lower.includes('2.4')) return 2.4;
  // Voxtral
  if (lower.includes('voxtral') && lower.includes('4b')) return 4;
  if (lower.includes('voxtral')) return 4;
  // ASR/Embedding 모델은 작음
  if (lower.includes('asr') || lower.includes('whisper') || lower.includes('voice')) return 1;
  if (lower.includes('embed') || lower.includes('bge') || lower.includes('e5')) return 0.5;
  if (lower.includes('rerank') || lower.includes('colbert') || lower.includes('splade')) return 0.5;
  // 모델명에서 마지막 숫자 추출 시도 (e.g. model-name-7 → 7B 추정)
  const lastNum = modelName.match(/[-_](\d+\.?\d*)$/);
  if (lastNum && parseFloat(lastNum[1]) >= 0.5 && parseFloat(lastNum[1]) <= 1000) return parseFloat(lastNum[1]);
  return null;
}

/**
 * 이론적 최대 처리량 계산
 *
 * LLM 추론에는 2가지 병목이 있음:
 * 1. Memory-bandwidth bound (배치 1): tok/s = bandwidth / model_size
 * 2. Compute bound (배치 N): tok/s = FLOPS / (2 * active_params) [각 토큰에 2*params FLOPs 필요]
 *
 * vLLM continuous batching에서는 compute bound가 적용됨.
 * 두 가지 중 더 낮은 값이 실제 상한.
 * 실무에서는 메모리 효율 ~60-70%이므로 0.65 보정.
 */
/** /v1/models root 경로나 모델명에서 precision 자동 감지 */
export function detectPrecision(modelInfo: string): 'fp8' | 'fp16' {
  const lower = modelInfo.toLowerCase();
  if (lower.includes('fp8') || lower.includes('-f8') || lower.includes('_fp8')) return 'fp8';
  return 'fp16';
}

export function calcTheoreticalMaxTps(spec: GpuSpec, gpuCount: number, modelParamsBillion: number, precision: 'fp8' | 'fp16' = 'fp16'): number {
  const flopsPerToken = 2 * modelParamsBillion * 1e9;
  const tflops = precision === 'fp8' ? spec.fp8Tflops : spec.fp16Tflops;
  const totalFlops = tflops * 1e12 * gpuCount;
  return totalFlops / flopsPerToken;
}

/**
 * 메모리 대역폭 기반 실용 최대 처리량
 *
 * 배치1: maxTps = bandwidth × efficiency / modelSize
 * vLLM continuous batching: 동시에 여러 토큰 처리 → 배치1의 4-12배
 *
 * TYPICAL_BATCH_FACTOR = 8: vLLM/SGLang 실 운영 환경에서의
 * 일반적인 동시 처리 배치 크기 (보수적 중간값)
 *
 * 결과: 0-100% 범위에서 의미 있는 사용률 도출 가능
 */
export function calcBandwidthMaxTps(spec: GpuSpec, gpuCount: number, modelParamsBillion: number, precision: 'fp8' | 'fp16' = 'fp16'): number {
  const bytesPerParam = precision === 'fp8' ? 1 : 2;
  const modelSizeBytes = modelParamsBillion * 1e9 * bytesPerParam;
  const totalBandwidth = spec.memBandwidthGBs * 1e9 * gpuCount; // bytes/s
  const efficiency = 0.65; // 메모리 효율 ~65%
  const TYPICAL_BATCH_FACTOR = 8; // continuous batching 환경 (vLLM 일반 운영 기준)
  return (totalBandwidth * efficiency * TYPICAL_BATCH_FACTOR) / modelSizeBytes;
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
  modelNames: string[];
  // 기본 메트릭
  runningRequests: number | null;
  waitingRequests: number | null;
  kvCacheUsagePct: number | null;
  promptThroughputTps: number | null;
  genThroughputTps: number | null;
  // 서비스 품질 메트릭 (투자 판단)
  ttftMs: number | null;              // Time To First Token (ms) — 사용자 체감 응답 속도
  tpotMs: number | null;              // Time Per Output Token (ms) — 스트리밍 속도
  e2eLatencyMs: number | null;        // End-to-End 요청 처리 시간 (ms)
  // 효율성 메트릭 (라우팅 판단)
  prefixCacheHitRate: number | null;  // Prefix cache hit rate (0~1) — GPU 효율
  preemptionCount: number | null;     // 요청 밀려남 횟수 — VRAM 부족 시그널
  queueTimeMs: number | null;         // 대기열 체류 시간 (ms)
  // AI 분석용
  precision: 'fp8' | 'fp16';        // 모델 서빙 정밀도 (root 경로에서 자동 감지)
  rawMetrics: Record<string, number>;
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
  diskTotalGb: number | null;
  diskUsedGb: number | null;
  diskFreeGb: number | null;
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

function extractLlmMetricsFromProm(prom: Map<string, number>, type: string, counterKey?: string): Partial<LlmEndpointMetrics> {
  if (type === 'vllm' || type === 'unknown') {
    const running = promGet(prom, 'num_requests_running');
    const waiting = promGet(prom, 'num_requests_waiting');
    const kvRaw = promGet(prom, 'kv_cache_usage_perc', 'gpu_cache_usage_perc');
    const kv = kvRaw != null ? (kvRaw <= 1 ? kvRaw * 100 : kvRaw) : null;
    // gauge 먼저, 없으면 counter 기반 throughput
    let promptTps = promGet(prom, 'avg_prompt_throughput_toks_per_s', 'prompt_tokens_per_second');
    let genTps = promGet(prom, 'avg_generation_throughput_toks_per_s', 'generation_tokens_per_second');
    // counter 기반 fallback (vLLM nightly: gauge 없고 counter만 있는 경우)
    if (promptTps == null && genTps == null && counterKey) {
      const promptTotal = promGet(prom, 'prompt_tokens_total');
      const genTotal = promGet(prom, 'generation_tokens_total') ?? promGet(prom, 'spec_decode_num_accepted_tokens_total');
      const now = Date.now();
      const prev = prevCounters.get(counterKey);
      if (prev && promptTotal != null && genTotal != null) {
        const dtSec = (now - prev.ts) / 1000;
        if (dtSec > 5) {
          promptTps = Math.max(0, (promptTotal - prev.promptTotal) / dtSec);
          genTps = Math.max(0, (genTotal - prev.genTotal) / dtSec);
        }
      }
      if (promptTotal != null || genTotal != null) {
        prevCounters.set(counterKey, { promptTotal: promptTotal || 0, genTotal: genTotal || 0, ts: now });
      }
    }
    // 서비스 품질 메트릭 (히스토그램 _sum/_count → 평균)
    const ttftSum = promGet(prom, 'time_to_first_token_seconds_sum');
    const ttftCount = promGet(prom, 'time_to_first_token_seconds_count');
    const ttftMs = (ttftSum != null && ttftCount != null && ttftCount > 0) ? (ttftSum / ttftCount) * 1000 : null;
    const tpotSum = promGet(prom, 'time_per_output_token_seconds_sum');
    const tpotCount = promGet(prom, 'time_per_output_token_seconds_count');
    const tpotMs = (tpotSum != null && tpotCount != null && tpotCount > 0) ? (tpotSum / tpotCount) * 1000 : null;
    const e2eSum = promGet(prom, 'e2e_request_latency_seconds_sum');
    const e2eCount = promGet(prom, 'e2e_request_latency_seconds_count');
    const e2eLatencyMs = (e2eSum != null && e2eCount != null && e2eCount > 0) ? (e2eSum / e2eCount) * 1000 : null;
    // 효율성 메트릭
    const cacheQueries = promGet(prom, 'prefix_cache_queries_total', 'gpu_prefix_cache_queries_total');
    const cacheHits = promGet(prom, 'prefix_cache_hits_total', 'gpu_prefix_cache_hits_total');
    const prefixCacheHitRate = (cacheQueries != null && cacheHits != null && cacheQueries > 0) ? cacheHits / cacheQueries : null;
    const preemptionCount = promGet(prom, 'num_preemptions_total');
    const queueSum = promGet(prom, 'request_queue_time_seconds_sum', 'waiting_time_seconds_sum');
    const queueCount = promGet(prom, 'request_queue_time_seconds_count', 'waiting_time_seconds_count');
    const queueTimeMs = (queueSum != null && queueCount != null && queueCount > 0) ? (queueSum / queueCount) * 1000 : null;

    if (running != null || kv != null || promptTps != null) {
      return { runningRequests: running, waitingRequests: waiting, kvCacheUsagePct: kv, promptThroughputTps: promptTps, genThroughputTps: genTps, ttftMs, tpotMs, e2eLatencyMs, prefixCacheHitRate, preemptionCount, queueTimeMs };
    }
  }
  if (type === 'sglang' || type === 'unknown') {
    const running = promGet(prom, 'num_running_reqs', 'running_req');
    const waiting = promGet(prom, 'num_waiting_reqs', 'waiting_req');
    const kvRaw = promGet(prom, 'kv_cache_usage_perc', 'token_usage');
    const kv = kvRaw != null ? (kvRaw <= 1 ? kvRaw * 100 : kvRaw) : null;
    let genTps = promGet(prom, 'gen_throughput', 'generation_throughput');
    // counter fallback
    if (genTps == null && counterKey) {
      const genTotal = promGet(prom, 'generation_tokens_total');
      const now = Date.now();
      const prev = prevCounters.get(counterKey);
      if (prev && genTotal != null) { const dt = (now - prev.ts) / 1000; if (dt > 5) genTps = Math.max(0, (genTotal - prev.genTotal) / dt); }
      if (genTotal != null) prevCounters.set(counterKey, { promptTotal: 0, genTotal, ts: now });
    }
    // SGLang 서비스 품질 메트릭
    const ttftSum = promGet(prom, 'time_to_first_token_seconds_sum');
    const ttftCount = promGet(prom, 'time_to_first_token_seconds_count');
    const ttftMs = (ttftSum != null && ttftCount != null && ttftCount > 0) ? (ttftSum / ttftCount) * 1000 : null;
    const tpotSum = promGet(prom, 'time_per_output_token_seconds_sum');
    const tpotCount = promGet(prom, 'time_per_output_token_seconds_count');
    const tpotMs = (tpotSum != null && tpotCount != null && tpotCount > 0) ? (tpotSum / tpotCount) * 1000 : null;
    const e2eSum = promGet(prom, 'e2e_request_latency_seconds_sum');
    const e2eCount = promGet(prom, 'e2e_request_latency_seconds_count');
    const e2eLatencyMs = (e2eSum != null && e2eCount != null && e2eCount > 0) ? (e2eSum / e2eCount) * 1000 : null;
    const cacheHitRate = promGet(prom, 'cache_hit_rate');
    const preemptionCount = promGet(prom, 'num_preemptions_total');

    if (running != null || kv != null || genTps != null) {
      const queueSum = promGet(prom, 'request_queue_time_seconds_sum', 'waiting_time_seconds_sum');
      const queueCount = promGet(prom, 'request_queue_time_seconds_count', 'waiting_time_seconds_count');
      const queueTimeMs = (queueSum != null && queueCount != null && queueCount > 0) ? (queueSum / queueCount) * 1000 : null;
      return { runningRequests: running, waitingRequests: waiting, kvCacheUsagePct: kv, genThroughputTps: genTps, ttftMs, tpotMs, e2eLatencyMs, prefixCacheHitRate: cacheHitRate, preemptionCount, queueTimeMs };
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
  let diskTotalGb: number | null = null;
  let diskUsedGb: number | null = null;
  let diskFreeGb: number | null = null;
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
    // Line 4: disk "total used free" (GB)
    if (lines[4]) {
      const dp = lines[4].split(/\s+/);
      diskTotalGb = parseFloat(dp[0]) || null;
      diskUsedGb = parseFloat(dp[1]) || null;
      diskFreeGb = parseFloat(dp[2]) || null;
    }
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

      // /v1/models JSON에서 모델명 + precision 추출
      const modelNames: string[] = [];
      let detectedPrecision: 'fp8' | 'fp16' = 'fp16';
      const modelsLine = lines.find(l => l.startsWith('MODELS_JSON:'));
      if (modelsLine) {
        try {
          const json = JSON.parse(modelsLine.replace('MODELS_JSON:', ''));
          const models = json.data || json.models || [];
          for (const m of models) {
            const name = m.id || m.model || m.name;
            if (name) modelNames.push(name);
            if (m.root && detectPrecision(m.root) === 'fp8') detectedPrecision = 'fp8';
          }
        } catch { /* json parse fail */ }
      }

      // Prometheus 메트릭 파싱 (MODELS_JSON 줄 제외)
      const promLines = lines.slice(1).filter(l => !l.startsWith('MODELS_JSON:'));
      const { metrics: prom, raw: promRaw } = parsePrometheusLines(promLines);
      // rawMetrics: 주요 메트릭만 저장 (전체 덤프 → napi 에러 원인)
      const RAW_METRIC_KEYS = [
        'num_requests_running', 'num_requests_waiting', 'num_requests_swapped',
        'gpu_cache_usage_perc', 'kv_cache_usage_perc', 'cpu_cache_usage_perc',
        'prompt_tokens_total', 'generation_tokens_total',
        'request_success_total', 'request_failure_total',
        'e2e_request_latency_seconds', 'time_to_first_token_seconds', 'time_per_output_token_seconds',
        'num_preemptions_total', 'prefix_cache_hit_rate',
      ];
      const rawMetrics: Record<string, number> = {};
      for (const [k, v] of prom) {
        if (RAW_METRIC_KEYS.some(rk => k.includes(rk))) rawMetrics[k] = v;
      }

      const type = extractLlmType(prom, containerImage);
      const extracted = extractLlmMetricsFromProm(prom, type, `${containerName}:${port}`);

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
        ttftMs: extracted.ttftMs ?? null,
        tpotMs: extracted.tpotMs ?? null,
        e2eLatencyMs: extracted.e2eLatencyMs ?? null,
        prefixCacheHitRate: extracted.prefixCacheHitRate ?? null,
        preemptionCount: extracted.preemptionCount ?? null,
        queueTimeMs: extracted.queueTimeMs ?? null,
        precision: detectedPrecision,
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
            kvCacheUsagePct: null, promptThroughputTps: null, genThroughputTps: null, ttftMs: null, tpotMs: null, e2eLatencyMs: null, prefixCacheHitRate: null, preemptionCount: null, queueTimeMs: null, precision: 'fp16' as const, rawMetrics: {},
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
              promptThroughputTps: null, genThroughputTps: null,
              ttftMs: null, tpotMs: null, e2eLatencyMs: null, prefixCacheHitRate: null, preemptionCount: null, queueTimeMs: null, precision: 'fp16' as const,
              rawMetrics: {},
            });
          }
        }
      } catch { /* ignore */ }
    }
  }

  return { gpus, processes, llmEndpoints, cpuLoadAvg, cpuCores, memoryTotalMb, memoryUsedMb, diskTotalGb, diskUsedGb, diskFreeGb, hostname };
}

// ================================================================
// 인메모리 캐시 & 폴링 관리
// ================================================================
const latestMetrics = new Map<string, ServerMetrics>();
// counter → throughput 계산용: serverId:port → { promptTotal, genTotal, timestamp }
const prevCounters = new Map<string, { promptTotal: number; genTotal: number; ts: number }>();
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

    // JSON 칼럼 저장 전 sanitize (NaN/Infinity/특수문자 → napi 변환 에러 방지)
    const sanitizeJson = (obj: any): any => {
      try { return JSON.parse(JSON.stringify(obj, (_k, v) => typeof v === 'number' && !isFinite(v) ? null : v)); }
      catch { return Array.isArray(obj) ? [] : {}; }
    };

    await prisma.gpuMetricSnapshot.create({
      data: {
        serverId: server.id,
        gpuMetrics: sanitizeJson(parsed.gpus),
        cpuLoadAvg: isFinite(parsed.cpuLoadAvg ?? NaN) ? parsed.cpuLoadAvg : null,
        cpuCores: isFinite(parsed.cpuCores ?? NaN) ? parsed.cpuCores : null,
        memoryTotalMb: isFinite(parsed.memoryTotalMb ?? NaN) ? parsed.memoryTotalMb : null,
        memoryUsedMb: isFinite(parsed.memoryUsedMb ?? NaN) ? parsed.memoryUsedMb : null,
        diskTotalGb: isFinite(parsed.diskTotalGb ?? NaN) ? parsed.diskTotalGb : null,
        diskUsedGb: isFinite(parsed.diskUsedGb ?? NaN) ? parsed.diskUsedGb : null,
        diskFreeGb: isFinite(parsed.diskFreeGb ?? NaN) ? parsed.diskFreeGb : null,
        hostname: parsed.hostname?.replace(/[^\x20-\x7E\uAC00-\uD7A3]/g, '') || null,
        gpuProcesses: sanitizeJson(parsed.processes),
        llmMetrics: sanitizeJson(parsed.llmEndpoints),
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
      diskTotalGb: prev?.diskTotalGb ?? null, diskUsedGb: prev?.diskUsedGb ?? null, diskFreeGb: prev?.diskFreeGb ?? null,
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
      // Prometheus 기반 서버는 SSH 폴링 스킵 (prometheusCollector가 별도 수집)
      if (server.sshPort === 0 || server.description?.includes('[DTGPT-Prometheus]')) {
        console.log(`[GPU Monitor] Skipping SSH polling for "${server.name}" (Prometheus-based)`);
        continue;
      }
      startPolling(server).catch(err =>
        console.error(`[GPU Monitor] Failed to start polling for "${server.name}":`, err)
      );
    }

    // 스냅샷 보존 정책 (매 6시간):
    // - 30일 이상: 삭제
    // - 14~30일: 하루 1건만 보관 (트렌드용), 나머지 삭제
    // - 14일 이내: 전체 보관 (상세 분석용)
    setInterval(async () => {
      try {
        // 30일 이상 삭제
        const cutoff30 = new Date(); cutoff30.setDate(cutoff30.getDate() - 30);
        const del30 = await prisma.gpuMetricSnapshot.deleteMany({ where: { timestamp: { lt: cutoff30 } } });
        if (del30.count > 0) console.log(`[GPU Monitor] Cleaned up ${del30.count} old snapshots (>30d)`);

        // 14~30일: 하루 1건만 보관 (서버별 첫 번째 스냅샷만 유지)
        const cutoff14 = new Date(); cutoff14.setDate(cutoff14.getDate() - 14);
        const thinned = await prisma.$executeRaw`
          DELETE FROM gpu_metric_snapshots
          WHERE timestamp < ${cutoff14} AND timestamp >= ${cutoff30}
            AND id NOT IN (
              SELECT DISTINCT ON (server_id, DATE(timestamp)) id
              FROM gpu_metric_snapshots
              WHERE timestamp < ${cutoff14} AND timestamp >= ${cutoff30}
              ORDER BY server_id, DATE(timestamp), timestamp ASC
            )`;
        if (thinned > 0) console.log(`[GPU Monitor] Thinned ${thinned} snapshots (14-30d, keeping 1/day/server)`);

        // DB 공간 모니터링
        const dbSize = await prisma.$queryRaw<[{ size: string }]>`SELECT pg_size_pretty(pg_database_size(current_database())) as size`;
        console.log(`[GPU Monitor] DB size: ${dbSize[0]?.size}`);
      } catch (err) {
        console.error('[GPU Monitor] Cleanup error:', err);
      }
    }, 6 * 60 * 60 * 1000);

    // GPU Realtime 선계산 (15초 주기) — /realtime 캐시를 항상 warm 상태로 유지
    setTimeout(async () => {
      await precomputeGpuRealtime();
      setInterval(() => precomputeGpuRealtime(), 15_000);
      console.log('[GPU Precompute] Realtime precompute started (every 15s)');
    }, 10_000); // SSH 폴링 첫 라운드 완료 대기

    // GPU Analytics 선계산 (5분 주기) — 기본 분석(30일, 전체) 캐시 워밍
    setTimeout(async () => {
      await precomputeGpuAnalytics();
      setInterval(() => precomputeGpuAnalytics(), 5 * 60_000);
      console.log('[GPU Precompute] Analytics precompute started (every 5m)');
    }, 30_000); // 초기 데이터 축적 후 시작

  } catch (err) {
    console.error('[GPU Monitor] Failed to start cron:', err);
  }
}

// ================================================================
// GPU 선계산 (Precompute) — 백그라운드에서 응답 조립 → Redis 저장
// ================================================================

/**
 * 전체 실시간 응답 빌드 (벤치마크·피크TPS 포함)
 * - 기존 /realtime 라우트의 계산 로직을 추출
 * - precomputeGpuRealtime()과 라우트 핸들러 fallback 양쪽에서 호출
 */
export async function buildRealtimeData(): Promise<{ data: any[]; updatedAt: string }> {
  const servers = await prisma.gpuServer.findMany({ orderBy: { createdAt: 'asc' } });
  const metrics = getAllLatestMetrics();
  const serverMap = new Map(servers.map(s => [s.id, { ...s, sshPassword: '***' }]));

  // 7일 피크 TPS — 단일 SQL로 전체 서버 한번에 조회
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const peakTpsMap = new Map<string, number>();
  try {
    const serverIds = servers.map(s => s.id);
    if (serverIds.length > 0) {
      const { rows: peakRows } = await pgPool.query(`
        SELECT server_id,
          MAX((SELECT COALESCE(SUM(COALESCE((l->>'promptThroughputTps')::float,0)+COALESCE((l->>'genThroughputTps')::float,0)),0)
               FROM jsonb_array_elements(COALESCE(llm_metrics,'[]'::jsonb)) l)) AS peak_tps
        FROM (
          SELECT server_id, llm_metrics, ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY timestamp DESC) AS rn
          FROM gpu_metric_snapshots WHERE server_id = ANY($1) AND timestamp >= $2
        ) sub WHERE rn <= 100
        GROUP BY server_id
      `, [serverIds, sevenDaysAgo]);
      for (const r of peakRows) {
        if (r.peak_tps > 0) peakTpsMap.set(r.server_id, parseFloat(r.peak_tps));
      }
    }
  } catch {}

  // Prometheus 기반 서버 DB 조회
  const promServerIds = servers.filter(s => s.sshPort === 0 || s.description?.includes('[DTGPT-Prometheus]')).map(s => s.id);
  const promMetricsMap = new Map<string, any>();
  if (promServerIds.length > 0) {
    try {
      const { rows } = await pgPool.query(`
        SELECT DISTINCT ON (server_id) server_id,
          gpu_metrics::text as gm, llm_metrics::text as lm,
          hostname, timestamp
        FROM gpu_metric_snapshots
        WHERE server_id = ANY($1)
        ORDER BY server_id, timestamp DESC
      `, [promServerIds]);
      for (const r of rows) {
        try {
          promMetricsMap.set(r.server_id, {
            serverId: r.server_id, serverName: '', timestamp: r.timestamp,
            gpus: JSON.parse(r.gm || '[]'), processes: [], llmEndpoints: JSON.parse(r.lm || '[]'),
            cpuLoadAvg: null, cpuCores: null, memoryTotalMb: null, memoryUsedMb: null,
            diskTotalGb: null, diskUsedGb: null, diskFreeGb: null, hostname: r.hostname,
          });
        } catch {}
      }
    } catch {}
  }

  // 벤치마크 로드
  const { getAllBenchmarks, calcCompositeCapacity } = await import('./gpuBenchmark.service.js');
  const benchmarkMap = await getAllBenchmarks();

  const result = servers.map(s => {
    const m = metrics.find(mt => mt.serverId === s.id) || promMetricsMap.get(s.id) || null;
    const gpuCount = m?.gpus?.length || 0;
    const spec = gpuCount > 0 ? m!.gpus[0].spec : null;
    const endpoints: any[] = (m?.llmEndpoints || []).filter((ep: any) => ep.type !== 'unknown');

    let primaryModelName: string | null = null;
    let primaryModelParams: number | null = null;
    for (const ep of endpoints) {
      const name = ep.modelNames?.[0] || null;
      const params = name ? estimateModelParams(name) : null;
      if (params && (primaryModelParams == null || params > primaryModelParams)) {
        primaryModelName = name;
        primaryModelParams = params;
      }
    }
    const precision = endpoints.some((ep: any) => ep.precision === 'fp8') ? 'fp8' as const : 'fp16' as const;

    const theoreticalMaxTps = (spec && primaryModelParams && gpuCount > 0)
      ? Math.round(calcTheoreticalMaxTps(spec, gpuCount, primaryModelParams, precision) * 10) / 10 : null;
    const bandwidthMaxTps = (spec && primaryModelParams && gpuCount > 0)
      ? Math.round(calcBandwidthMaxTps(spec, gpuCount, primaryModelParams, precision) * 10) / 10 : null;

    const currentTps = endpoints.reduce((acc: number, ep: any) =>
      acc + (ep.promptThroughputTps || 0) + (ep.genThroughputTps || 0), 0);
    const peakTps = peakTpsMap.get(s.id) || null;

    // 벤치마크 기반 종합 용량
    const bm = benchmarkMap.get(s.id);
    const currentKvPct = endpoints.length > 0
      ? endpoints.reduce((acc: number, ep: any) => acc + (ep.kvCacheUsagePct || 0), 0) / endpoints.length : null;
    const currentConcurrent = endpoints.reduce((acc: number, ep: any) =>
      acc + (ep.runningRequests || 0) + (ep.waitingRequests || 0), 0);
    const capacity = bm ? calcCompositeCapacity(currentTps, currentKvPct, currentConcurrent, bm) : null;

    return {
      server: serverMap.get(s.id),
      metrics: m,
      capacityAnalysis: capacity ? {
        ...capacity,
        currentTps: Math.round(currentTps * 10) / 10,
        peakTps: bm?.peakTps || peakTps,
        modelName: primaryModelName,
        modelParams: primaryModelParams ? `${primaryModelParams}B` : null,
        benchmark: bm ? { peakTps: bm.peakTps, peakKvPct: bm.peakKvPct, peakConcurrent: bm.peakConcurrent, source: bm.source } : null,
      } : null,
      throughputAnalysis: {
        theoreticalMaxTps, bandwidthMaxTps, peakTps,
        currentTps: Math.round(currentTps * 10) / 10,
        modelName: primaryModelName,
        modelParams: primaryModelParams ? `${primaryModelParams}B` : null,
        gpuHealthPct: (theoreticalMaxTps && peakTps) ? Math.round((peakTps / theoreticalMaxTps) * 1000) / 10 : null,
        utilizationPct: (peakTps && peakTps > 0) ? Math.round((currentTps / peakTps) * 1000) / 10 : null,
        theoreticalUtilPct: (theoreticalMaxTps && theoreticalMaxTps > 0) ? Math.round((currentTps / theoreticalMaxTps) * 1000) / 10 : null,
        practicalUtilPct: (bandwidthMaxTps && bandwidthMaxTps > 0) ? Math.round((currentTps / bandwidthMaxTps) * 1000) / 10 : null,
        practicalHealthPct: (bandwidthMaxTps && peakTps) ? Math.round((peakTps / bandwidthMaxTps) * 1000) / 10 : null,
      },
    };
  });

  return { data: result, updatedAt: new Date().toISOString() };
}

/**
 * GPU Realtime 선계산 → Redis (15초 주기)
 * /realtime 캐시를 항상 warm 상태로 유지하여 API 응답 <5ms 보장
 */
export async function precomputeGpuRealtime(): Promise<void> {
  try {
    const response = await buildRealtimeData();
    const { redis } = await import('../index.js');
    await redis.setex('gpu:realtime', 120, JSON.stringify(response));
  } catch (err) {
    console.error('[GPU Precompute] Realtime error:', err);
  }
}

/**
 * Analytics 순수 계산 (rows → 히트맵·영업시간 집계)
 * DB 접근 없이 메모리에서만 동작 — 선계산 시 1회 쿼리 후 서버별 슬라이싱에 사용
 */
function computeAnalyticsFromRows(rows: any[], days: number, since: Date, holidayDates: string[]): any {
  const holidaySet = new Set(holidayDates);
  const isBiz = (h: number, d: number, dt: string) => h >= 9 && h < 18 && d >= 1 && d <= 5 && !holidaySet.has(dt);

  let bizCount = 0, offCount = 0;
  let bizLlmKvCache = 0, bizLlmCount = 0, bizLlmRunning = 0, bizLlmWaiting = 0;
  let bizTotalTps = 0, bizTpsCount = 0, bizPeakTps = 0;

  const dateHourMap = new Map<string, { tps: number[]; kv: number[]; wait: number[]; preempt: number[]; gpu: number[] }>();

  for (const r of rows) {
    const h = +r.h, d = +r.d;
    const kv = r.kv != null ? +r.kv : null;
    const run = +(r.run || 0), wait = +(r.wait || 0), tps = +(r.tps || 0);
    const biz = isBiz(h, d, r.dt);

    const key = `${r.dt}|${h}`;
    const preempt = +(r.preempt || 0);
    const gpu = +(r.gpu || 0);
    const entry = dateHourMap.get(key) || { tps: [], kv: [], wait: [], preempt: [], gpu: [] };
    if (tps > 0) entry.tps.push(tps);
    if (kv != null) entry.kv.push(kv);
    entry.wait.push(wait);
    entry.preempt.push(preempt);
    if (gpu > 0) entry.gpu.push(gpu);
    dateHourMap.set(key, entry);

    if (biz) {
      bizCount++;
      if (kv != null) { bizLlmKvCache += kv; bizLlmCount++; }
      bizLlmRunning += run; bizLlmWaiting += wait;
      if (tps > 0) { bizTotalTps += tps; bizTpsCount++; }
      if (tps > bizPeakTps) bizPeakTps = tps;
    } else {
      offCount++;
    }
  }

  const r1 = (v: number) => Math.round(v * 10) / 10;

  const dateHourHeatmap = Array.from(dateHourMap.entries()).map(([key, v]) => {
    const [dt, hStr] = key.split('|');
    const avgTps = v.tps.length > 0 ? v.tps.reduce((a, b) => a + b, 0) / v.tps.length : 0;
    const avgKv = v.kv.length > 0 ? v.kv.reduce((a, b) => a + b, 0) / v.kv.length : 0;
    const avgWait = v.wait.length > 0 ? v.wait.reduce((a, b) => a + b, 0) / v.wait.length : 0;
    const avgPreempt = v.preempt.length > 0 ? v.preempt.reduce((a, b) => a + b, 0) / v.preempt.length : 0;
    const avgGpu = v.gpu.length > 0 ? v.gpu.reduce((a, b) => a + b, 0) / v.gpu.length : 0;
    return { date: dt, hour: +hStr, tps: r1(avgTps), kv: r1(avgKv), wait: r1(avgWait), preempt: r1(avgPreempt), gpu: r1(avgGpu), samples: v.tps.length || v.wait.length };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);

  return {
    period: { days, since: since.toISOString(), holidayCount: holidayDates.length },
    businessHours: {
      avgKvCache: bizLlmCount > 0 ? r1(bizLlmKvCache / bizLlmCount) : null,
      avgRunningReqs: bizCount > 0 ? r1(bizLlmRunning / bizCount) : null,
      avgWaitingReqs: bizCount > 0 ? r1(bizLlmWaiting / bizCount) : null,
      avgTps: bizTpsCount > 0 ? r1(bizTotalTps / bizTpsCount) : null,
      peakTps: bizPeakTps > 0 ? r1(bizPeakTps) : null,
      sampleCount: bizCount,
    },
    offHours: { sampleCount: offCount },
    dateHourHeatmap,
    totalSnapshots: rows.length,
  };
}

/** Analytics SQL — server_id 포함 (선계산 시 메모리 필터용) */
const ANALYTICS_SQL = `
  SELECT
    s.server_id AS sid,
    EXTRACT(HOUR FROM s.timestamp + INTERVAL '9 hours')::int AS h,
    EXTRACT(DOW FROM s.timestamp + INTERVAL '9 hours')::int AS d,
    to_char(s.timestamp + INTERVAL '9 hours', 'YYYY-MM-DD') AS dt,
    (SELECT AVG((g->>'utilGpu')::float) FROM jsonb_array_elements(s.gpu_metrics) g) AS gpu,
    (SELECT CASE WHEN SUM((g->>'memTotalMb')::float) > 0
      THEN SUM((g->>'memUsedMb')::float)/SUM((g->>'memTotalMb')::float)*100 ELSE 0 END
      FROM jsonb_array_elements(s.gpu_metrics) g) AS mem,
    (SELECT AVG((l->>'kvCacheUsagePct')::float)
      FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l
      WHERE (l->>'kvCacheUsagePct') IS NOT NULL) AS kv,
    (SELECT SUM(COALESCE((l->>'runningRequests')::float,0))
      FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS run,
    (SELECT SUM(COALESCE((l->>'waitingRequests')::float,0))
      FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS wait,
    (SELECT SUM(COALESCE((l->>'promptThroughputTps')::float,0)+COALESCE((l->>'genThroughputTps')::float,0))
      FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS tps,
    (SELECT SUM(COALESCE((l->>'preemptionCount')::float,0))
      FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS preempt
  FROM gpu_metric_snapshots s`;

/**
 * GPU Analytics 데이터 빌드 (히트맵·영업시간 분석)
 * - 라우트 핸들러 fallback용 (캐시 미스 시 호출)
 */
export async function buildAnalyticsData(days: number, serverIds: string[] | null): Promise<any> {
  const serverId = serverIds && serverIds.length === 1 ? serverIds[0] : null;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const holidays = await prisma.holiday.findMany({ where: { date: { gte: since } }, select: { date: true } });
  const holidayDates = holidays.map(h => h.date.toISOString().split('T')[0]);

  const whereClause = serverId ? 'AND s.server_id = $2' : serverIds && serverIds.length > 1 ? 'AND s.server_id = ANY($2::uuid[])' : '';
  const { rows } = await pgPool.query(
    `${ANALYTICS_SQL} WHERE s.timestamp >= $1 ${whereClause} ORDER BY s.timestamp ASC`,
    serverId ? [since, serverId] : serverIds && serverIds.length > 1 ? [since, serverIds] : [since],
  );

  return computeAnalyticsFromRows(rows, days, since, holidayDates);
}

/**
 * GPU Analytics 선계산 → Redis (5분 주기)
 * 1회 전체 쿼리 → 프론트 드롭다운 전 조합을 메모리에서 슬라이싱 → 전부 캐시
 * 드롭다운 어떤 걸 선택해도 항상 캐시 히트
 */
export async function precomputeGpuAnalytics(): Promise<void> {
  try {
    const { redis } = await import('../index.js');
    const days = 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const holidays = await prisma.holiday.findMany({ where: { date: { gte: since } }, select: { date: true } });
    const holidayDates = holidays.map(h => h.date.toISOString().split('T')[0]);

    // ── 1회 전체 쿼리 (무거운 JSON 파싱은 여기서 1번만) ──
    const { rows: allRows } = await pgPool.query(
      `${ANALYTICS_SQL} WHERE s.timestamp >= $1 ORDER BY s.timestamp ASC`,
      [since],
    );

    // 전체 서버 결과
    const allResult = computeAnalyticsFromRows(allRows, days, since, holidayDates);
    const pipeline = redis.pipeline();
    pipeline.setex('gpu:analytics:30:all', 600, JSON.stringify(allResult));

    // ── 프론트엔드 드롭다운 조합 도출 (realtime 데이터에서) ──
    const realtimeRaw = await redis.get('gpu:realtime');
    if (realtimeRaw) {
      const realtimeData: any[] = JSON.parse(realtimeRaw).data || [];

      const k8s = realtimeData.filter((e: any) => !e.server?.isLocal && e.server?.sshPort === 0);
      const dedicatedModels = new Map<string, string[]>();
      const sharedServerIds = new Set<string>();

      for (const entry of k8s) {
        for (const ep of (entry.metrics?.llmEndpoints || [])) {
          const inst = ep.containerName || '';
          if (!inst || inst.includes('router') || inst.includes('redis') || inst.includes('litellm')) continue;
          if (inst.startsWith('shared-')) { sharedServerIds.add(entry.server.id); continue; }
          const existing = dedicatedModels.get(inst) || [];
          if (!existing.includes(entry.server.id)) existing.push(entry.server.id);
          dedicatedModels.set(inst, existing);
        }
      }

      const combinations: Array<{ key: string; ids: Set<string> }> = [];

      // DT 전용 모델 조합
      for (const [, sids] of dedicatedModels) {
        combinations.push({ key: sids.join(','), ids: new Set(sids) });
      }
      // DT 공유 모델 조합
      if (sharedServerIds.size > 0) {
        combinations.push({ key: Array.from(sharedServerIds).join(','), ids: sharedServerIds });
      }
      // SSH 서버 (개별)
      const sshServers = realtimeData.filter((e: any) => !e.server?.isLocal && e.server?.sshPort > 0);
      for (const entry of sshServers) {
        combinations.push({ key: entry.server.id, ids: new Set([entry.server.id]) });
      }

      // 각 조합: 메모리에서 필터 → 계산 → 캐시 (DB 추가 쿼리 0회)
      for (const { key, ids } of combinations) {
        const filtered = allRows.filter((r: any) => ids.has(r.sid));
        const result = computeAnalyticsFromRows(filtered, days, since, holidayDates);
        pipeline.setex(`gpu:analytics:30:${key}`, 600, JSON.stringify(result));
      }

      console.log(`[GPU Precompute] Analytics: all + ${combinations.length} combinations`);
    }

    await pipeline.exec();
  } catch (err) {
    console.error('[GPU Precompute] Analytics error:', err);
  }
}
