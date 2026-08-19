import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { log } from '../log.js';

/**
 * 「항상 허용」 목록.
 *
 * 워치에서 「항상 허용」을 누르면 그 명령을 여기에 적어 두고, 다음부터는
 * 묻지 않고 통과시킵니다. 파일에 남기므로 브리지를 껐다 켜도 유지됩니다.
 *
 * **명령어 전체가 똑같을 때만** 통과시킵니다. `npx vercel *` 같은 무늬로 넓게
 * 잡지 않습니다 — 그렇게 하면 `npx vercel --prod` 운영 배포까지 조용히
 * 지나갑니다. 실제로 데스크톱 설정에 그런 항목이 쌓여 있는 걸 확인했습니다.
 *
 * 되돌리기 어려운 명령(`risky`)은 애초에 「항상 허용」을 띄우지 않습니다.
 * 지우려면 이 파일을 열어 해당 줄을 지우면 됩니다.
 */

const FILE = resolve(import.meta.dirname, '../../.allowed.json');

interface Entry {
  command: string;
  /** 언제 허용했는지 — 나중에 목록을 정리할 때 판단 근거가 됩니다. */
  at: number;
  /** 어느 세션에서 허용했는지 */
  from: string;
}

let entries: Entry[] = [];

try {
  if (existsSync(FILE)) entries = JSON.parse(readFileSync(FILE, 'utf8')) as Entry[];
} catch (error) {
  log.warn(`허용 목록을 읽지 못했습니다: ${String(error)}`);
  entries = [];
}

function persist(): void {
  try {
    writeFileSync(FILE, JSON.stringify(entries, null, 2));
  } catch (error) {
    log.warn(`허용 목록을 저장하지 못했습니다: ${String(error)}`);
  }
}

export function isAllowed(command: string): boolean {
  const clean = command.trim();
  return entries.some((e) => e.command === clean);
}

/** 「항상 허용」. 이미 있으면 아무것도 하지 않습니다. */
export function remember(command: string, from: string): void {
  const clean = command.trim();
  if (!clean || isAllowed(clean)) return;
  entries.push({ command: clean, at: Date.now(), from });
  persist();
  log.info(`항상 허용에 추가했습니다 (${entries.length}개): ${clean.slice(0, 70)}`);
}

export function allowedCount(): number {
  return entries.length;
}

export function allowedList(): Entry[] {
  return [...entries];
}
