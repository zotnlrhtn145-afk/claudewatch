import { log } from '../log.js';

/**
 * 토큰 추측 시도 제한.
 *
 * Funnel 로 내주면 브리지가 공개 인터넷에 놓이고, 그때부터 `BRIDGE_TOKEN` 이
 * 유일한 방어선입니다. 토큰 자체는 24바이트 랜덤이라 추측 강도는 충분하지만,
 * 무제한으로 찔러볼 수 있게 두는 것과 못 찔러보게 막는 것은 다릅니다.
 *
 * 성공하면 그 IP 의 기록을 지웁니다 — 정상 사용자는 영향을 받지 않습니다.
 */

/** 이 횟수까지는 그냥 401. 넘으면 잠깁니다. */
const MAX_FAILURES = 8;
/** 잠기는 시간. 실패가 계속되면 이 시간이 늘어납니다. */
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 30 * 60_000;
/** 이 시간 동안 조용하면 기록을 잊습니다. */
const FORGET_MS = 60 * 60_000;

interface Record {
  failures: number;
  lockedUntil: number;
  lastSeen: number;
}

const records = new Map<string, Record>();

/** 기록이 무한정 쌓이지 않게 오래된 것을 걷어냅니다. */
function sweep(now: number): void {
  for (const [key, record] of records) {
    if (now - record.lastSeen > FORGET_MS) records.delete(key);
  }
}

/**
 * 지금 이 IP 가 잠겨 있는지. 잠겨 있으면 몇 초 남았는지 돌려줍니다.
 */
export function lockedFor(ip: string): number {
  const record = records.get(ip);
  if (!record) return 0;
  const left = record.lockedUntil - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

export function noteFailure(ip: string): void {
  const now = Date.now();
  sweep(now);

  const record = records.get(ip) ?? { failures: 0, lockedUntil: 0, lastSeen: now };
  record.failures += 1;
  record.lastSeen = now;

  if (record.failures >= MAX_FAILURES) {
    // 8회째부터 1분, 그 뒤로 실패마다 2배씩 — 최대 30분.
    const step = record.failures - MAX_FAILURES;
    const lock = Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** step);
    record.lockedUntil = now + lock;
    log.warn(`토큰 실패 ${record.failures}회 (${ip}) — ${Math.round(lock / 1000)}초 잠금`);
  }

  records.set(ip, record);
}

/** 정상 접속이 확인되면 기록을 지웁니다. */
export function noteSuccess(ip: string): void {
  records.delete(ip);
}
