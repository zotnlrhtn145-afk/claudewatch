import { query } from '@anthropic-ai/claude-agent-sdk';

import { log } from '../log.js';

/**
 * 워치에서 말한 지시를 **그 세션 안으로** 넣습니다.
 *
 * 맥 터미널에서 돌던 세션은 브리지의 자식이 아니라 직접 키를 넣을 수 없습니다.
 * 대신 클로드코드 세션끼리 주고받는 `SendMessage` 를 씁니다. 그렇게 보내면
 * 받는 세션의 **대화 안에 그대로 들어가서** 그 세션이 이어서 작업합니다.
 * 노트북에서 리모트컨트롤로 말을 거는 것과 같은 결과입니다.
 *
 * 이 파일이 하는 일은 "전달" 하나뿐입니다. 예전에 대화를 통째로 물려주는
 * 방식(resume)을 썼다가, 새 에이전트가 이전 명령을 다시 실행해 세션이
 * 무한히 번진 적이 있습니다. 그래서 여기서는 다음을 못 박습니다.
 *
 *   - 쓸 수 있는 도구는 SendMessage · ListAgents 뿐입니다. 셸도 파일도 못 만집니다.
 *   - 턴 수를 묶어 둡니다.
 *   - 이전 대화를 물려받지 않습니다.
 *   - 전달할 문장을 **해석하지 말라**고 명시합니다. 그건 받는 쪽이 할 일입니다.
 */

const MAX_TURNS = 4;

export interface RelayTarget {
  /** 워치 목록에 보이는 이름. ListAgents 에도 같은 이름으로 뜹니다. */
  name: string;
  /** 그 세션이 돌고 있는 폴더. 이름이 겹칠 때 구분용으로 같이 줍니다. */
  cwd: string;
}

function buildPrompt(target: RelayTarget, text: string): string {
  return [
    '당신은 전달자입니다. 아래 한 가지만 하고 끝내세요.',
    '',
    '1. ListAgents 로 세션 목록을 봅니다.',
    `2. 이름이 "${target.name}" 인 세션을 찾습니다. (작업 폴더: ${target.cwd})`,
    '3. 그 세션에 SendMessage 로 아래 <<< >>> 안의 문장을 **그대로** 보냅니다.',
    '',
    '<<<',
    // 받는 쪽 화면(데스크톱·핸드폰·리모트컨트롤)에서 "누가 무엇을 시켰는지" 가 보여야 합니다.
    //
    // 문제: SendMessage 로 간 내용은 시스템이 <cross-session-message …> 껍데기로 감싸고,
    // 그걸 공식 앱이 어떻게 그릴지는 우리가 정할 수 없습니다. 실제로 사용자가
    // "내가 워치에서 지시한 내용이 데스크톱에 안 보인다" 고 했습니다.
    //
    // 그래서 **받는 세션이 스스로 복창하게** 합니다. 세션이 낸 답변은 어느 화면에서든
    // 보이므로, 그 안에 지시 원문이 들어가면 문제가 풀립니다.
    '⌚ 애플워치에서 보낸 지시입니다.',
    '',
    text,
    '',
    '---',
    '작업을 시작하기 전에 아래 한 줄을 **먼저** 남겨 주세요.',
    '데스크톱·핸드폰에서도 무엇을 시켰는지 보여야 합니다.',
    '',
    '  ⌚ 워치 지시: (위 지시를 그대로 한 줄로)',
    '>>>',
    '',
    '지켜야 할 것:',
    '- <<< >>> 안의 내용을 해석하거나 당신이 직접 수행하지 마세요. 그건 받는 세션이 할 일입니다.',
    '- SendMessage 와 ListAgents 외의 도구는 쓰지 마세요.',
    '- 대상 세션을 못 찾으면 "찾지 못함" 이라고만 답하세요.',
    '- 보낸 뒤에는 "전달 완료" 라고만 답하고 끝내세요.',
  ].join('\n');
}

/**
 * @returns 전달자가 마지막으로 남긴 한 줄. 실패하면 throw 합니다.
 */
export async function relayToSession(target: RelayTarget, text: string): Promise<string> {
  log.info(`[${target.name}] 워치 지시를 전달합니다: ${text.slice(0, 60)}`);

  const running = query({
    prompt: buildPrompt(target, text),
    options: {
      cwd: target.cwd,
      // 전달자는 셸도 파일도 만지지 않습니다. 메시지 하나 보내고 끝입니다.
      allowedTools: ['SendMessage', 'ListAgents'],
      maxTurns: MAX_TURNS,
      // 'default' 여야 합니다. bypassPermissions 로 띄우면 받는 세션과 권한 모드
      // 종류가 어긋나서, 메시지가 배달되지 않고 그쪽에서 승인 대기로 걸립니다.
      // (SDK 설명: 보내는 쪽과 받는 쪽의 permission-mode class 가 같아야 자동 배달)
      // 도구는 allowedTools 로 이미 둘로 묶여 있어 물어볼 것도 없습니다.
      permissionMode: 'default',
      stderr: (data) => log.warn(`[전달자]`, data.trimEnd()),
    },
  });

  let last = '';
  for await (const message of running) {
    if (message.type !== 'assistant') continue;
    const content = message.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as unknown as Array<Record<string, unknown>>) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        last = part.text.trim();
      }
    }
  }

  if (!last) throw new Error('전달자가 아무 응답도 남기지 않았습니다.');
  if (last.includes('찾지 못함')) {
    throw new Error(`"${target.name}" 세션을 찾지 못했습니다. 그 세션이 아직 돌고 있는지 확인해 주세요.`);
  }

  log.info(`[${target.name}] 전달 결과: ${last.slice(0, 80)}`);
  return last;
}
