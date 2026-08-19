import { randomInt } from 'node:crypto';

import { config } from '../config.js';
import { log } from '../log.js';

/**
 * 페어링 코드.
 *
 * 워치에서 32자 토큰을 손으로 넣는 건 사실상 불가능합니다. 받아쓰기도 안 됩니다.
 * 그래서 맥에서 짧은 숫자 코드를 하나 발급하고, 워치는 그 숫자만 눌러
 * 진짜 토큰을 받아 키체인에 넣습니다.
 *
 * 안전장치:
 *   - 코드 발급은 **맥 안에서만** 됩니다 (localhost 전용). 밖에서는 못 만듭니다.
 *   - 3분 지나면 죽습니다.
 *   - 한 번 쓰면 죽습니다.
 *   - 틀린 코드는 토큰과 같은 시도 제한을 받습니다 (8회 → 잠금).
 *
 * 8자리면 1억 가지입니다. 8회 실패마다 잠기고 잠금이 두 배씩 늘어나므로
 * 3분 안에 찍어 맞히는 건 현실적으로 불가능합니다.
 */

const CODE_TTL_MS = 3 * 60_000;
const DIGITS = 8;

interface Pending {
  code: string;
  expiresAt: number;
}

let pending: Pending | null = null;

function generate(): string {
  let out = '';
  for (let i = 0; i < DIGITS; i += 1) out += String(randomInt(0, 10));
  return out;
}

/** 맥에서 코드를 하나 발급합니다. 이전 코드는 무효가 됩니다. */
export function mintCode(): { code: string; expiresAt: number; ttlSeconds: number } {
  const code = generate();
  const expiresAt = Date.now() + CODE_TTL_MS;
  pending = { code, expiresAt };
  log.info(`페어링 코드를 발급했습니다 (${CODE_TTL_MS / 1000}초 유효)`);
  return { code, expiresAt, ttlSeconds: CODE_TTL_MS / 1000 };
}

/**
 * 워치가 보낸 코드를 확인하고 진짜 토큰을 돌려줍니다.
 * 맞았든 틀렸든 코드는 바로 버립니다 — 한 번 쓰면 끝입니다.
 */
export function redeem(given: string): string | null {
  const now = Date.now();
  if (!pending || pending.expiresAt < now) {
    pending = null;
    return null;
  }

  const ok = given === pending.code;
  pending = null; // 성공이든 실패든 한 번 시도하면 폐기합니다.

  if (!ok) return null;
  log.info('워치가 페어링 코드로 토큰을 받아 갔습니다.');
  return config.token;
}

export function hasPending(): boolean {
  return pending !== null && pending.expiresAt > Date.now();
}
