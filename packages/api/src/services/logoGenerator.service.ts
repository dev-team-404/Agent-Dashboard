/**
 * Logo Generator Service
 *
 * 서비스 로고가 없는 경우 이미지 생성 모델을 통해
 * 간단한 2D 화이트 배경 로고를 자동 생성하여 적용.
 */

import { prisma } from '../index.js';
import { generateImages, ImageEndpointInfo } from './imageProviders.service.js';
import { saveImage, ensureStorageDir } from './imageStorage.service.js';

const LOGO_MODEL_KEY = 'LOGO_GENERATION_MODEL_ID';

/**
 * 서비스 정보를 기반으로 로고 생성 프롬프트 구성
 */
function buildLogoPrompt(service: { name: string; displayName: string; description?: string | null }): string {
  const desc = service.description
    ? `This service does: ${service.description}`
    : `Service name: "${service.displayName}"`;

  return [
    `Design a simple, clean, minimal 2D logo icon for a software service.`,
    `The logo must have a pure white (#FFFFFF) background.`,
    `The logo should be a flat design icon — no gradients, no shadows, no 3D effects.`,
    `Use bold, simple geometric shapes and clean lines.`,
    `The icon should visually represent the service's purpose.`,
    desc,
    `Do NOT include any text or letters in the logo.`,
    `The design should look professional, modern, and suitable for use as a small app icon or favicon.`,
    `Output a single square icon image.`,
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

    const results = await generateImages(model.imageProvider || 'OPENAI', endpoint, {
      prompt,
      n: 1,
      size: '512x512',
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
 * iconUrl이 없는 모든 서비스에 대해 로고 일괄 생성
 */
export async function generateMissingLogos(): Promise<{ total: number; success: number; errors: number; details: Array<{ serviceId: string; name: string; result: string }> }> {
  // 로고 모델 설정 확인
  const setting = await prisma.systemSetting.findUnique({ where: { key: LOGO_MODEL_KEY } });
  if (!setting?.value) {
    return { total: 0, success: 0, errors: 0, details: [{ serviceId: '', name: '', result: 'Logo generation model not configured' }] };
  }

  // iconUrl이 비어있는 서비스 조회
  const services = await prisma.service.findMany({
    where: {
      OR: [
        { iconUrl: null },
        { iconUrl: '' },
      ],
    },
    select: { id: true, name: true, displayName: true },
    orderBy: { createdAt: 'desc' },
  });

  if (services.length === 0) {
    return { total: 0, success: 0, errors: 0, details: [] };
  }

  console.log(`[LogoGen] Starting batch logo generation for ${services.length} service(s)...`);

  let successCount = 0;
  let errorCount = 0;
  const details: Array<{ serviceId: string; name: string; result: string }> = [];

  for (const svc of services) {
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

  console.log(`[LogoGen] Batch complete: ${successCount} success, ${errorCount} errors out of ${services.length}`);
  return { total: services.length, success: successCount, errors: errorCount, details };
}
