import { networkInterfaces } from 'node:os';

import express from 'express';

import { createRouter } from './api/routes.js';
import { sleepGuard } from './awake.js';
import { apnsConfigured, config } from './config.js';
import { guardSecret, log } from './log.js';
import { listProjects } from './projects.js';
import { sessions } from './sessions/manager.js';

if (!config.token) {
  console.error(
    [
      'BRIDGE_TOKEN 이 비어 있습니다. 토큰 없이 열면 같은 네트워크의 누구나 세션을 만들 수 있습니다.',
      '',
      '  cd bridge && cp .env.example .env',
      '  node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'base64url\'))"',
      '',
      '나온 값을 .env 의 BRIDGE_TOKEN 에 넣으세요.',
    ].join('\n'),
  );
  process.exit(1);
}

guardSecret(config.token);

/** Tailscale 주소(100.x.y.z)를 먼저 보여 줍니다 — 워치가 실제로 붙을 주소입니다. */
function addresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      found.push(net.address);
    }
  }
  return found.sort((a, b) => Number(b.startsWith('100.')) - Number(a.startsWith('100.')));
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(createRouter());

app.use((_request, response) => {
  response.status(404).json({ error: '없는 주소입니다.' });
});

/** 잠자기 방지 상태를 시작 로그 한 줄로 보여 줍니다. */
const awakeLabel = {
  sessions: '세션 있을 때만',
  always: '항상',
  off: '끔',
}[config.keepAwake];

const server = app.listen(config.port, config.host, () => {
  const projects = listProjects();
  log.info(`브리지 서버가 떴습니다 — 드라이버 ${config.driver}`);
  for (const address of addresses()) {
    const tag = address.startsWith('100.') ? ' ← Tailscale' : '';
    log.info(`  http://${address}:${config.port}${tag}`);
  }
  log.info(`  프로젝트 ${projects.length}개, 푸시 ${apnsConfigured ? '켜짐' : '꺼짐(APNS_* 미설정)'}`);
  log.info(`  잠자기 방지 ${awakeLabel}`);

  if (config.keepAwake === 'always') sleepGuard.acquire('BRIDGE_KEEP_AWAKE=always');
});

async function shutdown(signal: string): Promise<void> {
  log.info(`${signal} — 세션을 정리하고 내려갑니다.`);
  await sessions.stopAll();
  sleepGuard.release();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
