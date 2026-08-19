import { randomUUID } from 'node:crypto';

import { isLiveStatus, sleepGuard } from '../awake.js';
import { config } from '../config.js';
import { log } from '../log.js';
import { pushApproval } from '../push/apns.js';
import { discoverExternal } from './discover.js';
import { remember as rememberAllowed } from './allowlist.js';
import { decideExternal } from './external.js';
import { createDriver } from './drivers/index.js';
import type { SessionDriver } from './drivers/types.js';
import { buildSummary } from './summary.js';
import { readTranscript } from './transcript.js';
import type { LogEntry, PendingApproval, SessionDetail, SessionStatus, SessionSummary } from './types.js';

interface SessionRecord {
  id: string;
  name: string;
  project: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  pending: PendingApproval | null;
  entries: LogEntry[];
  claudeSessionId: string | null;
  error: string | null;
  driver: SessionDriver;
}

/** 첫 지시에서 세션 이름을 뽑습니다. 워치 목록에 한 줄로 들어가야 합니다. */
function nameFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '새 세션';
  return oneLine.length > 28 ? `${oneLine.slice(0, 27)}…` : oneLine;
}

export class SessionManager {
  readonly #sessions = new Map<string, SessionRecord>();

  /**
   * 워치에 보여 줄 전체 목록.
   * 브리지가 띄운 세션 + 맥에서 따로 돌고 있는 세션(읽기 전용)을 합칩니다.
   * 후자는 공식 앱에 뜨는 것과 같은 목록입니다.
   */
  listAll(): SessionSummary[] {
    const mine = this.list();
    const claudeIds = new Set(
      [...this.#sessions.values()].map((s) => s.claudeSessionId).filter((id): id is string => !!id),
    );
    // 승인 대기가 있는 내 세션이 항상 위, 그다음 내 세션, 마지막이 외부 세션입니다.
    return [...mine, ...discoverExternal(claudeIds)];
  }

  list(): SessionSummary[] {
    return [...this.#sessions.values()]
      .sort((a, b) => {
        // 승인 대기가 항상 맨 위로. 워치에서 손목만 들면 바로 보여야 합니다.
        const aWaiting = a.status === 'waiting_approval' ? 0 : 1;
        const bWaiting = b.status === 'waiting_approval' ? 0 : 1;
        return aWaiting - bWaiting || b.updatedAt - a.updatedAt;
      })
      .map((s) => this.#toSummary(s));
  }

  detail(id: string): SessionDetail | null {
    // 맥에서 따로 돌고 있는 세션 — 조종은 못 해도 대화 내용은 보여 줍니다.
    if (id.startsWith('ext:')) return this.#externalDetail(id);

    const session = this.#sessions.get(id);
    if (!session) return null;
    return {
      ...this.#toSummary(session),
      summary: buildSummary(session.entries, session.status),
      logCount: session.entries.length,
      error: session.error,
      claudeSessionId: session.claudeSessionId,
      driver: session.driver.kind,
    };
  }

  logOf(id: string, limit?: number): LogEntry[] | null {
    if (id.startsWith('ext:')) {
      const summary = this.#findExternal(id);
      if (!summary) return null;
      return readTranscript(id.slice(4), limit && limit > 0 ? limit : 120);
    }

    const session = this.#sessions.get(id);
    if (!session) return null;
    return limit && limit > 0 ? session.entries.slice(-limit) : [...session.entries];
  }

  /** 발견된 외부 세션 하나 찾기. */
  #findExternal(id: string): SessionSummary | null {
    return discoverExternal(new Set()).find((s) => s.id === id) ?? null;
  }

  /** 외부 세션의 상세. 로그는 클로드코드가 남긴 대화 기록에서 읽습니다. */
  #externalDetail(id: string): SessionDetail | null {
    const summary = this.#findExternal(id);
    if (!summary) return null;

    const entries = readTranscript(id.slice(4));
    return {
      ...summary,
      summary: buildSummary(entries, summary.status),
      logCount: entries.length,
      error: null,
      claudeSessionId: summary.claudeSessionId ?? null,
      driver: 'external',
    };
  }

  async create(input: { project: string; firstPrompt: string; name?: string; resume?: string }): Promise<SessionDetail> {
    const id = randomUUID();
    const name = (input.name ?? '').trim() || nameFromPrompt(input.firstPrompt);
    const now = Date.now();

    const record: SessionRecord = {
      id,
      name,
      project: input.project,
      status: 'starting',
      createdAt: now,
      updatedAt: now,
      pending: null,
      entries: [],
      claudeSessionId: null,
      error: null,
      // 아래에서 바로 채웁니다.
      driver: null as unknown as SessionDriver,
    };

    record.driver = createDriver(config.driver, {
      onStatus: (status) => {
        // 승인 대기 중에 뒤늦게 도착한 running 이 상태를 덮어쓰지 않게 막습니다.
        if (record.pending && status === 'running') return;
        record.status = status;
        record.updatedAt = Date.now();
        this.#syncAwake();
      },
      onLog: (entry) => {
        record.entries.push({ ...entry, t: Date.now() });
        if (record.entries.length > config.maxLog) {
          record.entries.splice(0, record.entries.length - config.maxLog);
        }
        record.updatedAt = Date.now();
      },
      onApproval: (pending) => {
        record.pending = pending;
        record.status = 'waiting_approval';
        record.updatedAt = Date.now();
        void pushApproval({
          sessionId: id,
          sessionName: record.name,
          approvalId: pending.id,
          command: pending.command,
          risky: pending.risky,
        });
        log.info(`[${record.name}] 승인 대기: ${pending.command}`);
      },
      onApprovalResolved: (approvalId) => {
        if (record.pending?.id === approvalId) record.pending = null;
        record.updatedAt = Date.now();
      },
      onClaudeSessionId: (claudeId) => {
        record.claudeSessionId = claudeId;
      },
      onError: (message) => {
        record.error = message;
        record.updatedAt = Date.now();
        log.error(`[${record.name}] ${message}`);
      },
    });

    this.#sessions.set(id, record);
    // 세션이 뜨기 전에 먼저 잡습니다 — start() 가 오래 걸리는 사이에 잠들면 안 됩니다.
    this.#syncAwake();

    try {
      await record.driver.start({
        cwd: input.project,
        name,
        firstPrompt: input.firstPrompt,
        ...(input.resume ? { resume: input.resume } : {}),
      });
    } catch (error) {
      record.status = 'error';
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = Date.now();
      this.#syncAwake();
    }

    return this.detail(id)!;
  }

  async prompt(id: string, text: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session) return false;
    await session.driver.sendPrompt(text);
    session.updatedAt = Date.now();
    return true;
  }

