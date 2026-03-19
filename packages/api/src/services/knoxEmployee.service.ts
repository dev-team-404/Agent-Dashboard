/**
 * Knox Employee API Service
 *
 * Samsung Knox Portal 임직원 조회 API 연동
 * - 임직원 정보 조회 (userId 기반)
 * - 부서 정보 검증
 * - 한글 이름 자동 세팅
 * - 조직도 API 연동 (부서 계층 조회 + DB 캐싱)
 */

import { prisma } from '../index.js';

const KNOX_API_URL = process.env['KNOX_API_URL'] || 'https://openapi.samsung.net/employee/api/v2.0';
const KNOX_SYSTEM_ID = process.env['KNOX_SYSTEM_ID'] || '';
const KNOX_AUTH_TOKEN = process.env['KNOX_AUTH_TOKEN'] || '';
const KNOX_COMPANY_CODE = process.env['KNOX_COMPANY_CODE'] || 'C10';

export interface KnoxEmployee {
  fullName: string;
  givenName: string;
  sirName: string;
  enFullName: string;
  employeeNumber: string;
  employeeStatus: string;      // B:재직, V:휴직
  departmentCode: string;
  departmentName: string;
  enDepartmentName: string;
  companyCode: string;
  companyName: string;
  emailAddress: string;
  userId: string;              // Knox loginid
  titleName: string;           // 직급명
  enTitleName: string;
  gradeName: string;           // 직위명
  epId: string;
  businessUnit?: string;
}

interface KnoxApiResponse {
  result: 'success' | 'fail';
  currentPage?: number;
  totalPage?: number;
  totalCount?: number;
  employees?: KnoxEmployee[];
}

interface KnoxOrgResponse {
  result: 'success' | 'fail';
  currentPage?: number;
  totalPage?: number;
  totalCount?: number;
  organizations?: KnoxOrganization[];
}

interface KnoxOrganization {
  companyCode: string;
  companyName: string;
  departmentCode: string;
  departmentName: string;
  enDepartmentName: string;
  departmentLevel?: string;
  uprDepartmentCode?: string;
  uprDepartmentName?: string;
  enUprDepartmentName?: string;
  lowDepartmentYn?: string;
  managerId?: string;
  managerName?: string;
}

export interface DeptHierarchy {
  team: string;           // 영문 팀 이름
  center2Name: string;    // 1차 상위부서 영문 (immediate parent)
  center1Name: string;    // 2차 상위부서 영문 (grandparent)
}

/**
 * Knox API로 임직원 조회
 */
export async function lookupEmployee(loginid: string): Promise<KnoxEmployee | null> {
  if (!KNOX_SYSTEM_ID || !KNOX_AUTH_TOKEN) {
    console.warn('[Knox] API credentials not configured (KNOX_SYSTEM_ID / KNOX_AUTH_TOKEN)');
    return null;
  }

  try {
    const url = `${KNOX_API_URL}/employees?companyCode=${KNOX_COMPANY_CODE}&userIds=${encodeURIComponent(loginid)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'System-ID': KNOX_SYSTEM_ID,
        'Authorization': `Bearer ${KNOX_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resultType: 'basic' }),
    });

    if (!response.ok) {
      console.error(`[Knox] API returned ${response.status}: ${response.statusText}`);
      return null;
    }

    const data = await response.json() as KnoxApiResponse;

    if (data.result !== 'success' || !data.employees || data.employees.length === 0) {
      console.log(`[Knox] Employee not found: ${loginid}`);
      return null;
    }

    const employee = data.employees[0];

    // 재직(B) 또는 휴직(V) 상태만 허용
    if (employee.employeeStatus !== 'B' && employee.employeeStatus !== 'V') {
      console.log(`[Knox] Employee ${loginid} status is ${employee.employeeStatus} (not active)`);
      return null;
    }

    return employee;
  } catch (error) {
    console.error('[Knox] API call failed:', error);
    return null;
  }
}

