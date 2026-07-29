import { Controller, Post, Body, HttpCode, HttpStatus, Headers, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string,
  ) {
    const parsed = LoginSchema.parse(body);
    const ip = req.ip ?? req.socket?.remoteAddress;
    return this.authService.login(parsed.email, parsed.password, ip, userAgent);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: unknown) {
    const parsed = RefreshSchema.parse(body);
    return this.authService.refresh(parsed.refreshToken);
  }
}
