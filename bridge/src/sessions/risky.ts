/**
 * 되돌리기 어려운 명령 판정.
 *
 * 기획안에 "위험한 명령(삭제, 배포 등)은 승인 화면에서 명령어를 반드시 표시"
 * 라고 적혀 있는데, 처음 만들 때 **배포를 하나도 넣지 않았습니다.**
 * 그래서 워치에서 `npx vercel --prod` 가 빨간 경고 없이, 더블 탭만으로
 * 승인될 수 있는 상태였습니다. 실제로 그렇게 승인된 기록이 있습니다.
 *
 * 여기 걸리면 워치에서:
 *   - 빨갛게 강조되고
 *   - 더블 탭이 막혀 화면을 직접 눌러야 합니다.
 *
 * 애매하면 위험 쪽으로 판정합니다. 잘못 걸러서 한 번 더 누르는 건 불편할 뿐이고,
 * 못 걸러서 운영 배포가 손목 두 번에 나가는 건 되돌릴 수 없습니다.
 */
export const RISKY = new RegExp(
  [
    // 삭제
    /rm\s+-[a-z]*[rf]/.source,
    /\bshred\b|\bmkfs\b|\bdiskutil\s+erase/.source,
    // 형상관리
    /git\s+push/.source,
    /git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f/.source,
    // 배포 — 기획안이 명시한 항목인데 빠져 있었습니다
    /vercel\s+(--prod|deploy|alias)|netlify\s+deploy|fly\s+deploy|wrangler\s+(deploy|publish)/.source,
    /eas\s+(build|submit)|fastlane|xcrun\s+altool|expo\s+publish/.source,
    /docker\s+push|gh\s+release\s+create|npm\s+publish|yarn\s+publish|pnpm\s+publish/.source,
    /terraform\s+(apply|destroy)|serverless\s+deploy|sam\s+deploy|cdk\s+deploy/.source,
    // 인프라·클라우드
    /kubectl\s+(delete|apply)|helm\s+(install|upgrade|uninstall)/.source,
    /aws\s+s3\s+(rm|sync)|aws\s+.*\bdelete\b|gcloud\s+.*\b(delete|deploy)\b/.source,
    // 데이터베이스
    /DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|DELETE\s+FROM/.source,
    /prisma\s+(migrate\s+deploy|db\s+push)|supabase\s+db\s+push/.source,
    // 권한 상승·시스템
    /\bsudo\b|\bshutdown\b|\breboot\b|launchctl\s+(bootout|unload)/.source,
    // 돈·외부로 나가는 것
    /curl\s+.*-X\s*(POST|PUT|DELETE)/.source,
  ].join('|'),
  'i',
);

export function isRisky(command: string): boolean {
  return RISKY.test(command);
}
