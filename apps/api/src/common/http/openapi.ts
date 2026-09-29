import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse, type SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/** Converts a shared Zod schema to an OpenAPI 3.0 schema for Swagger. */
export function openApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'output'): SchemaObject {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as SchemaObject;
}

export const ApiZodBody = (schema: z.ZodType) =>
  ApiBody({ schema: openApiSchema(schema, 'input') });

export const ApiZodResponse = (status: number, schema: z.ZodType, description?: string) =>
  applyDecorators(
    ApiResponse({ status, schema: openApiSchema(schema), ...(description ? { description } : {}) }),
  );
