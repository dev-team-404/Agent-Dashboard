/**
 * Knox Employee API Service
 *
 * Samsung Knox Portal 임직원 조회 API 연동
 * - 임직원 정보 조회 (userId 기반)
 * - 부서 정보 검증
 * - 한글 이름 자동 세팅
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
 * Knox 인증 + 부서 검증
 * @returns 인증 결과 (성공 시 employee 정보, 실패 시 error)
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

  // User upsert (Knox 정보로 한글이름 업데이트 + knoxVerified=true)
  const user = await prisma.user.upsert({
    where: { loginid },
    update: {
      username: employee.fullName,
      deptname,
      businessUnit,
      knoxVerified: true,
      lastActive: new Date(),
    },
    create: {
      loginid,
      username: employee.fullName,
      deptname,
      businessUnit,
      knoxVerified: true,
    },
  });

  // 인증 성공 로그
  await recordVerification({ loginid, username: employee.fullName, knoxDeptName: employee.departmentName, claimedDeptName, method, endpoint, success: true, errorMessage: null, ipAddress });

  return { success: true, employee, user };
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
