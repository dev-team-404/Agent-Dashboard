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
  'df -BG / 2>/dev/null | awk "NR==2{gsub(/G/,\\"\\"); print \\$2,\\$3,\\$4}"',
  // LLM 탐지: vllm/sglang/tgi/lmdeploy 이미지 컨테이너만 스캔
  'echo "==LLM=="',
  'docker ps --format "{{.Ports}}|{{.Names}}|{{.Image}}" 2>/dev/null | grep -iE "vllm|sglang|tgi|text-generation|lmdeploy|aphrodite" | while IFS="|" read PORTS CNAME CIMAGE; do'
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
  memBandwidthGBs: number; // 메모리 대역폭 (GB/s)
  tdpW: number;            // TDP (W)
  vramGb: number;          // VRAM (GB)
  label: string;           // 표시 이름
}

export const B300_SPEC: GpuSpec = { fp16Tflops: 2250, memBandwidthGBs: 8000, tdpW: 1000, vramGb: 192, label: 'B300' };

const GPU_SPECS: Array<{ pattern: RegExp; spec: GpuSpec }> = [
  { pattern: /B300/i,        spec: B300_SPEC },
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
export function calcTheoreticalMaxTps(spec: GpuSpec, gpuCount: number, modelParamsBillion: number): number {
  const modelSizeBytes = modelParamsBillion * 1e9 * 2;
  // Method 1: Memory bandwidth bound (단일 요청 decode)
  const bwBound = (spec.memBandwidthGBs * 1e9 * gpuCount) / modelSizeBytes;
  // Method 2: Compute bound (배치 처리, FP16 FLOPS 기준)
  const flopsPerToken = 2 * modelParamsBillion * 1e9; // 2 * params FLOPs per token
  const totalFlops = spec.fp16Tflops * 1e12 * gpuCount; // total FP16 FLOPS
  const computeBound = totalFlops / flopsPerToken;
  // 이론 최대 = compute bound (제조사 스펙 그대로, 보정 없음)
  // 실제 달성률은 30-70% (GPU 수, 통신 오버헤드, KV cache 등에 따라 다름)
  // 건강도 = 실측 피크 / 이론 최대 → 시간에 따라 하락하면 노후화 시그널
  return computeBound;
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
            kvCacheUsagePct: null, promptThroughputTps: null, genThroughputTps: null, ttftMs: null, tpotMs: null, e2eLatencyMs: null, prefixCacheHitRate: null, preemptionCount: null, queueTimeMs: null, rawMetrics: {},
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
              ttftMs: null, tpotMs: null, e2eLatencyMs: null, prefixCacheHitRate: null, preemptionCount: null, queueTimeMs: null,
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

    await prisma.gpuMetricSnapshot.create({
      data: {
        serverId: server.id,
        gpuMetrics: parsed.gpus as any,
        cpuLoadAvg: parsed.cpuLoadAvg,
        cpuCores: parsed.cpuCores,
        memoryTotalMb: parsed.memoryTotalMb,
        memoryUsedMb: parsed.memoryUsedMb,
        diskTotalGb: parsed.diskTotalGb,
        diskUsedGb: parsed.diskUsedGb,
        diskFreeGb: parsed.diskFreeGb,
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
