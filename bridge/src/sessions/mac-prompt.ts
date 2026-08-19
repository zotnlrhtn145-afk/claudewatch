import { spawn, type ChildProcess } from 'node:child_process';

import { config } from '../config.js';
import { log } from '../log.js';

/**
 * 맥 화면에도 승인 창을 띄웁니다.
 *
 * 훅이 명령을 가로채면 클로드코드의 원래 승인 절차가 열리지 않습니다.
 * 그래서 터미널에도 핸드폰에도 아무것도 안 뜹니다 — 워치만 유일한 창구가 됩니다.
 * 맥 앞에 앉아 있을 때도 손목을 봐야 하는 건 불편합니다.
 *
 * 그래서 워치에 물어보는 **동시에** 맥에도 창을 띄우고, 먼저 답한 쪽을 따릅니다.
 * 다른 쪽 창은 곧바로 닫습니다.
 */

/** AppleScript 문자열 안에 안전하게 넣습니다. 명령어에는 따옴표·역슬래시가 흔합니다. */
function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export interface MacPrompt {
  /** 사용자가 누른 결과. 아무도 안 누르면 영원히 대기합니다(호출 쪽에서 취소). */
  answer: Promise<'allow' | 'deny'>;
  /** 워치가 먼저 답했을 때 창을 닫습니다. */
  cancel(): void;
}

export function askMac(input: {
  sessionName: string;
  command: string;
  risky: boolean;
  timeoutSeconds: number;
}): MacPrompt | null {
  if (!config.macPrompt) return null;

  const title = input.risky ? '⚠︎ 되돌리기 어려운 명령' : '승인 요청';
  const body = [
    `${input.sessionName} 에서 실행하려 합니다.`,
    '',
    input.command.length > 400 ? `${input.command.slice(0, 399)}…` : input.command,
  ].join('\n');

  // 기본 버튼은 두지 않습니다. Enter 를 무심코 눌러 승인되면 안 됩니다.
  const script = [
    `display dialog "${escape(body)}"`,
    ` buttons {"거부","승인"}`,
    ` with title "${escape(title)}"`,
    input.risky ? ' with icon caution' : '',
    ` giving up after ${Math.max(5, Math.round(input.timeoutSeconds))}`,
  ].join('');

  let child: ChildProcess | null = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });

  const answer = new Promise<'allow' | 'deny'>((resolve) => {
    let out = '';
    child?.stdout?.on('data', (chunk) => {
      out += String(chunk);
    });
    child?.on('error', (error) => {
      log.warn(`맥 승인 창을 띄우지 못했습니다: ${error.message}`);
    });
    child?.on('exit', () => {
      child = null;
      // 시간이 지나 저절로 닫힌 경우(gave up:true)는 아무도 안 누른 것입니다.
      if (/gave up:\s*true/.test(out)) return;
      if (/button returned:\s*승인/.test(out)) resolve('allow');
      else if (/button returned:\s*거부/.test(out)) resolve('deny');
    });
  });

  return {
    answer,
    cancel() {
      if (!child) return;
      child.kill('SIGTERM');
      child = null;
    },
  };
}
