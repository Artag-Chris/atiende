import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const MASTER_KEY_B64 = Buffer.alloc(32, 1).toString('base64');

function createService(): CryptoService {
  const config = {
    getOrThrow: (key: string) => (key === 'ENCRYPTION_MASTER_KEY' ? MASTER_KEY_B64 : 'x'),
  } as unknown as ConfigService;
  return new CryptoService(config);
}

describe('CryptoService', () => {
  it('round-trips a plaintext token', () => {
    const crypto = createService();
    const token = 'EAAG-mega-page-token-123456';

    const encrypted = crypto.encrypt(token);
    const decrypted = crypto.decrypt(encrypted);

    expect(decrypted).toBe(token);
  });

  it('produces a fresh IV per encryption (same plaintext, different ciphertext)', () => {
    const crypto = createService();
    const a = crypto.encrypt('secret');
    const b = crypto.encrypt('secret');

    expect(a).not.toBe(b);
  });

  it('stores the payload as iv:tag:ciphertext (three base64 parts)', () => {
    const crypto = createService();
    const payload = crypto.encrypt('secret');

    const parts = payload.split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow();
    }
  });

  it('rejects a payload with the wrong shape', () => {
    const crypto = createService();
    expect(() => crypto.decrypt('not-encrypted')).toThrow('Invalid encrypted payload format');
  });

  it('fails to decrypt with a different key', () => {
    const crypto = createService();
    const encrypted = crypto.encrypt('secret');

    const other = {
      getOrThrow: () => Buffer.alloc(32, 2).toString('base64'),
    } as unknown as ConfigService;
    const otherCrypto = new CryptoService(other);

    expect(() => otherCrypto.decrypt(encrypted)).toThrow();
  });

  it('fails to decrypt a tampered payload (GCM auth tag)', () => {
    const crypto = createService();
    const encrypted = crypto.encrypt('secret');
    const [iv, tag, data] = encrypted.split(':');
    const tamperedData = Buffer.from(data, 'base64');
    tamperedData[0] = tamperedData[0] ^ 0xff;

    expect(() => crypto.decrypt(`${iv}:${tag}:${tamperedData.toString('base64')}`)).toThrow();
  });
});
