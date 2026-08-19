/**
 * 도구 호출을 워치 화면 한 줄로 줄이는 규칙.
 * 워치는 화면이 작아서, 승인 화면에 보일 문자열은 여기서 전부 결정합니다.
 */

/** 되돌리기 어려운 명령. 승인 화면에서 빨갛게 강조합니다. */
const RISKY_BASH = [
  /\brm\s+\S/, // rm 은 플래그가 없어도 되돌릴 수 없습니다
  /\bmv\s+\S+\s+\S/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\b/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bvercel\s+(deploy|--prod)\b/,
  /\beas\s+(build|submit)\b/,
  /\bnpm\s+publish\b/,
  /\bkill(all)?\b/,
  /\bshutdown\b|\breboot\b/,
  /\bcurl\b[^|]*\|\s*(ba)?sh/, // curl … | sh
  /\bsudo\b/,
];

const RISKY_TOOLS = new Set(['Bash', 'Write', 'Edit', 'NotebookEdit']);

function firstString(input: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function shorten(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** 홈 경로를 ~ 로 줄여 워치 폭에 맞춥니다. */
export function tilde(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** 승인 화면에 코드로 보여 줄 한 줄. */
export function describeToolCall(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      const cmd = firstString(input, 'command');
      return cmd ? shorten(cmd, 160) : 'bash';
    }
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const path = firstString(input, 'file_path', 'notebook_path');
      const verb = toolName === 'Write' ? '새로 씀' : '수정';
      return path ? `${shorten(path, 70)} ${verb}` : toolName;
    }
    case 'Read': {
      const path = firstString(input, 'file_path');
      return path ? `${shorten(path, 80)} 읽기` : 'Read';
    }
    case 'WebFetch': {
      const url = firstString(input, 'url');
      return url ? `${shorten(url, 90)} 가져오기` : 'WebFetch';
    }
    default: {
      const hint = firstString(input, 'command', 'file_path', 'url', 'query', 'pattern', 'prompt');
      return hint ? `${toolName}: ${shorten(hint, 120)}` : toolName;
    }
  }
}

export function isRisky(toolName: string, input: Record<string, unknown>): boolean {
  if (!RISKY_TOOLS.has(toolName)) return false;
  if (toolName !== 'Bash') return false; // 파일 수정 자체는 위험 표시까지는 아님
  const cmd = firstString(input, 'command') ?? '';
  return RISKY_BASH.some((re) => re.test(cmd));
}