/**
 * Knox API로 임직원 일괄 조회 (최대 100명)
 * userIds를 콤마로 구분하여 한 번의 API 호출로 여러 명 조회
 * @returns Map<loginid, KnoxEmployee> (재직/휴직 상태인 직원만)
 */
export async function lookupEmployeesBatch(loginids: string[]): Promise<Map<string, KnoxEmployee>> {
  const result = new Map<string, KnoxEmployee>();

  if (!KNOX_SYSTEM_ID || !KNOX_AUTH_TOKEN) {
    console.warn('[Knox] API credentials not configured (KNOX_SYSTEM_ID / KNOX_AUTH_TOKEN)');
    return result;
  }

  if (loginids.length === 0) return result;

  // Knox API 한 번에 최대 100명, 타임아웃 15초
  const BATCH_SIZE = 100;
  const TIMEOUT_MS = 15_000;

  for (let i = 0; i < loginids.length; i += BATCH_SIZE) {
    const batch = loginids.slice(i, i + BATCH_SIZE);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const userIdsParam = batch.map(id => encodeURIComponent(id)).join(',');
      const url = `${KNOX_API_URL}/employees?companyCode=${KNOX_COMPANY_CODE}&userIds=${userIdsParam}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'System-ID': KNOX_SYSTEM_ID,
          'Authorization': `Bearer ${KNOX_AUTH_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resultType: 'basic' }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`[Knox Batch] API returned ${response.status}: ${response.statusText}`);
        continue;
      }

      const data = await response.json() as KnoxApiResponse;

      if (data.result !== 'success' || !data.employees) continue;

      for (const emp of data.employees) {
        // 재직(B) 또는 휴직(V) 상태만 허용
        if (emp.employeeStatus === 'B' || emp.employeeStatus === 'V') {
          result.set(emp.userId, emp);
        }
      }
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`[Knox Batch] API call failed for batch starting at index ${i}:`, error);
    }
  }

  return result;
}

/**
 * Knox 조직도 API로 부서 정보 조회
 */
