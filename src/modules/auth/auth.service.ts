import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../persistence/postgres/prisma.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const user = await this.prisma.businessUser.findUnique({ where: { email } });

    const success = user !== null && (await bcrypt.compare(password, user!.password));

    await this.prisma.loginAttempt.create({
      data: { userId: user?.id ?? null, email, success, ip, userAgent },
    });

    if (!user || !success) {
      if (!success) {
        this.logger.warn(`Failed login attempt for ${email} from ${ip ?? 'unknown'}`);
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`Successful login: ${email} (${user.role})`);

    return this.buildTokens(user.id, user.email, user.businessId, user.role, user.name);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        businessId: string;
        role: string;
        name: string;
        type: string;
      }>(refreshToken, {
        secret: this.config.get('JWT_SECRET'),
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      const user = await this.prisma.businessUser.findUnique({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException('User not found');

      return this.buildTokens(user.id, user.email, user.businessId, user.role, user.name);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private async buildTokens(
    userId: string,
    email: string,
    businessId: string,
    role: string,
    name: string,
  ) {
    const payload = { sub: userId, email, businessId, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: this.config.get('JWT_EXPIRES_IN', '7d'),
      }),
      this.jwtService.signAsync(
        { ...payload, name, type: 'refresh' },
        {
          secret: this.config.get('JWT_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      user: { email, name, role, businessId },
    };
  }
}