  /**
   * 워치에서 온 승인/거부.
   * approvalId 를 받으면 그것과 일치할 때만 처리합니다 — 워치가 본 화면과
   * 지금 대기 중인 요청이 다를 수 있고, 그때 엉뚱한 명령을 승인하면 안 됩니다.
   */
  decide(
    id: string,
    decision: 'allow' | 'deny',
    approvalId?: string,
    always?: boolean,
  ): 'ok' | 'no-session' | 'stale' {
    // 맥에서 따로 돌고 있는 세션은 훅이 기다리고 있습니다. 그쪽으로 넘깁니다.
    if (id.startsWith('ext:')) return decideExternal(id, decision, approvalId, always);

    const session = this.#sessions.get(id);
    if (!session) return 'no-session';
    const pending = session.pending;
    if (!pending) return 'stale';
    if (approvalId && approvalId !== pending.id) return 'stale';

    const handled = session.driver.resolveApproval(pending.id, decision);
    if (!handled) return 'stale';

    if (always && decision === 'allow' && !pending.risky) {
      rememberAllowed(pending.command, session.name);
    }

    session.pending = null;
    session.status = 'running';
    session.updatedAt = Date.now();
    log.info(`[${session.name}] ${decision === 'allow' ? '승인' : '거부'}: ${pending.command}`);
    return 'ok';
  }

  async stop(id: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session) return false;
    await session.driver.stop();
    session.updatedAt = Date.now();
    this.#syncAwake();
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map((id) => this.stop(id)));
    this.#syncAwake();
  }

  /** 살아 있는 세션이 하나라도 있으면 맥을 깨워 둡니다. 상태가 바뀔 때마다 부릅니다. */
  #syncAwake(): void {
    let live = 0;
    for (const session of this.#sessions.values()) {
      if (isLiveStatus(session.status)) live += 1;
    }
    sleepGuard.sync(live);
  }

  #toSummary(session: SessionRecord): SessionSummary {
    return {
      id: session.id,
      name: session.name,
      project: session.project,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      pending: session.pending,
    };
  }
}

export const sessions = new SessionManager();
