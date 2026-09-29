import { type ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

function hostFor(url: string) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: url, method: 'GET' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('formats HTTP exceptions with a stable code', () => {
    const { host, status, json } = hostFor('/api/v1/missing');
    filter.catch(new NotFoundException('Bulunamadı'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Bulunamadı',
        path: '/api/v1/missing',
      }),
    );
  });

  it('keeps custom codes and details', () => {
    const { host, json } = hostFor('/api/v1/x');
    filter.catch(
      new BadRequestException({ code: 'VALIDATION_FAILED', message: 'x', details: [1] }),
      host,
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_FAILED', details: [1] }),
    );
  });

  it('hides internal errors', () => {
    const { host, status, json } = hostFor('/api/v1/x');
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter.catch(new Error('password=secret'), host);
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0]?.[0] as { code: string; message: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('secret');
    expect(logError).toHaveBeenCalled();
  });

  it('maps unique-constraint errors to 409 without leaking column names', () => {
    const { host, status, json } = hostFor('/api/v1/x');
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on users_email_key',
      {
        code: 'P2002',
        clientVersion: 'test',
      },
    );
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(409);
    const body = json.mock.calls[0]?.[0] as { code: string; message: string };
    expect(body.code).toBe('CONFLICT');
    expect(body.message).not.toContain('email');
  });

  it('echoes the request id', () => {
    const json = vi.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: '/x', method: 'GET', requestId: 'req-12345678' }),
        getResponse: () => ({ status: () => ({ json }) }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(new NotFoundException(), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-12345678' }));
  });
});
