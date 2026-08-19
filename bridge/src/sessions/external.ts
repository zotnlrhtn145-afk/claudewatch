import { randomUUID } from 'node:crypto';

import { log } from '../log.js';
import { pushApproval } from '../push/apns.js';
import { isAllowed, remember } from './allowlist.js';
import { askMac } from './mac-prompt.js';
import { isRisky } from './risky.js';
import type { PendingApproval } from './types.js';

/**
 * 맥에서 따로 돌고 있는 세션의 승인을 워치로 넘깁니다.
 *
 * 그 세션들은 브리지의 자식이 아니라 우리가 키를 넣을 수 없습니다.
 * 대신 클로드코드의 `PreToolUse` 훅이 도구 실행 직전에 이쪽으로 물어봅니다.
 * 훅은 답이 올 때까지 기다리고, 워치에서 누른 결과를 그대로 돌려줍니다.
 *
 *   터미널 세션 → 훅 → 브리지 → 푸시 → ⌚ 승인 → 훅이 allow/deny 반환
 *
 * 답이 없으면 훅은 아무 결정도 내리지 않고 빠집니다. 그러면 평소처럼
 * 터미널에서 물어봅니다 — **워치가 꺼져 있다고 작업이 막히면 안 됩니다.**
 */

interface Waiting {
  approval: PendingApproval;
  /** 세션을 가리키는 열쇠. 워치 목록의 id 와 같습니다. */
  sessionKey: string;
  sessionName: string;
  resolve: (decision: 'allow' | 'deny' | 'timeout') => void;
  timer: NodeJS.Timeout;
}

/** 세션 하나당 대기 하나. 클로드코드도 한 번에 하나만 물어봅니다. */
const waiting = new Map<string, Waiting>();


/** 도구 입력에서 워치에 보여 줄 한 줄을 뽑습니다. 원문이 반드시 보여야 합니다. */
export function describeTool(toolName: string, input: Record<string, unknown>): string {
  const str = (key: string): string => (typeof input[key] === 'string' ? (input[key] as string) : '');

  const command = str('command');
  if (command) return command;

  const path = str('file_path') || str('path') || str('notebook_path');
  if (path) return `${toolName}(${path})`;

  const url = str('url');
  if (url) return `${toolName}(${url})`;

  const rendered = JSON.stringify(input);
  return `${toolName}(${rendered.length > 120 ? `${rendered.slice(0, 119)}…` : rendered})`;
}

export function pendingFor(sessionKey: string): PendingApproval | null {
  return waiting.get(sessionKey)?.approval ?? null;
}

export function hasWaiting(): boolean {
  return waiting.size > 0;
}

/**
 * 훅이 부릅니다. 워치가 답할 때까지 기다렸다가 결정을 돌려줍니다.
 * 시간이 지나면 'timeout' 이고, 훅은 그때 아무 결정도 내리지 않습니다.
 */
export function askWatch(input: {
  sessionKey: string;
  sessionName: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timeoutMs: number;
}): Promise<'allow' | 'deny' | 'timeout'> {
  // 같은 세션에 이미 대기가 있으면 옛것을 접습니다. 화면에 둘이 겹치면 안 됩니다.
  const previous = waiting.get(input.sessionKey);
  if (previous) {
    clearTimeout(previous.timer);
    previous.resolve('timeout');
    waiting.delete(input.sessionKey);
  }

  const command = describeTool(input.toolName, input.toolInput);

  // 「항상 허용」 해 둔 명령이면 손목을 울리지 않습니다.
  if (isAllowed(command)) {
    log.info(`[${input.sessionName}] 항상 허용된 명령 — 묻지 않고 통과: ${command.slice(0, 60)}`);
    return Promise.resolve('allow');
  }

  const approval: PendingApproval = {
    id: randomUUID(),
    toolName: input.toolName,
    command,
    title: `${input.sessionName} 에서 실행하려 합니다`,
    risky: isRisky(command),
    requestedAt: Date.now(),
  };

  log.info(`[${input.sessionName}] 워치에 승인 요청: ${command}`);

  return new Promise((resolve) => {
    // 맥 화면에도 같은 요청을 띄웁니다. 먼저 답한 쪽을 따릅니다.
    const mac = askMac({
      sessionName: input.sessionName,
      command,
      risky: approval.risky,
      timeoutSeconds: input.timeoutMs / 1000,
    });

    /** 어느 쪽으로 끝나든 한 번만 정리합니다. */
    const finish = (decision: 'allow' | 'deny' | 'timeout', from: string) => {
      const entry = waiting.get(input.sessionKey);
      if (entry?.approval.id !== approval.id) return;
      clearTimeout(entry.timer);
      waiting.delete(input.sessionKey);
      mac?.cancel();
      if (decision !== 'timeout') log.info(`[${input.sessionName}] ${from} 에서 응답했습니다.`);
      resolve(decision);
    };

    const timer = setTimeout(() => {
      log.warn(`[${input.sessionName}] 아무도 답하지 않아 터미널로 넘깁니다.`);
      finish('timeout', '시간 초과');
    }, input.timeoutMs);

    waiting.set(input.sessionKey, {
      approval,
      sessionKey: input.sessionKey,
      sessionName: input.sessionName,
      // 워치가 답하면 이 resolve 를 통해 들어옵니다.
      resolve: (decision) => finish(decision, '워치'),
      timer,
    });

    void mac?.answer.then((decision) => finish(decision, '맥'));

    void pushApproval({
      sessionId: input.sessionKey,
      sessionName: input.sessionName,
      approvalId: approval.id,
      command,
      risky: approval.risky,
    });
  });
}

/** 워치에서 누른 결과. 훅이 기다리던 약속을 풉니다. */
export function decideExternal(
  sessionKey: string,
  decision: 'allow' | 'deny',
  approvalId?: string,
  always?: boolean,
): 'ok' | 'no-session' | 'stale' {
  const entry = waiting.get(sessionKey);
  if (!entry) return 'no-session';
  // 워치가 본 것과 지금 대기 중인 게 다르면 막습니다. 엉뚱한 명령을 승인하면 안 됩니다.
  if (approvalId && approvalId !== entry.approval.id) return 'stale';

  // 정리는 resolve 안쪽(finish)이 합니다. 여기서 먼저 지우면
  // finish 가 "이미 없는 요청" 으로 보고 그냥 빠져나가서, 훅이 영원히 기다립니다.
  // 「항상 허용」은 되돌리기 어려운 명령에는 쓰지 않습니다.
  // 그런 건 매번 눈으로 봐야 합니다.
  if (always && decision === 'allow' && !entry.approval.risky) {
    remember(entry.approval.command, entry.sessionName);
  }

  log.info(`[${entry.sessionName}] ${decision === 'allow' ? '승인' : '거부'}: ${entry.approval.command}`);
  entry.resolve(decision);
  return 'ok';
}
