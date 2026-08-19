// node-pty 1.1.0 은 prebuilds 의 spawn-helper 를 실행 권한 없이(-rw-r--r--) 배포합니다.
// 그대로 두면 pty.spawn() 이 "posix_spawnp failed" 로 죽습니다 — 원인이 전혀 드러나지 않는 실패라
// 설치할 때 조용히 고쳐 둡니다.
//
// node-pty 는 optionalDependencies 입니다. 없으면 그냥 넘어갑니다 (sdk 드라이버만 쓰는 경우).
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../node_modules/node-pty/prebuilds', import.meta.url).pathname;

if (!existsSync(root)) process.exit(0);

let fixed = 0;
for (const dir of readdirSync(root)) {
  const helper = join(root, dir, 'spawn-helper');
  if (!existsSync(helper)) continue;
  // 이미 실행 가능하면 건드리지 않습니다.
  if (statSync(helper).mode & 0o111) continue;
  chmodSync(helper, 0o755);
  fixed += 1;
}

if (fixed > 0) console.log(`· node-pty spawn-helper 에 실행 권한을 넣었습니다 (${fixed}개)`);
