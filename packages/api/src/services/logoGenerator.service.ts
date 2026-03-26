/**
 * Logo Generator Service
 *
 * 서비스 로고가 없는 경우 이미지 생성 모델을 통해
 * 간단한 2D 화이트 배경 로고를 자동 생성하여 적용.
 */

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../index.js';
import { generateImages, ImageEndpointInfo } from './imageProviders.service.js';
import { saveImage, ensureStorageDir, IMAGE_STORAGE_PATH } from './imageStorage.service.js';
import { logInternalLlmUsage } from './internalUsageLogger.js';

const LOGO_MODEL_KEY = 'LOGO_GENERATION_MODEL_ID';

/**
 * 서비스 정보를 기반으로 로고 생성 프롬프트 구성
 */
function buildLogoPrompt(service: { name: string; displayName: string; description?: string | null }): string {
  const desc = service.description
    ? `This service does: ${service.description}`
    : `Service name: "${service.displayName}"`;

  return [
    `Generate a single square 512x512 pixel logo icon.`,
    `The icon MUST fill the entire 512x512 canvas edge-to-edge with NO padding, NO margin, NO border, and NO empty space around it.`,
    `Background: solid pure white (#FFFFFF).`,
    `Style: flat 2D, minimal, no gradients, no shadows, no 3D effects, no text, no letters.`,
    `Use bold, simple geometric shapes with clean lines that span the full width and height of the canvas.`,
    `The icon should visually represent this service's purpose:`,
    desc,
    `CRITICAL: The design must touch all four edges of the image. Do not leave any blank margins.`,
  ].join('\n');
}

/**
 * 단일 서비스에 대해 로고 생성 후 iconUrl 업데이트
 */
