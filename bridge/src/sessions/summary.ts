import type { LogEntry, SessionStatus } from './types.js';

/**
 * 워치 화면(가로 약 30자)에 들어갈 3~4줄 요약.
 * 로그 전문은 /log 로 따로 볼 수 있으니, 여기서는 "그래서 어떻게 됐나"만 남깁니다.
 */

const MAX_LINES = 4;
const MAX_CHARS = 90;

const SIGNALS: Array<{ re: RegExp; line: (m: RegExpMatchArray) => string }> = [
  { re: /(\d+)\s+(?:tests?|테스트)[^.\n]*(?:passed|통과)/i, line: (m) => `테스트 ${m[1]}개 통과` },
  { re: /(\d+)\s+(?:tests?|테스트)[^.\n]*(?:failed|실패)/i, line: (m) => `⚠︎ 테스트 ${m[1]}개 실패` },
  { re: /\b(build (?:succeeded|successful)|빌드 성공)\b/i, line: () => '빌드 성공' },
  { re: /\b(build failed|빌드 실패)\b/i, line: () => '⚠︎ 빌드 실패' },
  { re: /\b(deployed|배포 완료|deployment complete)\b/i, line: () => '배포 완료' },
];

function clamp(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_CHARS ? `${oneLine.slice(0, MAX_CHARS - 1)}…` : oneLine;
}

/** 마크다운 장식을 걷어냅니다 — 워치에서는 별표가 그냥 노이즈입니다. */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^[-*]\s+/gm, '');
}

/** 마지막 결론 문장 1~2개. */
function headline(entries: LogEntry[]): string | null {
  const last =
    [...entries].reverse().find((e) => e.kind === 'result' && e.text.trim()) ??
    [...entries].reverse().find((e) => e.kind === 'assistant' && e.text.trim());
  if (!last) return null;

  const sentences = plain(last.text)
    .split(/(?<=[.!?。？!])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;
  return clamp(sentences.slice(0, 2).join(' '));
}

export function buildSummary(entries: LogEntry[], status: SessionStatus): string[] {
  const lines: string[] = [];

  const head = headline(entries);
  if (head) lines.push(head);

  const tools = entries.filter((e) => e.kind === 'tool');
  const edited = new Set(
    tools
      .filter((e) => /\s(수정|새로 씀)$/.test(e.text))
      .map((e) => e.text.replace(/\s(수정|새로 씀)$/, '')),
  );
  const commands = tools.filter((e) => !/\s(수정|새로 씀|읽기|가져오기)$/.test(e.text)).length;

  const stats: string[] = [];
  if (edited.size > 0) stats.push(`파일 ${edited.size}개 수정`);
  if (commands > 0) stats.push(`명령 ${commands}번`);
  if (stats.length > 0) lines.push(stats.join(' · '));

  const haystack = entries
    .slice(-40)
    .map((e) => e.text)
    .join('\n');
  for (const signal of SIGNALS) {
    const match = haystack.match(signal.re);
    if (match) {
      const line = signal.line(match);
      if (!lines.includes(line)) lines.push(line);
      break;
    }
  }

  if (status === 'error') lines.unshift('⚠︎ 오류로 멈췄습니다');
  if (lines.length === 0) lines.push(status === 'starting' ? '세션을 띄우는 중입니다' : '아직 결과가 없습니다');

  return lines.slice(0, MAX_LINES);
}
