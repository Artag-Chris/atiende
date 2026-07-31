import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import type { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

function createAuthService() {
  return {
    login: vi.fn().mockResolvedValue({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      user: { id: 'u-1', email: 'admin@atiende.dev', name: 'Admin', role: 'ADMIN' },
    }),
    refresh: vi.fn().mockResolvedValue({ accessToken: 'at-2', refreshToken: 'rt-2' }),
  } as unknown as AuthService;
}

function makeReq(ip = '192.168.1.10') {
  return { ip, socket: { remoteAddress: '127.0.0.1' } } as unknown as Request;
}

describe('AuthController', () => {
  let controller: AuthController;
  let service: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    service = createAuthService();
    controller = new AuthController(service);
  });

  describe('login', () => {
    it('parses body and delegates to authService with ip and userAgent', async () => {
      const result = await controller.login(
        { email: 'admin@atiende.dev', password: 'secret' },
        makeReq(),
        'Mozilla/5.0',
      );

      expect(service.login).toHaveBeenCalledWith(
        'admin@atiende.dev',
        'secret',
        '192.168.1.10',
        'Mozilla/5.0',
      );
      expect(result.accessToken).toBe('at-1');
    });

    it('uses socket remoteAddress when req.ip is missing', async () => {
      await controller.login({ email: 'admin@atiende.dev', password: 'secret' }, {
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request);

      expect(service.login).toHaveBeenCalledWith(
        'admin@atiende.dev',
        'secret',
        '127.0.0.1',
        undefined,
      );
    });

    it('throws ZodError on malformed email', async () => {
      await expect(
        controller.login({ email: 'not-an-email', password: 'secret' }, makeReq()),
      ).rejects.toThrow(ZodError);
      expect(service.login).not.toHaveBeenCalled();
    });

    it('throws ZodError on empty password', async () => {
      await expect(
        controller.login({ email: 'admin@atiende.dev', password: '' }, makeReq()),
      ).rejects.toThrow(ZodError);
      expect(service.login).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('parses body and delegates to authService', async () => {
      const result = await controller.refresh({ refreshToken: 'rt-1' });

      expect(service.refresh).toHaveBeenCalledWith('rt-1');
      expect(result.accessToken).toBe('at-2');
    });

    it('throws ZodError on empty refresh token', async () => {
      await expect(controller.refresh({ refreshToken: '' })).rejects.toThrow(ZodError);
      expect(service.refresh).not.toHaveBeenCalled();
    });
  });
});
