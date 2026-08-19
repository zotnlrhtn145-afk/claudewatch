/**
 * 아주 얇은 로거. 비밀값이 콘솔로 새지 않게 걸러 냅니다.
 * (토큰·키가 로그에 찍히면 그대로 유출입니다.)
 */
const secrets = new Set<string>();

export function guardSecret(value: string | undefined | null): void {
  if (value && value.length >= 8) secrets.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  // -----BEGIN PRIVATE KEY----- 같은 덩어리도 통째로 가립니다.
  out = out.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '***KEY***');
  return out;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function write(level: string, args: unknown[]): void {
  const text = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  console.log(`${stamp()} ${level} ${redact(text)}`);
}

export const log = {
  info: (...args: unknown[]) => write('·', args),
  warn: (...args: unknown[]) => write('!', args),
  error: (...args: unknown[]) => write('✗', args),
};
