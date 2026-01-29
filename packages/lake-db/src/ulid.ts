// ULID-like timestamped ID generator
// Format: timestamp (10 chars) + random (16 chars) = 26 chars
// Base32 encoding using Crockford's alphabet

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(now: number, len = 10): string {
  let str = '';
  for (let i = 0; i < len; i++) {
    str = CROCKFORD[now & 0x1f] + str;
    now = Math.floor(now / 32);
  }
  return str;
}

function encodeRandom(len = 16): string {
  let str = '';
  for (let i = 0; i < len; i++) {
    str += CROCKFORD[Math.floor(Math.random() * 32)];
  }
  return str;
}

export function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom();
}
