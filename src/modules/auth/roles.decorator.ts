import { SetMetadata } from '@nestjs/common';
import type { BusinessUserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: BusinessUserRole[]) => SetMetadata(ROLES_KEY, roles);
