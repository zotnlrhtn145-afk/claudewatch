import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const envFile = resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function str(key: string, fallback = ''): string {
  return (process.env[key] ?? '').trim() || fallback;
}

function num(key: string, fallback: number): number {
  const n = Number.parseInt(str(key), 10);
  return Number.isFinite(n) ? n : fallback;
}

export type DriverKind = 'sdk' | 'remote-control';

/**
 * 맥 잠자기 방지 정책.
 *   sessions — 살아 있는 세션이 있는 동안만 (기본)
 *   always   — 브리지가 떠 있는 내내. 워치가 언제든 닿아야 할 때.
 *   off      — 쓰지 않음
 */
export type KeepAwake = 'sessions' | 'always' | 'off';

const driver = str('BRIDGE_DRIVER', 'sdk');
const keepAwake = str('BRIDGE_KEEP_AWAKE', 'sessions');

export const config = {
  host: str('BRIDGE_HOST', '0.0.0.0'),
  port: num('BRIDGE_PORT', 8765),
  token: str('BRIDGE_TOKEN'),
  driver: (driver === 'remote-control' ? 'remote-control' : 'sdk') as DriverKind,
  keepAwake: (keepAwake === 'always' || keepAwake === 'off' ? keepAwake : 'sessions') as KeepAwake,
  maxLog: num('BRIDGE_MAX_LOG', 500),
  /**
   * 워치와 **동시에** 맥 화면에도 승인 창을 띄울지.
   * 훅이 가로채면 터미널·핸드폰에는 아무것도 안 뜨므로, 맥 앞에 있을 때
   * 손목을 봐야 하는 불편을 없애 줍니다. 먼저 답한 쪽을 따릅니다.
   */
  macPrompt: str('BRIDGE_MAC_PROMPT', 'on') !== 'off',
  /**
   * 훅이 물어봐도 워치로 넘기지 않을 세션 ID 목록.
   * 브리지 자신을 돌보는 세션이 매 명령마다 손목을 울리면 일을 할 수 없습니다.
   */
  hookSkip: str('BRIDGE_HOOK_SKIP')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** 빈 배열이면 홈 아래에서 git 저장소를 자동 탐색합니다. */
  projects: str('BRIDGE_PROJECTS')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('~') ? resolve(homedir(), p.slice(1).replace(/^\//, '')) : resolve(p))),
  apns: {
    keyPath: str('APNS_KEY_PATH'),
    keyId: str('APNS_KEY_ID'),
    teamId: str('APNS_TEAM_ID'),
    bundleId: str('APNS_BUNDLE_ID'),
    env: (str('APNS_ENV', 'sandbox') === 'production' ? 'production' : 'sandbox') as
      | 'sandbox'
      | 'production',
  },
} as const;

export const apnsConfigured = Boolean(
  config.apns.keyPath && config.apns.keyId && config.apns.teamId && config.apns.bundleId,
);
