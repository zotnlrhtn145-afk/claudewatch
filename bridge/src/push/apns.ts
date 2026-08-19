import { createSign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http2 from 'node:http2';
import { resolve } from 'node:path';

import { apnsConfigured, config } from '../config.js';
import { guardSecret, log } from '../log.js';

/**
 * APNs 푸시. 외부 라이브러리 없이 node 기본 http2 + crypto 로 보냅니다.
 *
 * 키(.p8)를 못 읽거나 설정이 비어 있으면 조용히 건너뜁니다 —
 * 푸시는 편의 기능이고, 없다고 승인 기능 자체가 막히면 안 됩니다.
 */

const HOSTS = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
} as const;

const DEVICES_FILE = resolve(import.meta.dirname, '../../.devices.json');

let devices: string[] = [];
try {
  if (existsSync(DEVICES_FILE)) devices = JSON.parse(readFileSync(DEVICES_FILE, 'utf8'));
} catch {
  devices = [];
}

export function registerDevice(token: string): void {
  const clean = token.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (clean.length < 32) throw new Error('기기 토큰 모양이 이상합니다.');
  if (devices.includes(clean)) return;
  devices.push(clean);
  guardSecret(clean);
  try {
    writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2));
  } catch (error) {
    log.warn('기기 토큰을 저장하지 못했습니다:', String(error));
  }
}

export function deviceCount(): number {
  return devices.length;
}

function removeDevice(token: string): void {
  devices = devices.filter((d) => d !== token);
  try {
    writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2));
  } catch {
    // 다음 등록 때 다시 씁니다
  }
}

let cachedJwt: { token: string; madeAt: number } | null = null;

/** APNs 인증 토큰. 애플 권장대로 1시간마다 새로 만듭니다. */
function authToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.madeAt < 50 * 60) return cachedJwt.token;

  const key = readFileSync(config.apns.keyPath, 'utf8');
  guardSecret(key);

  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', kid: config.apns.keyId }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: config.apns.teamId, iat: now }),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;

  // ieee-p1363 이어야 JOSE 가 기대하는 r||s 모양이 나옵니다. DER 로 서명하면 애플이 거부합니다.
  const signature = createSign('SHA256')
    .update(signingInput)
    .sign({ key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');

  const token = `${signingInput}.${signature}`;
  guardSecret(token);
  cachedJwt = { token, madeAt: now };
  return token;
}

export interface ApprovalPush {
  sessionId: string;
  sessionName: string;
  approvalId: string;
  command: string;
  risky: boolean;
}

function send(deviceToken: string, body: Buffer, jwt: string): Promise<void> {
  return new Promise((done) => {
    const client = http2.connect(HOSTS[config.apns.env]);
    const finish = (): void => {
      client.close();
      done();
    };

    client.on('error', (error) => {
      log.warn('APNs 연결 실패:', error.message);
      done();
    });

    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': config.apns.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
      'content-length': body.length,
    });

    let status = 0;
    let responseText = '';
    request.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
    });
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      responseText += chunk;
    });
    request.on('end', () => {
      if (status === 200) {
        finish();
        return;
      }
      // 410 = 기기가 앱을 지웠음. 계속 보내면 애플이 싫어합니다.
      if (status === 410 || responseText.includes('BadDeviceToken')) {
        log.warn('죽은 기기 토큰을 목록에서 뺐습니다.');
        removeDevice(deviceToken);
      } else {
        log.warn(`APNs 응답 ${status}: ${responseText}`);
      }
      finish();
    });
    request.on('error', (error) => {
      log.warn('APNs 전송 실패:', error.message);
      finish();
    });

    request.end(body);
  });
}

/** 승인 요청 푸시. 실패해도 던지지 않습니다 — 승인 흐름을 막으면 안 됩니다. */
export async function pushApproval(payload: ApprovalPush): Promise<void> {
  if (!apnsConfigured) return;
  if (devices.length === 0) return;

  let jwt: string;
  try {
    jwt = authToken();
  } catch (error) {
    log.warn('APNs 키를 읽지 못했습니다. 푸시를 건너뜁니다.', String(error));
    return;
  }

  // 손목에서는 몇 줄이 전부입니다. 긴 명령을 통째로 밀어 넣으면
  // 정작 "무엇을 하려는가" 가 안 보입니다. 첫 줄만 보여 주고 나머지는 접습니다.
  // (전체 원문은 앱의 승인 화면에서 봅니다.)
  const firstLine = payload.command.split('\n')[0]?.trim() ?? '';
  const extraLines = payload.command.split('\n').length - 1;
  const shortCommand =
    (firstLine.length > 110 ? `${firstLine.slice(0, 109)}…` : firstLine) +
    (extraLines > 0 ? ` … (+${extraLines}줄)` : '');

  const body = Buffer.from(
    JSON.stringify({
      aps: {
        alert: {
          title: payload.sessionName,
          subtitle: payload.risky ? '⚠︎ 되돌리기 어려운 명령입니다' : '이 명령을 실행할까요?',
          body: shortCommand,
        },
        category: 'APPROVAL',
        sound: 'default',
        'interruption-level': 'time-sensitive',
      },
      sessionId: payload.sessionId,
      approvalId: payload.approvalId,
      command: payload.command,
      risky: payload.risky,
    }),
  );

  await Promise.all(devices.map((device) => send(device, body, jwt)));
}
