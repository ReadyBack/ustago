import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { UsersRepository } from '../users/users.repository.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordService } from './password.service.js';
import { RolesGuard } from './roles.guard.js';
import { SessionsRepository } from './sessions.repository.js';
import { TokenService } from './token.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    SessionsRepository,
    UsersRepository,
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SessionsRepository, UsersRepository],
})
export class AuthModule {}