export async function generateLogoForService(
  serviceId: string,
): Promise<{ success: boolean; iconUrl?: string; error?: string }> {
  try {
    // 1. 로고 생성 모델 설정 확인
    const setting = await prisma.systemSetting.findUnique({ where: { key: LOGO_MODEL_KEY } });
    if (!setting?.value) {
      return { success: false, error: 'Logo generation model not configured' };
    }

    const model = await prisma.model.findUnique({ where: { id: setting.value } });
    if (!model || !model.enabled || model.type !== 'IMAGE') {
      return { success: false, error: 'Configured logo model is invalid, disabled, or not an IMAGE type' };
    }

    // 2. 서비스 정보 조회
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, name: true, displayName: true, description: true, iconUrl: true },
    });
    if (!service) {
      return { success: false, error: 'Service not found' };
    }

    // 3. 프롬프트 생성
    const prompt = buildLogoPrompt(service);

    // 4. 이미지 생성
    const endpoint: ImageEndpointInfo = {
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey,
      modelName: model.name,
      extraHeaders: model.extraHeaders as Record<string, string> | null,
      extraBody: model.extraBody as Record<string, any> | null,
    };

    const logoStartMs = Date.now();
    const results = await generateImages(model.imageProvider || 'OPENAI', endpoint, {
      prompt,
      n: 1,
      size: '512x512',
    });
    const logoLatencyMs = Date.now() - logoStartMs;

    // 이미지 생성 사용량 로깅 (토큰 없음, 요청 기록만)
    logInternalLlmUsage({
      modelId: model.id, modelName: model.name,
      inputTokens: 0, outputTokens: 0,
      latencyMs: logoLatencyMs,
      path: '/internal/logo-generation',
      statusCode: results.length > 0 ? 200 : 502,
      errorMessage: results.length === 0 ? 'No results returned' : undefined,
    });

    if (results.length === 0) {
      return { success: false, error: 'Image generation returned no results' };
    }

    // 5. 이미지 저장 (디렉토리 보장, 로고는 영구 보관)
    ensureStorageDir();
    const saved = await saveImage(results[0]!.imageBuffer, {
      mimeType: results[0]!.mimeType,
      modelId: model.id,
      serviceId: service.id,
      prompt,
      permanent: true,
    });

    // 6. iconUrl 업데이트 — 상대 경로 사용 (nginx 프록시 환경에서 호스트 무관하게 동작)
    const iconUrl = `/api/v1/images/files/${saved.fileName}`;

    await prisma.service.update({
      where: { id: serviceId },
      data: { iconUrl },
    });

    console.log(`[LogoGen] Generated logo for service "${service.name}": ${iconUrl}`);
    return { success: true, iconUrl };
  } catch (error: any) {
    console.error(`[LogoGen] Failed to generate logo for service ${serviceId}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * iconUrl이 깨진 서비스인지 확인
 * - /api/v1/images/files/ 경로인데 실제 파일이 없는 경우
 */
function isBrokenIconUrl(iconUrl: string | null | undefined): boolean {
  if (!iconUrl) return true;
  const match = iconUrl.match(/\/v1\/images\/files\/(.+)$/);
  if (!match) return false; // 외부 URL이면 건드리지 않음
  const fileName = match[1]!;
  const filePath = path.join(IMAGE_STORAGE_PATH, fileName);
  return !fs.existsSync(filePath);
}

/**
 * 로고 없거나 깨진 서비스 일괄 재생성
 * - iconUrl이 null/빈 값 → 생성
 * - iconUrl이 내부 경로인데 파일 없음 → 재생성
 * - iconUrl이 외부 URL → 스킵
 */
export async function generateMissingLogos(): Promise<{ total: number; success: number; errors: number; details: Array<{ serviceId: string; name: string; result: string }> }> {
  // 로고 모델 설정 확인
  const setting = await prisma.systemSetting.findUnique({ where: { key: LOGO_MODEL_KEY } });
  if (!setting?.value) {
    return { total: 0, success: 0, errors: 0, details: [{ serviceId: '', name: '', result: 'Logo generation model not configured' }] };
  }

  // 모든 서비스 조회
  const allServices = await prisma.service.findMany({
    select: { id: true, name: true, displayName: true, iconUrl: true },
    orderBy: { createdAt: 'desc' },
  });

  // 로고가 없거나 깨진 서비스 필터
  const targets = allServices.filter(svc => isBrokenIconUrl(svc.iconUrl));

  if (targets.length === 0) {
    return { total: 0, success: 0, errors: 0, details: [] };
  }

  console.log(`[LogoGen] Starting batch logo generation for ${targets.length} service(s) (${allServices.length - targets.length} skipped — valid icons)...`);

  // 깨진 iconUrl 가진 서비스는 먼저 null로 리셋 (재생성 대상 명확화)
  const brokenIds = targets.filter(s => s.iconUrl).map(s => s.id);
  if (brokenIds.length > 0) {
    await prisma.service.updateMany({
      where: { id: { in: brokenIds } },
      data: { iconUrl: null },
    });
    // 고아 GeneratedImage 레코드도 정리
    await prisma.generatedImage.deleteMany({
      where: {
        serviceId: { in: brokenIds },
        fileName: { notIn: await getExistingFileNames() },
      },
    });
    console.log(`[LogoGen] Reset ${brokenIds.length} broken iconUrls`);
  }

  let successCount = 0;
  let errorCount = 0;
  const details: Array<{ serviceId: string; name: string; result: string }> = [];

  for (const svc of targets) {
    const result = await generateLogoForService(svc.id);
    if (result.success) {
      successCount++;
      details.push({ serviceId: svc.id, name: svc.name, result: 'OK' });
    } else {
      errorCount++;
      details.push({ serviceId: svc.id, name: svc.name, result: result.error || 'Failed' });
    }
    // 요청 간 짧은 딜레이 (rate limit 방지)
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[LogoGen] Batch complete: ${successCount} success, ${errorCount} errors out of ${targets.length}`);
  return { total: targets.length, success: successCount, errors: errorCount, details };
}

/** 실제 디스크에 존재하는 파일명 목록 */
async function getExistingFileNames(): Promise<string[]> {
  try {
    ensureStorageDir();
    return fs.readdirSync(IMAGE_STORAGE_PATH);
  } catch {
    return [];
  }
}
