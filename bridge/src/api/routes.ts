import { timingSafeEqual } from 'node:crypto';

import express, { type NextFunction, type Request, type Response, type Router } from 'express';

import { apnsConfigured, config } from '../config.js';
import { listProjects, resolveProject } from '../projects.js';
import { deviceCount, registerDevice } from '../push/apns.js';
import { askWatch } from '../sessions/external.js';
import { relayToSession } from '../sessions/relay.js';
import { sessions } from '../sessions/manager.js';
import { mintCode, redeem } from './pairing.js';
import { lockedFor, noteFailure, noteSuccess } from './throttle.js';

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function clientIp(request: Request): string {
  // Funnel 을 거치면 실제 주소가 이 헤더로 옵니다. 없으면 소켓 주소를 씁니다.
  const forwarded = (request.get('x-forwarded-for') ?? '').split(',')[0]?.trim();
  return forwarded || request.socket.remoteAddress || 'unknown';
}

function requireToken(request: Request, response: Response, next: NextFunction): void {
  const ip = clientIp(request);

  // 잠긴 동안은 토큰이 맞는지조차 보지 않습니다.
  const wait = lockedFor(ip);
  if (wait > 0) {
    response.set('Retry-After', String(wait));
    response.status(429).json({ error: `시도가 너무 많습니다. ${wait}초 뒤에 다시 해주세요.` });
    return;
  }

  const header = request.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !tokensMatch(given, config.token)) {
    noteFailure(ip);
    response.status(401).json({ error: '토큰이 맞지 않습니다.' });
    return;
  }

  noteSuccess(ip);
  next();
}

