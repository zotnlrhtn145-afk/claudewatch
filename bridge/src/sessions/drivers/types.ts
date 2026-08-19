import type { LogEntry, PendingApproval, SessionStatus } from '../types.js';

/**
 * 드라이버가 세션 매니저에게 알리는 통로.
 * 드라이버는 매니저를 몰라도 되고, 매니저는 드라이버 내부를 몰라도 됩니다.
 */
export interface DriverHooks {
  onStatus(status: SessionStatus): void;
  onLog(entry: Omit<LogEntry, 't'>): void;
  /** 승인이 필요해졌을 때. 결정은 resolveApproval() 로 되돌려 줍니다. */
  onApproval(pending: PendingApproval): void;
  /** 승인이 처리됐을 때(워치 응답 또는 타임아웃/중단). */
  onApprovalResolved(id: string): void;
  onClaudeSessionId(id: string): void;
  onError(message: string): void;
}

export interface DriverStartOptions {
  cwd: string;
  /** 세션 표시 이름 — 공식 앱 목록에도 이 이름으로 보입니다. */
  name: string;
  firstPrompt: string;
  /**
   * 이어받을 대화의 세션 ID.
   *
   * ⚠️ 진행 중인 세션에 함부로 쓰지 마세요. 대화를 통째로 물려받으면 새 에이전트가
   * "나는 이 작업을 하던 중"이라고 판단해 **이전 명령들을 다시 실행합니다.**
   * 실제로 세션 생성 명령이 재실행되어 무한히 번진 적이 있습니다.
   * 맥락이 필요하면 첫 지시에 참고 자료로 붙이세요 (api/routes.ts 의 ext: 경로 참고).
   */
  resume?: string;
}

/**
 * 클로드코드 세션 하나를 실행하는 방법.
 *
 * 원격제어 기능은 연구 미리보기라 동작이 바뀔 수 있어서, 실행부를 여기로 몰아 뒀습니다.
 * 새 방식이 생기면 이 인터페이스만 맞춰 파일 하나 추가하면 됩니다.
 */
export interface SessionDriver {
  readonly kind: string;
  start(options: DriverStartOptions): Promise<void>;
  /** 추가 지시 전송 (워치 음성 지시). */
  sendPrompt(text: string): Promise<void>;
  /** 워치에서 온 승인/거부를 세션에 전달. 처리했으면 true. */
  resolveApproval(id: string, decision: 'allow' | 'deny'): boolean;
  stop(): Promise<void>;
}
