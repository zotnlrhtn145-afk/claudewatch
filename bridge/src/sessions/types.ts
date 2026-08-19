/** 워치 화면의 상태 점 색과 1:1로 대응합니다. */
export type SessionStatus =
  | 'starting' // 회색 — 세션 뜨는 중
  | 'running' // 파랑 — 실행 중
  | 'waiting_approval' // 주황 — 승인 대기
  | 'idle' // 초록 — 한 턴 끝, 다음 지시 대기
  | 'done' // 초록 — 세션 종료
  | 'error'; // 빨강

export type LogKind = 'user' | 'assistant' | 'tool' | 'result' | 'system';

export interface LogEntry {
  t: number;
  kind: LogKind;
  text: string;
}

/** 승인 대기 중인 도구 실행 하나. */
export interface PendingApproval {
  id: string;
  toolName: string;
  /** 워치에 코드로 보여 줄 한 줄. 예: `rm -rf build/` 또는 `src/index.ts 수정` */
  command: string;
  /** 브리지가 만들어 준 사람이 읽는 문장. 없으면 워치가 command 를 씁니다. */
  title?: string;
  /** 삭제·배포처럼 되돌리기 어려운 명령이면 true — 워치에서 빨갛게 강조합니다. */
  risky: boolean;
  requestedAt: number;
}

export interface SessionSummary {
  id: string;
  name: string;
  project: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  /** 워치 목록에서 바로 승인할 수 있게 목록 응답에도 실어 보냅니다. */
  pending: PendingApproval | null;
  /**
   * 브리지가 띄운 게 아니라 맥에서 따로 돌고 있는 세션.
   * 볼 수만 있고 승인·지시는 할 수 없습니다 — 워치가 버튼을 감추는 근거입니다.
   */
  external?: boolean;
  /** 공식 앱·웹에서 같은 세션을 가리키는 ID. 외부 세션에도 붙습니다. */
  claudeSessionId?: string | null;
}

export interface SessionDetail extends SessionSummary {
  /** 워치용 3~4줄 요약. */
  summary: string[];
  logCount: number;
  error: string | null;
  /** 클로드코드가 붙인 세션 ID — 공식 앱/데스크톱에서 같은 세션을 찾을 때 씁니다. */
  claudeSessionId: string | null;
  driver: string;
}
