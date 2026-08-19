import { query } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionResult, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { log } from '../../log.js';
import { describeToolCall, isRisky } from '../describe.js';
import type { DriverHooks, DriverStartOptions, SessionDriver } from './types.js';

/**
 * 세션에 계속 지시를 밀어 넣을 수 있는 큐.
 * query() 에 스트리밍 입력을 주면 한 번 물어보고 끝나는 게 아니라 대화가 이어집니다.
 */
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  #buffer: SDKUserMessage[] = [];
  #waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  #closed = false;

  push(text: string): void {
    if (this.#closed) return;
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    };
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.#buffer.push(message);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        const buffered = this.#buffer.shift();
        if (buffered) return Promise.resolve({ value: buffered, done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.#waiters.push(resolve);
        });
      },
    };
  }
}

/**
 * 기본 드라이버. Agent SDK 의 canUseTool 콜백으로 승인 요청을 받으므로
 * 터미널 화면을 긁어 파싱할 필요가 없습니다 — 여기가 이 방식의 핵심 장점입니다.
 *
 * 대신 공식 앱에는 이 세션이 뜨지 않습니다. 그게 필요하면 remote-control 드라이버를 쓰세요.
 */
export class SdkDriver implements SessionDriver {
  readonly kind = 'sdk';

  readonly #hooks: DriverHooks;
  readonly #queue = new PromptQueue();
  readonly #abort = new AbortController();
  readonly #pending = new Map<string, (decision: 'allow' | 'deny') => void>();
  #query: Query | null = null;
  #stopped = false;

  constructor(hooks: DriverHooks) {
    this.#hooks = hooks;
  }

  async start(options: DriverStartOptions): Promise<void> {
    this.#hooks.onStatus('starting');
    this.#hooks.onLog({ kind: 'user', text: options.firstPrompt });
    this.#queue.push(options.firstPrompt);

    const running = query({
      prompt: this.#queue,
      options: {
        cwd: options.cwd,
        ...(options.resume ? { resume: options.resume } : {}),
        // 'default' 여야 승인 요청이 canUseTool 로 넘어옵니다.
        // bypassPermissions 로 두면 워치가 승인할 기회 자체가 없어집니다.
        permissionMode: 'default',
        abortController: this.#abort,
        canUseTool: (toolName, input, opts) => this.#askWatch(toolName, input, opts),
        stderr: (data) => log.warn(`[${options.name}]`, data.trimEnd()),
      },
    });

    this.#query = running;
    void this.#pump(running);
  }

  async sendPrompt(text: string): Promise<void> {
    if (this.#stopped) throw new Error('이미 끝난 세션입니다.');
    this.#hooks.onLog({ kind: 'user', text });
    this.#hooks.onStatus('running');
    this.#queue.push(text);
  }

  resolveApproval(id: string, decision: 'allow' | 'deny'): boolean {
    const resolve = this.#pending.get(id);
    if (!resolve) return false;
    this.#pending.delete(id);
    resolve(decision);
    return true;
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    // 대기 중인 승인은 전부 거부로 닫습니다 — 열어 두고 죽으면 도구가 영원히 멈춥니다.
    for (const [id, resolve] of this.#pending) {
      resolve('deny');
      this.#hooks.onApprovalResolved(id);
    }
    this.#pending.clear();
    this.#queue.close();
    try {
      this.#query?.close();
    } catch {
      // 이미 닫힌 경우
    }
    this.#abort.abort();
    this.#hooks.onStatus('done');
  }

  /** 승인 요청을 워치로 넘기고, 워치가 답할 때까지 기다립니다. */
  async #askWatch(
    toolName: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal; toolUseID: string; title?: string },
  ): Promise<PermissionResult> {
    const id = opts.toolUseID;
    this.#hooks.onApproval({
      id,
      toolName,
      command: describeToolCall(toolName, input),
      ...(opts.title ? { title: opts.title } : {}),
      risky: isRisky(toolName, input),
      requestedAt: Date.now(),
    });
    this.#hooks.onStatus('waiting_approval');

    const decision = await new Promise<'allow' | 'deny'>((resolve) => {
      this.#pending.set(id, resolve);
      // 세션이 중단되면 거부로 닫습니다. 응답을 안 보내면 도구가 무기한 멈춥니다.
      opts.signal.addEventListener(
        'abort',
        () => {
          if (this.#pending.delete(id)) resolve('deny');
        },
        { once: true },
      );
    });

    this.#hooks.onApprovalResolved(id);
    if (!this.#stopped) this.#hooks.onStatus('running');

    return decision === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: '워치에서 거부했습니다.' };
  }

  async #pump(running: Query): Promise<void> {
    try {
      for await (const message of running) {
        this.#handle(message);
      }
      if (!this.#stopped) this.#hooks.onStatus('done');
    } catch (error) {
      if (this.#stopped) return;
      this.#hooks.onError(error instanceof Error ? error.message : String(error));
      this.#hooks.onStatus('error');
    }
  }

  #handle(message: SDKMessage): void {
    switch (message.type) {
      case 'system': {
        if (message.subtype === 'init') {
          this.#hooks.onClaudeSessionId(message.session_id);
          this.#hooks.onStatus('running');
        }
        return;
      }
      case 'assistant': {
        const content = message.message.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type === 'text' && block.text.trim()) {
            this.#hooks.onLog({ kind: 'assistant', text: block.text.trim() });
          } else if (block.type === 'tool_use') {
            const input = (block.input ?? {}) as Record<string, unknown>;
            this.#hooks.onLog({ kind: 'tool', text: describeToolCall(block.name, input) });
          }
        }
        return;
      }
      case 'result': {
        if (message.subtype === 'success') {
          this.#hooks.onLog({ kind: 'result', text: message.result });
          this.#hooks.onStatus('idle');
        } else {
          this.#hooks.onError(`세션이 오류로 끝났습니다 (${message.subtype}).`);
          this.#hooks.onStatus('error');
        }
        return;
      }
      default:
        return;
    }
  }
}