export async function lookupOrganization(departmentCode: string): Promise<KnoxOrganization | null> {
  if (!KNOX_SYSTEM_ID || !KNOX_AUTH_TOKEN) {
    console.warn('[Knox] API credentials not configured');
    return null;
  }

  try {
    const url = `${KNOX_API_URL}/organizations?companyCode=${KNOX_COMPANY_CODE}&departmentCode=${encodeURIComponent(departmentCode)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'System-ID': KNOX_SYSTEM_ID,
        'Authorization': `Bearer ${KNOX_AUTH_TOKEN}`,
      },
    });

    if (!response.ok) {
      console.error(`[Knox Org] API returned ${response.status}: ${response.statusText}`);
      return null;
    }

    const data = await response.json() as KnoxOrgResponse;

    if (data.result !== 'success' || !data.organizations || data.organizations.length === 0) {
      console.log(`[Knox Org] Department not found: ${departmentCode}`);
      return null;
    }

    return data.organizations[0];
  } catch (error) {
    console.error('[Knox Org] API call failed:', error);
    return null;
  }
}

/**
 * 부서 계층 조회 (DB 캐시 우선, 미스 시 Knox Organization API 호출)
 *
 * 흐름:
 * 1. DB department_hierarchies 테이블에서 departmentCode로 조회
 * 2. 캐시 미스 → Knox Organization API 호출:
 *    a. departmentCode → enDepartmentName (team), uprDepartmentCode (parent)
 *    b. uprDepartmentCode → enUprDepartmentName (center_1_name = grandparent)
 * 3. 결과를 DB에 캐싱
 */
export async function getDepartmentHierarchy(
  departmentCode: string,
  departmentName: string,
  enDepartmentName: string,
): Promise<DeptHierarchy | null> {
  if (!departmentCode) return null;

  // 1. DB 캐시 조회
  try {
    const cached = await prisma.departmentHierarchy.findUnique({
      where: { departmentCode },
    });

    if (cached) {
      return {
        team: cached.team,
        center2Name: cached.center2Name,
        center1Name: cached.center1Name,
      };
    }
  } catch (err) {
    console.error('[DeptHierarchy] Cache lookup failed:', err);
  }

  // 2. 캐시 미스 → Knox Organization API 호출
  const team = enDepartmentName || '';

  // 2a. 현재 부서 조회 → 상위부서 코드/영문명 (center_2_name)
  const org = await lookupOrganization(departmentCode);
  if (!org) {
    console.log(`[DeptHierarchy] Could not lookup org for ${departmentCode}`);
    return null;
  }

  const center2Name = org.enUprDepartmentName || '';
  let center1Name = '';

  // 2b. 상위부서 조회 → 그 상위부서의 영문명 (center_1_name)
  if (org.uprDepartmentCode) {
    const parentOrg = await lookupOrganization(org.uprDepartmentCode);
    if (parentOrg) {
      center1Name = parentOrg.enUprDepartmentName || '';
    }
  }

  const hierarchy: DeptHierarchy = { team, center2Name, center1Name };

  // 3. DB에 캐싱
  try {
    await prisma.departmentHierarchy.upsert({
      where: { departmentCode },
      update: {
        departmentName: departmentName || org.departmentName || '',
        team,
        center2Name,
        center1Name,
      },
      create: {
        departmentCode,
        departmentName: departmentName || org.departmentName || '',
        team,
        center2Name,
        center1Name,
      },
    });
    console.log(`[DeptHierarchy] Cached: ${departmentCode} → team="${team}", center2="${center2Name}", center1="${center1Name}"`);
  } catch (err) {
    console.error('[DeptHierarchy] Failed to cache hierarchy:', err);
  }

  return hierarchy;
}

/**
 * Knox 인증 + 부서 검증 + 조직 계층 캐싱
 * @returns 인증 결과 (성공 시 employee 정보 + 조직 계층, 실패 시 error)
 */
export async function verifyAndRegisterUser(
  loginid: string,
  claimedDeptName: string,
  method: 'PROXY' | 'DASHBOARD' | 'ADMIN_REGISTER',
  endpoint?: string,
  ipAddress?: string,
): Promise<{
  success: boolean;
  employee?: KnoxEmployee;
  user?: { id: string; loginid: string; username: string; deptname: string };
  hierarchy?: DeptHierarchy | null;
  error?: string;
}> {
  const employee = await lookupEmployee(loginid);

  if (!employee) {
    // 인증 실패 로그
    await recordVerification({ loginid, username: '', knoxDeptName: '', claimedDeptName, method, endpoint, success: false, errorMessage: '임직원 정보를 확인할 수 없습니다', ipAddress });
    return { success: false, error: '임직원 정보를 확인할 수 없습니다. Knox Portal에 등록된 재직/휴직 상태의 임직원만 이용 가능합니다.' };
  }

  // 부서 검증: x-dept-name vs Knox departmentName 직접 비교
  // 둘 다 "팀명(사업부)" 형태 (예: "S/W혁신팀(S.LSI)")
  if (claimedDeptName && method !== 'ADMIN_REGISTER') {
    const knoxDept = employee.departmentName;
    // 직접 비교 → 팀명 부분 비교 순으로 fallback
    if (claimedDeptName !== knoxDept) {
      const claimedTeam = extractTeamName(claimedDeptName);
      const knoxTeam = extractTeamName(knoxDept);
      if (claimedTeam && knoxTeam && claimedTeam !== knoxTeam) {
        await recordVerification({ loginid, username: employee.fullName, knoxDeptName: knoxDept, claimedDeptName, method, endpoint, success: false,
          errorMessage: `부서 불일치: 입력=${claimedDeptName}, Knox=${knoxDept}`, ipAddress });
        return {
          success: false,
          error: `부서 정보가 일치하지 않습니다. 입력: "${claimedDeptName}", 실제: "${knoxDept}". 올바른 부서 정보를 사용해 주세요.`,
        };
      }
    }
  }

  // Knox에서 가져온 부서명 사용 (정확한 정보)
  const deptname = employee.departmentName || claimedDeptName;
  const businessUnit = extractBU(deptname);

  // 부서 계층 조회 (비동기, 실패해도 인증은 통과)
  let hierarchy: DeptHierarchy | null = null;
  try {
    hierarchy = await getDepartmentHierarchy(
      employee.departmentCode,
      employee.departmentName,
      employee.enDepartmentName,
    );
  } catch (err) {
    console.error('[Knox] getDepartmentHierarchy failed (non-blocking):', err);
  }

  // User upsert (Knox 정보로 한글이름 + 영문부서 + 부서코드 업데이트 + knoxVerified=true)
  const user = await prisma.user.upsert({
    where: { loginid },
    update: {
      username: employee.fullName,
      deptname,
      businessUnit,
      enDeptName: employee.enDepartmentName || null,
      departmentCode: employee.departmentCode || null,
      knoxVerified: true,
      lastActive: new Date(),
    },
    create: {
      loginid,
      username: employee.fullName,
      deptname,
      businessUnit,
      enDeptName: employee.enDepartmentName || null,
      departmentCode: employee.departmentCode || null,
      knoxVerified: true,
    },
  });

  // 인증 성공 로그
  await recordVerification({ loginid, username: employee.fullName, knoxDeptName: employee.departmentName, claimedDeptName, method, endpoint, success: true, errorMessage: null, ipAddress });

  return { success: true, employee, user, hierarchy };
}

/**
 * 인증 이력 기록 (요청 정보 + Knox 조회 결과 전체 저장)
 */
async function recordVerification(params: {
  loginid: string;
  username: string;
  knoxDeptName: string;
  claimedDeptName: string;
  method: string;
  endpoint?: string | null;
  success: boolean;
  errorMessage?: string | null;
  ipAddress?: string | null;
}) {
  try {
    await prisma.knoxVerification.create({
      data: {
        loginid: params.loginid,
        username: params.username,
        knoxDeptName: params.knoxDeptName,
        claimedDeptName: params.claimedDeptName,
        method: params.method,
        endpoint: params.endpoint || null,
        success: params.success,
        errorMessage: params.errorMessage || null,
        ipAddress: params.ipAddress || null,
      },
    });
  } catch (err) {
    console.error('[Knox] Failed to record verification:', err);
  }
}

/**
 * 팀명 추출 (괄호 앞 부분)
 * "S/W혁신팀(S.LSI)" → "S/W혁신팀"
 */
function extractTeamName(deptname: string): string {
  if (!deptname) return '';
  const match = deptname.match(/^([^(]+)/);
  return match ? match[1].trim() : deptname.trim();
}

/**
 * 사업부 코드 추출 (괄호 안 부분)
 * "S/W혁신팀(S.LSI)" → "S.LSI"
 */
function extractBU(deptname: string): string {
  if (!deptname) return '';
  const match = deptname.match(/\(([^)]+)\)/);
  return match ? match[1] : '';
}

/**
 * 최상위 사업부 여부 확인
 * 이 단위 이상은 조직 계층 표시에 의미가 없으므로 "none" 처리
 */
const TOP_LEVEL_DIVISIONS = [
  'Device Solution',
  'Device Solutions',
  'System LSI',
  'System LSI Business',
  'SAMSUNG SDS',
  'Samsung Electronics',
  'Samsung Semiconductor',
];

export function isTopLevelDivision(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase().trim();
  // 정확히 일치하거나 포함 관계로 매칭 (Device Solution ↔ Device Solutions 등)
  return TOP_LEVEL_DIVISIONS.some(d => {
    const dl = d.toLowerCase();
    return lower === dl || lower.startsWith(dl) || dl.startsWith(lower);
  });
}
