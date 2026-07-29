import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { PrismaService } from '../persistence/postgres/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

const hashedPassword = bcrypt.hashSync('correct-password', 1);

const mockUser = {
  id: 'user-1',
  businessId: 'biz-1',
  email: 'admin@test.com',
  name: 'Admin',
  password: hashedPassword,
  role: 'ADMIN' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createMockPrisma() {
  return {
    businessUser: {
      findUnique: vi.fn(),
    },
    loginAttempt: {
      create: vi.fn(),
    },
  };
}

function createMockJwt() {
  return {
    signAsync: vi.fn().mockResolvedValue('mock-token'),
    verifyAsync: vi.fn(),
  };
}

function createMockConfig() {
  return {
    get: vi.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        JWT_SECRET: 'test-secret-that-is-long-enough-123',
        JWT_EXPIRES_IN: '7d',
        JWT_REFRESH_EXPIRES_IN: '30d',
      };
      return values[key] ?? defaultValue;
    }),
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwt: ReturnType<typeof createMockJwt>;
  let config: ReturnType<typeof createMockConfig>;

  beforeEach(() => {
    prisma = createMockPrisma();
    jwt = createMockJwt();
    config = createMockConfig();
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
  });

  describe('login', () => {
    it('returns tokens on valid credentials', async () => {
      prisma.businessUser.findUnique.mockResolvedValue(mockUser);
      const result = await service.login('admin@test.com', 'correct-password');
      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
      expect(result.user.email).toBe('admin@test.com');
      expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ success: true }),
      });
    });

    it('throws on invalid password', async () => {
      prisma.businessUser.findUnique.mockResolvedValue(mockUser);
      await expect(service.login('admin@test.com', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ success: false }),
      });
    });

    it('throws on unknown email', async () => {
      prisma.businessUser.findUnique.mockResolvedValue(null);
      await expect(service.login('unknown@test.com', 'any')).rejects.toThrow(UnauthorizedException);
      expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ success: false }),
      });
    });

    it('records ip and userAgent on attempt', async () => {
      prisma.businessUser.findUnique.mockResolvedValue(null);
      await expect(
        service.login('test@test.com', 'pwd', '192.168.1.1', 'Mozilla/5.0'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ip: '192.168.1.1', userAgent: 'Mozilla/5.0' }),
      });
    });
  });

  describe('refresh', () => {
    it('returns new tokens when refresh token is valid', async () => {
      prisma.businessUser.findUnique.mockResolvedValue(mockUser);
      jwt.verifyAsync.mockResolvedValue({
        sub: mockUser.id,
        email: mockUser.email,
        businessId: mockUser.businessId,
        role: mockUser.role,
        name: mockUser.name,
        type: 'refresh',
      });

      const result = await service.refresh('valid-refresh-token');
      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
    });

    it('throws when token type is not refresh', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: mockUser.id,
        email: mockUser.email,
        businessId: mockUser.businessId,
        role: mockUser.role,
        type: 'access',
      });

      await expect(service.refresh('invalid-type-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when token is expired', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('Token expired'));
      await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when user no longer exists', async () => {
      prisma.businessUser.findUnique.mockResolvedValue(null);
      jwt.verifyAsync.mockResolvedValue({
        sub: 'deleted-user',
        email: 'deleted@test.com',
        businessId: 'biz-1',
        role: 'ADMIN',
        name: 'Deleted',
        type: 'refresh',
      });

      await expect(service.refresh('valid-token-deleted-user')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
