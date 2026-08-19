import { randomUUID } from 'node:crypto';

import { log } from '../../log.js';
import { isRisky } from '../risky.js';
import type { DriverHooks, DriverStartOptions, SessionDriver } from './types.js';

/**
 * `claude --remote-control` 을 pty 로 띄우는 드라이버.
 *
 * 장점: 세션이 Anthropic 쪽에 등록돼서 **공식 앱과 데스크톱 터미널에도 같은 세션이 보입니다.**
 * 단점: 승인 요청을 터미널 화면에서 알아봐야 해서 취약합니다.
 *
 * 아래 상수들은 2026-08-17 에 클로드코드 2.1.233 실제 화면을 떠서 맞춘 값입니다.
 * 화면이 바뀌면 이 상수들만 고치면 됩니다. 확인한 실제 승인 화면:
 *
 *   ⏺ Write(hello.txt)
 *     Create file hello.txt
 *     1  hello
 *   Do you want to create hello.txt?
 *   ❯ 1. Yes
 *     2. Yes, allow all edits during this session (shift+tab)
 *     3. No
 *   Esc to cancel · Tab to amend
 */

/** 승인 확인 문구. 실제 문장은 "Do you want to create hello.txt?" 였습니다. */
const APPROVAL_PROMPT = /Do you want (to|Claude to)|하시겠습니까|실행할까요/i;
/** 선택지가 떠 있는지. 확인 문구만으로는 오탐이 납니다. */
const APPROVAL_OPTIONS = /(^|\s)(❯\s*)?1\.\s*(Yes|예)/im;
/** 승인 화면이 닫혔다는 신호. */
const PROMPT_CLEARED = /esc to interrupt|\?\s*for shortcuts|mode on/i;

/** 시작할 때 한 번 뜨는 대화상자들. 이걸 안 넘기면 첫 지시가 대화상자에 먹힙니다. */
const STARTUP_DIALOGS: { name: string; match: RegExp; keys: string }[] = [
  // "Quick safety check: Is this a project you created or one you trust?"
  { name: '폴더 신뢰', match: /trust this folder/i, keys: '1\r' },
  // "Claude in Chrome extension detected" — 워치에서 브라우저를 볼 수 없으니 끕니다.
  { name: 'Chrome 확장', match: /use my browser/i, keys: '2\r' },
];

/** TUI 가 올라와 입력을 받을 준비가 됐다는 신호. */
const TUI_READY = /\?\s*for shortcuts|manual mode on|esc to interrupt/i;

/** 공식 앱에서 같은 세션을 찾을 때 쓰는 ID. 화면에 URL 로 찍힙니다. */
const SESSION_URL = /claude\.ai\/code\/(session_[A-Za-z0-9]+)/;

/** `⏺ Write(hello.txt)` 처럼 찍히는 도구 호출 줄. */
const TOOL_CALL = /⏺\s*([A-Z][A-Za-z]*)\(([^)]*)\)/;


/**
 * 클로드코드 TUI 는 공백 대신 커서 이동(ESC[nG)으로 단어를 배치합니다.
 * 그래서 커서 이동을 공백으로 바꾼 뒤에 ANSI 를 걷어야 합니다.
 * 이걸 빠뜨리면 "Do you want to" 가 "Doyouwantto" 가 되어 절대 매칭되지 않습니다.
 */
