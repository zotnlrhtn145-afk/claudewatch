import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';

import { log } from '../log.js';
import { pendingFor } from './external.js';
import type { SessionStatus, SessionSummary } from './types.js';

/**
 * 맥에서 따로 돌고 있는 클로드코드 세션 찾기.
 *
 * 터미널에서 직접 띄운 세션들은 브리지의 자식이 아니라 조종할 수 없습니다.
 * 하지만 클로드코드가 `~/.claude/sessions/<pid>.json` 에 상태를 남기고 있어서
 * **어떤 세션이 어디서 무슨 상태로 돌고 있는지는 읽을 수 있습니다.**
 *
 * 핸드폰 공식 앱에 뜨는 것과 같은 목록을 워치에도 보여 주기 위한 것입니다.
 * 읽기 전용입니다 — 승인·지시는 할 수 없고, 워치에서도 그렇게 표시합니다.
 *
 * 같은 폴더의 `.key` 파일에는 접속용 비밀값이 들어 있습니다. **읽지 않습니다.**
 */

const SESSIONS_DIR = resolve(homedir(), '.claude/sessions');

interface RawSession {
  pid?: number;
  sessionId?: string;
  cwd?: string;
  name?: string;
  status?: string;
  startedAt?: number;
  updatedAt?: number;
  kind?: string;
  /** 공식 앱·웹에서 이 세션을 가리키는 ID. claude.ai/code/<이 값> */
  bridgeSessionId?: string;
}

/** 클로드코드의 상태 표현을 워치의 상태 점으로 옮깁니다. */
function toStatus(raw: string | undefined): SessionStatus {
  switch (raw) {
    case 'busy':
    case 'shell':
      return 'running';
    case 'idle':
    case 'ready':
      return 'idle';
    case 'waiting':
    case 'waiting_approval':
      return 'waiting_approval';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

/** 프로세스가 아직 살아 있는지. 죽은 세션 파일이 남아 있는 경우가 있습니다. */
function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 지금 돌고 있는 외부 세션 목록.
 * @param excludeClaudeIds 브리지가 직접 띄운 세션의 클로드 ID — 중복으로 뜨면 안 됩니다.
 */
export function discoverExternal(excludeClaudeIds: Set<string>): SessionSummary[] {
  if (!existsSync(SESSIONS_DIR)) return [];

  const out: SessionSummary[] = [];
  let files: string[];
  try {
    files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
  } catch (error) {
    log.warn(`세션 폴더를 읽지 못했습니다: ${String(error)}`);
    return [];
  }

  for (const file of files) {
    let raw: RawSession;
    try {
      raw = JSON.parse(readFileSync(resolve(SESSIONS_DIR, file), 'utf8')) as RawSession;
    } catch {
      continue; // 쓰는 중이라 깨져 보일 수 있습니다. 다음 폴링에서 다시 봅니다.
    }

    if (!alive(raw.pid)) continue;
    if (raw.bridgeSessionId && excludeClaudeIds.has(raw.bridgeSessionId)) continue;

    const cwd = raw.cwd ?? '';
    // pid 는 재시작하면 바뀝니다. 훅이 보내 주는 session_id 를 열쇠로 씁니다.
    const key = `ext:${raw.sessionId ?? raw.pid}`;
    const pending = pendingFor(key);
    out.push({
      // 브리지가 만든 세션 ID(UUID)와 섞이지 않게 접두어를 붙입니다.
      id: key,
      name: raw.name || basename(cwd) || '이름 없는 세션',
      project: cwd,
      status: pending ? 'waiting_approval' : toStatus(raw.status),
      createdAt: raw.startedAt ?? Date.now(),
      updatedAt: pending ? pending.requestedAt : raw.updatedAt ?? Date.now(),
      pending,
      // 워치가 "이건 볼 수만 있다" 를 알아야 승인 버튼을 감춥니다.
      external: true,
      claudeSessionId: raw.bridgeSessionId ?? null,
    });
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
