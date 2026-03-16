/**
 * Agent Registry API Server (v2)
 *
 * 3단계 권한 체계 + 헤더 기반 프록시 인증
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
export declare const prisma: PrismaClient<import(".prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/library").DefaultArgs>;
export declare const redis: import("ioredis").default;
//# sourceMappingURL=index.d.ts.map