const CURSOR_MOVE = /\x1b\[[0-9]*[GC]/g;
const ANSI = /[\x1b\x9b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]/g;

function toView(text: string): string {
  return text.replace(CURSOR_MOVE, ' ').replace(ANSI, '');
}

/**
 * 박스 그림 문자와 여백을 걷어내고 알맹이 줄만 남깁니다.
 * TUI 는 화면을 제자리에서 다시 그리느라 `\n` 을 거의 쓰지 않습니다 — `\r` 로도 끊어야 합니다.
 */
function cleanLines(text: string): string[] {
  return text
    .split(/[\r\n]+/)
    .map((line) =>
      line
        // 창 제목 설정(OSC)과 벨 문자가 알맹이에 섞여 들어옵니다.
        .replace(/\x07/g, ' ')
        .replace(/[│┃║╭╮╰╯─━═┌┐└┘╌]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * 확인 문구 한 문장만 뽑습니다.
 * 줄 단위로 찾으면 안 됩니다 — TUI 가 화면 전체를 한 줄로 뭉쳐 놓기 때문에
 * 그렇게 하면 워치에 시작 배너까지 통째로 실려 갑니다.
 */
const QUESTION = /(Do you want (?:to|Claude to)[^?]{0,160}\?)|([^.?\r\n]{0,90}(?:하시겠습니까|실행할까요)\??)/gi;

function extractQuestion(text: string): string | undefined {
  const found = [...text.matchAll(QUESTION)];
  const last = found.at(-1)?.[0];
  return last?.replace(/\s+/g, ' ').trim() || undefined;
}

interface Pty {
  write(data: string): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
}

export class RemoteControlDriver implements SessionDriver {
  readonly kind = 'remote-control';

  readonly #hooks: DriverHooks;
  #pty: Pty | null = null;
  #buffer = '';
  #pendingId: string | null = null;
  #stopped = false;
  #ready = false;
  #firstPrompt = '';
  #handledDialogs = new Set<string>();
  #sawSessionId = false;
  #readyTimer: NodeJS.Timeout | null = null;

  constructor(hooks: DriverHooks) {
    this.#hooks = hooks;
  }

  async start(options: DriverStartOptions): Promise<void> {
    this.#hooks.onStatus('starting');
    this.#firstPrompt = options.firstPrompt;

    let spawn: (file: string, args: string[], opts: Record<string, unknown>) => Pty;
    try {
      // 선택적 의존성이라 정적으로 import 하지 않습니다. 안 깔려 있어도 sdk 드라이버는 돌아야 합니다.
      const moduleName = 'node-pty';
      const pty = (await import(moduleName)) as { spawn: typeof spawn };
      spawn = pty.spawn;
    } catch {
      throw new Error(
        'remote-control 드라이버는 node-pty 가 필요합니다. `cd bridge && npm i node-pty` 로 설치하거나 BRIDGE_DRIVER=sdk 를 쓰세요.',
      );
    }

    const child = spawn(
      'claude',
      [
        '--remote-control',
        options.name,
        // 이게 없으면 세션이 auto 모드로 떠서 승인 요청이 **아예 뜨지 않습니다**.
        // 그러면 워치가 승인할 것도 없이 명령이 그냥 실행됩니다. 이 프로젝트의 존재 이유가 사라집니다.
        '--permission-mode',
        'manual',
      ],
      {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: options.cwd,
        env: { ...this.#childEnv(), TERM: 'xterm-256color' },
      },
    );

    child.onData((data) => this.#onData(data));
    child.onExit(({ exitCode }) => {
      if (this.#readyTimer) clearTimeout(this.#readyTimer);
      if (this.#stopped) return;
      if (exitCode === 0) this.#hooks.onStatus('done');
      else {
        this.#hooks.onError(`클로드코드가 코드 ${exitCode} 로 종료됐습니다.`);
        this.#hooks.onStatus('error');
      }
    });

    this.#pty = child;
    this.#hooks.onStatus('running');

    // TUI 가 준비되면 #onData 에서 첫 지시를 넣습니다.
    // 신호를 못 잡는 경우를 대비해 마지막 방어선만 둡니다.
    this.#readyTimer = setTimeout(() => {
      if (!this.#ready) {
        log.warn('TUI 준비 신호를 못 봤습니다 — 그냥 첫 지시를 넣습니다.');
        this.#sendFirstPrompt();
      }
    }, 25_000);
  }

  /**
   * 부모 프로세스의 CLAUDE_* 표시를 걷어냅니다.
   * 이게 새어 들어가면 자식 세션으로 취급돼서 기록이 저장되지 않고,
   * 권한 모드도 부모 것을 물려받습니다.
   */
  #childEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (/^CLAUDE/.test(key)) continue;
      out[key] = value;
    }
    return out;
  }

  async sendPrompt(text: string): Promise<void> {
    if (!this.#pty || this.#stopped) throw new Error('이미 끝난 세션입니다.');
    this.#hooks.onLog({ kind: 'user', text });
    this.#hooks.onStatus('running');
    this.#pty.write(`${text}\r`);
  }

  resolveApproval(id: string, decision: 'allow' | 'deny'): boolean {
    if (!this.#pty || this.#pendingId !== id) return false;
    // 실기동으로 확인한 값입니다.
    //   승인: '1' 만. 숫자를 누르면 그 자리에서 확정되므로 Enter 를 붙이면 빈 입력이 한 번 더 들어갑니다.
    //   거부: Esc. 화면에도 "Esc to cancel" 로 적혀 있습니다.
    // '2. Yes, allow all edits during this session' 은 절대 쓰지 않습니다 —
    // 그걸 누르면 이후 승인이 워치를 거치지 않고 통과합니다.
    this.#pty.write(decision === 'allow' ? '1' : '\x1b');
    this.#pendingId = null;
    this.#hooks.onApprovalResolved(id);
    this.#hooks.onStatus('running');
    return true;
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#readyTimer) clearTimeout(this.#readyTimer);
    if (this.#pendingId) {
      this.#pty?.write('\x1b');
      this.#hooks.onApprovalResolved(this.#pendingId);
      this.#pendingId = null;
    }
    this.#pty?.write('\x03'); // Ctrl-C
    setTimeout(() => this.#pty?.kill(), 500);
    this.#hooks.onStatus('done');
  }

  #sendFirstPrompt(): void {
    if (this.#ready || !this.#pty) return;
    this.#ready = true;
    if (this.#readyTimer) clearTimeout(this.#readyTimer);
    this.#hooks.onLog({ kind: 'user', text: this.#firstPrompt });
    this.#pty.write(`${this.#firstPrompt}\r`);
  }

  #onData(chunk: string): void {
    this.#buffer = (this.#buffer + chunk).slice(-16_000);
    const view = toView(this.#buffer);
    const tail = view.slice(-3000);

    // 공식 앱에서 이 세션을 찾을 ID. 화면에 URL 로 한 번 찍힙니다.
    if (!this.#sawSessionId) {
      const found = SESSION_URL.exec(view)?.[1];
      if (found) {
        this.#sawSessionId = true;
        this.#hooks.onClaudeSessionId(found);
      }
    }

    // ── 시작 대화상자 넘기기 ──
    // 이걸 안 하면 첫 지시가 대화상자의 선택 입력으로 먹혀 버립니다.
    for (const dialog of STARTUP_DIALOGS) {
      if (this.#handledDialogs.has(dialog.name) || !dialog.match.test(tail)) continue;
      this.#handledDialogs.add(dialog.name);
      log.info(`시작 대화상자 넘김: ${dialog.name}`);
      const keys = dialog.keys;
      setTimeout(() => this.#pty?.write(keys), 300);
      return;
    }

    // ── TUI 가 준비되면 첫 지시 ──
    if (!this.#ready) {
      if (TUI_READY.test(tail)) {
        setTimeout(() => this.#sendFirstPrompt(), 600);
      }
      return;
    }

    // ── 승인 화면 ──
    if (this.#pendingId) {
      if (PROMPT_CLEARED.test(tail) && !APPROVAL_OPTIONS.test(tail)) {
        // 사람이 터미널이나 공식 앱에서 직접 처리한 경우 — 워치의 대기 상태를 풀어 줍니다.
        this.#hooks.onApprovalResolved(this.#pendingId);
        this.#pendingId = null;
        this.#hooks.onStatus('running');
      }
      return;
    }

    if (!APPROVAL_PROMPT.test(tail) || !APPROVAL_OPTIONS.test(tail)) return;

    const id = randomUUID();
    const { command, title } = this.#describeApproval(tail);
    this.#pendingId = id;
    this.#hooks.onApproval({
      id,
      toolName: TOOL_CALL.exec(tail)?.[1] ?? 'unknown',
      command,
      title,
      risky: isRisky(command) || isRisky(tail),
      requestedAt: Date.now(),
    });
    this.#hooks.onStatus('waiting_approval');
    log.warn('remote-control 드라이버가 화면에서 승인 요청을 찾았습니다 (취약한 경로입니다).');
  }

  /**
   * 워치에 보여 줄 명령어와 한 줄 설명을 골라냅니다.
   * 위험한 명령은 원문이 반드시 보여야 하므로 도구 호출 줄을 우선합니다.
   */
  #describeApproval(tail: string): { command: string; title?: string } {
    const lines = cleanLines(tail);

    // "Do you want to create hello.txt?" 같은 확인 문구 → 워치의 한 줄 설명.
    const title = extractQuestion(tail);

    // "⏺ Write(hello.txt)" 같은 도구 호출 줄 → 워치에 코드로 보여 줄 원문.
    const toolLine = [...lines].reverse().find((line) => TOOL_CALL.test(line));
    const tool = toolLine ? TOOL_CALL.exec(toolLine) : null;
    let command = tool ? (tool[2] ? `${tool[1]}(${tool[2]})` : tool[1]) : '';

    if (!command) {
      // 도구 줄을 못 찾으면 확인 문구 위쪽 줄들로 대신합니다.
      const askIndex = lines.findIndex((line) => APPROVAL_PROMPT.test(line));
      command = (askIndex === -1 ? lines : lines.slice(0, askIndex))
        .filter((line) => !/^(❯\s*)?[0-9]\.\s/.test(line))
        .slice(-2)
        .join(' ')
        .trim();
    }

    if (command.length > 200) command = `${command.slice(0, 199)}…`;
    return { command: command || '명령어를 읽지 못했습니다', title };
  }
}
