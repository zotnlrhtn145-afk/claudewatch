import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { log } from '../log.js';
import type { LogEntry, LogKind } from './types.js';

/**
 * 맥에서 따로 돌고 있는 세션의 대화 내용 읽기.
 *
 * 클로드코드가 `~/.claude/projects/<폴더>/<세션ID>.jsonl` 에 대화를 남깁니다.
 * 브리지가 조종할 수는 없어도 **무슨 이야기가 오갔는지는 보여 줄 수 있습니다.**
 *
 * 이 파일은 수십 MB까지 자랍니다(실제로 49MB짜리를 봤습니다).
 * 통째로 읽으면 워치가 목록 한 번 새로 고칠 때마다 맥이 멈춥니다.
 * 그래서 **끝부분만 잘라 읽습니다.**
 */

const PROJECTS_DIR = resolve(homedir(), '.claude/projects');
/** 끝에서 이만큼만 읽습니다. 워치는 최근 것만 보면 됩니다. */
const TAIL_BYTES = 256 * 1024;

interface RawEntry {
  type?: string;
  timestamp?: string;
  message?: { content?: unknown };
}

/** 세션 ID 로 기록 파일을 찾습니다. 프로젝트 폴더 이름은 경로를 인코딩한 거라 직접 훑습니다. */
function findTranscript(sessionId: string): string | null {
  if (!existsSync(PROJECTS_DIR)) return null;
  try {
    for (const dir of readdirSync(PROJECTS_DIR)) {
      const candidate = resolve(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      if (existsSync(candidate)) return candidate;
    }
  } catch (error) {
    log.warn(`대화 기록을 찾지 못했습니다: ${String(error)}`);
  }
  return null;
}

/** 파일 끝에서 TAIL_BYTES 만큼만 읽어 줄 단위로 돌려줍니다. */
function tailLines(path: string): string[] {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fd = openSync(path, 'r');
    readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    // 잘린 첫 줄은 버립니다 — 중간부터 읽었으니 온전하지 않습니다.
    return (size > length ? lines.slice(1) : lines).filter(Boolean);
  } catch {
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** 한 줄에서 워치에 보여 줄 글자를 뽑습니다. */
function extract(entry: RawEntry): { kind: LogKind; text: string } | null {
  const content = entry.message?.content;
  const role = entry.type;
  if (role !== 'user' && role !== 'assistant') return null;

  if (typeof content === 'string') {
    return content.trim() ? { kind: role, text: content.trim() } : null;
  }
  if (!Array.isArray(content)) return null;

  for (const part of content as Array<Record<string, unknown>>) {
    const type = part.type;

    if (type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      return { kind: role, text: part.text.trim() };
    }
    if (type === 'tool_use') {
      const name = typeof part.name === 'string' ? part.name : '도구';
      const input = part.input as Record<string, unknown> | undefined;
      const command =
        (typeof input?.command === 'string' && input.command) ||
        (typeof input?.file_path === 'string' && input.file_path) ||
        '';
      return { kind: 'tool', text: command ? `${name}: ${command}` : name };
    }
    // tool_result 는 워치 화면에 너무 길고, 앞뒤 문맥 없이는 읽히지도 않습니다.
  }
  return null;
}

/**
 * 세션의 최근 대화. 오래된 것부터 순서대로 돌려줍니다.
 * @param limit 최대 줄 수
 */
export function readTranscript(sessionId: string, limit = 120): LogEntry[] {
  const path = findTranscript(sessionId);
  if (!path) return [];

  const out: LogEntry[] = [];
  for (const line of tailLines(path)) {
    let raw: RawEntry;
    try {
      raw = JSON.parse(line) as RawEntry;
    } catch {
      continue; // 지금 쓰고 있는 중일 수 있습니다.
    }

    const found = extract(raw);
    if (!found) continue;

    const at = raw.timestamp ? Date.parse(raw.timestamp) : Date.now();
    out.push({
      t: Number.isFinite(at) ? at : Date.now(),
      kind: found.kind,
      // 워치 화면에 들어갈 만큼만.
      text: found.text.length > 400 ? `${found.text.slice(0, 399)}…` : found.text,
    });
  }

  return out.slice(-limit);
}
