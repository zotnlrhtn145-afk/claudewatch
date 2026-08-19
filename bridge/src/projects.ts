import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { config } from './config.js';
import { tilde } from './sessions/describe.js';

export interface ProjectEntry {
  name: string;
  path: string;
  /** 워치 목록에 보여 줄 짧은 경로. */
  display: string;
}

/** 훑어봐야 의미 없는 폴더들. */
const SKIP = new Set([
  'Library',
  'Applications',
  'Movies',
  'Music',
  'Pictures',
  'Public',
  'Desktop',
  'Downloads',
  'go',
  'node_modules',
]);

function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'));
}

function toEntry(path: string, home: string): ProjectEntry {
  return { name: basename(path), path, display: tilde(path, home) };
}

/**
 * 새 세션에서 고를 수 있는 프로젝트 목록.
 * BRIDGE_PROJECTS 를 정해 두면 그대로 쓰고, 비워 두면 홈 바로 아래 git 저장소를 찾습니다.
 */
export function listProjects(): ProjectEntry[] {
  const home = homedir();

  if (config.projects.length > 0) {
    return config.projects.filter((p) => existsSync(p)).map((p) => toEntry(p, home));
  }

  let names: string[];
  try {
    names = readdirSync(home);
  } catch {
    return [];
  }

  const found: ProjectEntry[] = [];
  for (const name of names) {
    if (name.startsWith('.') || SKIP.has(name)) continue;
    const path = join(home, name);
    try {
      if (!statSync(path).isDirectory() || !isGitRepo(path)) continue;
    } catch {
      continue;
    }
    found.push(toEntry(path, home));
  }

  return found.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 워치가 보낸 프로젝트 경로가 실제로 고를 수 있는 것인지 확인합니다. */
export function resolveProject(input: string): string | null {
  const projects = listProjects();
  const match = projects.find((p) => p.path === input || p.name === input || p.display === input);
  return match ? match.path : null;
}
