import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';

import { config } from './config.js';
import { log } from './log.js';

/**
 * 맥이 잠들면 세션도 끊기고, 워치가 브리지에 닿지도 못합니다.
 * 그래서 살아 있는 세션이 있는 동안만 macOS 의 `caffeinate` 를 물려 둡니다.
 *
 * 플래그:
 *   -i  유휴 잠자기 방지
 *   -m  디스크 잠자기 방지 (세션이 파일을 만지는 중일 수 있습니다)
 *   -s  시스템 잠자기 방지 — **전원이 연결돼 있을 때만** 듣습니다
 *   -w  이 pid 가 죽으면 caffeinate 도 같이 죽습니다
 *
 * -d(화면 켜 두기)는 일부러 뺐습니다. 워치로 조종하는데 맥 화면이 켜져 있을 이유가 없습니다.
 *
 * 한계: 배터리로 돌면서 뚜껑을 닫으면 macOS 는 어떤 방법으로도 못 막습니다.
 * LTE 로 나가 있는 동안 세션을 살려 두려면 맥을 전원에 꽂고 뚜껑을 열어 두세요.
 */
const FLAGS = ['-i', '-m', '-s', '-w'];

/** 이 상태들은 "아직 살아 있는 세션" 입니다 — idle 도 다음 지시를 기다리는 중이라 포함합니다. */
const LIVE = new Set(['starting', 'running', 'waiting_approval', 'idle']);

export function isLiveStatus(status: string): boolean {
  return LIVE.has(status);
}

class SleepGuard {
  #child: ChildProcess | null = null;
  #warned = false;

  get active(): boolean {
    return this.#child !== null;
  }

  /** 살아 있는 세션 수를 받아 켜고 끕니다. 같은 상태면 아무 일도 하지 않습니다. */
  sync(liveCount: number): void {
    if (config.keepAwake === 'off') return;
    if (config.keepAwake === 'always') return; // 시작할 때 이미 잡아 뒀습니다.
    if (liveCount > 0) this.acquire(`세션 ${liveCount}개 실행 중`);
    else this.release();
  }

  acquire(reason: string): void {
    if (config.keepAwake === 'off' || this.#child) return;

    if (platform() !== 'darwin') {
      if (!this.#warned) {
        this.#warned = true;
        log.warn('caffeinate 는 macOS 전용입니다 — 잠자기 방지를 건너뜁니다.');
      }
      return;
    }

    const child = spawn('caffeinate', [...FLAGS, String(process.pid)], { stdio: 'ignore' });

    child.on('error', (error) => {
      if (this.#child === child) this.#child = null;
      log.warn(`caffeinate 를 띄우지 못했습니다 — 맥이 잠들 수 있습니다: ${error.message}`);
    });
    child.on('exit', () => {
      if (this.#child === child) this.#child = null;
    });

    // 브리지가 내려갈 때 이 자식 때문에 붙잡히지 않게 합니다.
    child.unref();
    this.#child = child;
    log.info(`잠자기 방지 켬 — ${reason}`);
  }

  release(): void {
    const child = this.#child;
    if (!child) return;
    this.#child = null;
    child.kill('SIGTERM');
    log.info('잠자기 방지 끔 — 살아 있는 세션이 없습니다.');
  }
}

export const sleepGuard = new SleepGuard();