function body(request: Request): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createRouter(): Router {
  const router = express.Router();

  // 헬스체크만 토큰 없이 엽니다.
  // Funnel 로 내주면 이 응답은 인터넷 누구나 봅니다. 그래서 밖에는 "살아 있다" 만 알려 주고,
  // 드라이버·등록 기기 수 같은 속사정은 맥 안에서 물었을 때만 붙입니다.
  router.get('/health', (request, response) => {
    const ip = clientIp(request);
    const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

    if (!local) {
      response.json({ ok: true });
      return;
    }

    response.json({
      ok: true,
      driver: config.driver,
      push: apnsConfigured ? `on (${deviceCount()}대)` : 'off',
      time: Date.now(),
    });
  });

  // ── 페어링 ──
  // 워치에서 32자 토큰을 손으로 넣는 건 불가능에 가깝습니다.
  // 맥에서 숫자 코드를 발급하고, 워치는 그 숫자만 눌러 토큰을 받아 갑니다.

  /** 코드 발급 — 맥 안에서만 됩니다. 밖에서 발급되면 그게 곧 뚫린 겁니다. */
  router.post('/pair/new', (request, response) => {
    const ip = clientIp(request);
    const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!local) {
      response.status(404).json({ error: '없는 주소입니다.' });
      return;
    }
    response.json(mintCode());
  });

  /** 코드 → 토큰. 공개돼 있으므로 시도 제한을 그대로 받습니다. */
  router.post('/pair', (request, response) => {
    const ip = clientIp(request);
    const wait = lockedFor(ip);
    if (wait > 0) {
      response.set('Retry-After', String(wait));
      response.status(429).json({ error: `시도가 너무 많습니다. ${wait}초 뒤에 다시 해주세요.` });
      return;
    }

    const code = text(body(request).code);
    const token = code ? redeem(code) : null;
    if (!token) {
      noteFailure(ip);
      response.status(401).json({ error: '코드가 맞지 않거나 시간이 지났습니다.' });
      return;
    }

    noteSuccess(ip);
    response.json({ token });
  });

  /**
   * 맥에서 따로 돌고 있는 세션의 훅이 부르는 곳.
   * 워치가 답할 때까지 붙잡고 있다가 결정을 돌려줍니다 (롱폴).
   * 훅은 맥 안에서 도니 루프백만 받습니다.
   */
  router.post('/external/ask', async (request, response) => {
    const ip = clientIp(request);
    const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!local) {
      response.status(404).json({ error: '없는 주소입니다.' });
      return;
    }

    const b = body(request);
    const sessionId = text(b.sessionId);
    const toolName = text(b.toolName) || 'unknown';
    if (!sessionId) {
      response.status(400).json({ error: 'sessionId 가 필요합니다.' });
      return;
    }

    // 제외 목록에 있는 세션은 묻지 않습니다.
    if (config.hookSkip.includes(sessionId)) {
      response.json({ decision: 'timeout', reason: '제외된 세션입니다.' });
      return;
    }

    // 워치가 하나도 등록돼 있지 않으면 물어봐야 소용이 없습니다. 바로 빠집니다.
    if (deviceCount() === 0) {
      response.json({ decision: 'timeout', reason: '등록된 워치가 없습니다.' });
      return;
    }

    // 훅은 세션 이름을 작업 폴더에서 뽑아 보냅니다. 그런데 명령이 `cd .../scratchpad`
    // 로 시작하면 이름이 "scratchpad" 가 되어 **어느 프로젝트인지 알 수 없게** 됩니다.
    // 클로드코드가 남긴 세션 기록에 진짜 이름이 있으므로 그쪽을 먼저 씁니다.
    const key = `ext:${sessionId}`;
    const known = sessions.listAll().find((s) => s.id === key);
    const sessionName = known?.name || text(b.sessionName) || '맥 세션';

    const timeoutMs = Math.min(Math.max(Number(b.timeoutMs) || 90_000, 5_000), 550_000);
    const decision = await askWatch({
      sessionKey: key,
      sessionName,
      toolName,
      toolInput: (b.toolInput ?? {}) as Record<string, unknown>,
      timeoutMs,
    });
    response.json({ decision });
  });

  router.use(requireToken);

  router.get('/projects', (_request, response) => {
    response.json({ projects: listProjects() });
  });

  router.get('/sessions', (_request, response) => {
    response.json({ sessions: sessions.listAll() });
  });

  router.post('/sessions', async (request, response) => {
    const project = text(body(request).project);
    const firstPrompt = text(body(request).firstPrompt);
    const name = text(body(request).name);

    if (!project || !firstPrompt) {
      response.status(400).json({ error: 'project 와 firstPrompt 가 필요합니다.' });
      return;
    }

    const cwd = resolveProject(project);
    if (!cwd) {
      response.status(400).json({ error: `고를 수 없는 프로젝트입니다: ${project}` });
      return;
    }

    const detail = await sessions.create({
      project: cwd,
      firstPrompt,
      ...(name ? { name } : {}),
    });
    response.status(201).json(detail);
  });

  router.get('/sessions/:id', (request, response) => {
    const detail = sessions.detail(request.params.id);
    if (!detail) {
      response.status(404).json({ error: '없는 세션입니다.' });
      return;
    }
    response.json(detail);
  });

  router.get('/sessions/:id/log', (request, response) => {
    const limit = Number.parseInt(text(request.query.limit), 10);
    const entries = sessions.logOf(request.params.id, Number.isFinite(limit) ? limit : undefined);
    if (!entries) {
      response.status(404).json({ error: '없는 세션입니다.' });
      return;
    }
    response.json({ log: entries });
  });

  for (const [path, decision] of [
    ['approve', 'allow'],
    ['deny', 'deny'],
  ] as const) {
    router.post(`/sessions/:id/${path}`, (request, response) => {
      const approvalId = text(body(request).approvalId);
      // always=true 면 이 명령을 「항상 허용」에 적어 둡니다 (영구 저장).
      const always = body(request).always === true;
      const result = sessions.decide(
        request.params.id,
        decision,
        approvalId || undefined,
        always,
      );

      if (result === 'no-session') {
        response.status(404).json({ error: '없는 세션입니다.' });
        return;
      }
      if (result === 'stale') {
        // 이미 처리됐거나 다른 요청으로 바뀐 경우. 워치는 목록만 새로 받으면 됩니다.
        response.status(409).json({ error: '이미 처리된 승인 요청입니다.' });
        return;
      }
      response.json(sessions.detail(request.params.id));
    });
  }

  router.post('/sessions/:id/prompt', async (request, response) => {
    const value = text(body(request).text);
    if (!value) {
      response.status(400).json({ error: 'text 가 필요합니다.' });
      return;
    }

    // 맥 터미널에서 돌던 세션 — 그 세션 **안으로** 지시를 넣습니다.
    //
    // 새 세션을 만들지 않습니다. 노트북에서 리모트컨트롤로 말을 걸 때처럼,
    // 대화가 그 세션에서 그대로 이어져야 합니다. 세션끼리 주고받는
    // SendMessage 로 전달하면 받는 쪽 대화에 들어가서 그 세션이 이어서 합니다.
    if (request.params.id.startsWith('ext:')) {
      const source = sessions.listAll().find((s) => s.id === request.params.id);
      if (!source) {
        response.status(404).json({ error: '없는 세션입니다.' });
        return;
      }
      try {
        await relayToSession({ name: source.name, cwd: source.project }, value);
        // 워치는 다른 지시 경로와 똑같이 SessionDetail 을 기대합니다.
        // 여기서만 모양이 다르면, 전달은 됐는데 화면엔 오류가 뜨는
        // 제일 헷갈리는 실패가 됩니다. 실제로 그랬습니다.
        response.json(sessions.detail(request.params.id));
      } catch (error) {
        response.status(502).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    try {
      const ok = await sessions.prompt(request.params.id, value);
      if (!ok) {
        response.status(404).json({ error: '없는 세션입니다.' });
        return;
      }
      response.json(sessions.detail(request.params.id));
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/sessions/:id/stop', async (request, response) => {
    const ok = await sessions.stop(request.params.id);
    if (!ok) {
      response.status(404).json({ error: '없는 세션입니다.' });
      return;
    }
    response.json(sessions.detail(request.params.id));
  });

  // 워치가 APNs 기기 토큰을 등록하는 곳. 이게 있어야 승인 푸시가 갑니다.
  router.post('/devices', (request, response) => {
    const token = text(body(request).token);
    try {
      registerDevice(token);
      response.json({ ok: true, count: deviceCount() });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
