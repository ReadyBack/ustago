import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { testEnv } from '../testing/test-env.js';
import { extractBearer, JwtAuthGuard } from './jwt-auth.guard.js';
import type { SessionsRepository, SessionWithUser } from './sessions.repository.js';
import { TokenService } from './token.service.js';

const USER_ID = '0199a0a0-0000-7000-8000-00000000000a';
const SESSION_ID = '0199a0a0-0000-7000-8000-00000000000b';

function session(overrides: Partial<SessionWithUser> = {}, userOverrides = {}): SessionWithUser {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    deviceId: null,
    userAgent: null,
    ipAddress: null,
    expiresAt: new Date(Date.now() + 60_000),
    lastUsedAt: new Date(),
    revokedAt: null,
    revokedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: USER_ID,
      status: 'ACTIVE',
      deletedAt: null,
      roles: [{ role: 'CUSTOMER' }],
      ...userOverrides,
    },
    ...overrides,
  };
}

describe('JwtAuthGuard', () => {
  const tokens = new TokenService(testEnv());
  let found: SessionWithUser | null;
  const sessions = {
    findForAuth: vi.fn(() => Promise.resolve(found)),
  } as unknown as SessionsRepository;

  function setup(isPublic = false) {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);
    return new JwtAuthGuard(reflector, tokens, sessions);
  }

  function contextWith(authorization?: string) {
    const request = { headers: { authorization } } as unknown as Request;
    const context = {
      getHandler: () => () => undefined,
      getClass: () => Object,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { request, context };
  }

  async function bearer() {
    const { token } = await tokens.signAccessToken({ userId: USER_ID, sessionId: SESSION_ID });
    return `Bearer ${token}`;
  }

  beforeEach(() => {
    found = session();
  });

  it('lets public routes through without a token', async () => {
    await expect(setup(true).canActivate(contextWith().context)).resolves.toBe(true);
  });

  it('requires a bearer token', async () => {
    await expect(setup().canActivate(contextWith().context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the user with roles read from the database', async () => {
    found = session({}, { roles: [{ role: 'CUSTOMER' }, { role: 'PROVIDER' }] });
    const { request, context } = contextWith(await bearer());
    await expect(setup().canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: USER_ID,
      sessionId: SESSION_ID,
      roles: ['CUSTOMER', 'PROVIDER'],
    });
  });

  it.each([
    ['revoked', () => session({ revokedAt: new Date() })],
    ['expired', () => session({ expiresAt: new Date(Date.now() - 1000) })],
    ['missing', () => null],
    ['for another user', () => session({ userId: '0199a0a0-0000-7000-8000-0000000000ff' })],
    ['of a deleted user', () => session({}, { deletedAt: new Date() })],
  ])('rejects a %s session', async (_label, make) => {
    found = make();
    await expect(setup().canActivate(contextWith(await bearer()).context)).rejects.toMatchObject({
      response: { code: 'SESSION_REVOKED' },
    });
  });

  it('rejects suspended users with 403', async () => {
    found = session({}, { status: 'SUSPENDED' });
    await expect(setup().canActivate(contextWith(await bearer()).context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects garbage tokens', async () => {
    await expect(
      setup().canActivate(contextWith('Bearer abc.def.ghi').context),
    ).rejects.toMatchObject({
      response: { code: 'ACCESS_TOKEN_INVALID' },
    });
  });
});

describe('extractBearer', () => {
  it.each([
    [undefined, null],
    ['Basic abc', null],
    ['Bearer', null],
    ['Bearer a b', null],
    ['Bearer token', 'token'],
    ['bearer token', 'token'],
  ])('%s → %s', (header, expected) => {
    expect(extractBearer(header)).toBe(expected);
  });
});
