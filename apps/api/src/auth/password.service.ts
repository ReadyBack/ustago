import { type Algorithm, hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Argon2id with the OWASP-recommended baseline (19 MiB, 2 passes, 1 lane).
 * The encoded hash carries its own salt and parameters.
 */
const OPTIONS = {
  // Algorithm.Argon2id; the enum is a const enum, unusable with isolatedModules.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  /** Hash of a random string, verified when the user does not exist so the
   * response time does not reveal whether an e-mail is registered. */
  private dummyHash: Promise<string> | undefined;

  hash(plain: string): Promise<string> {
    return hash(plain, OPTIONS);
  }

  async verify(encoded: string, plain: string): Promise<boolean> {
    try {
      return await verify(encoded, plain);
    } catch {
      // Malformed hash: treat as a failed match, never as a crash.
      return false;
    }
  }

  /** Burns the same CPU as a real verification and always returns false. */
  async verifyAgainstDummy(plain: string): Promise<false> {
    this.dummyHash ??= this.hash(`dummy-${Math.random()}`);
    await this.verify(await this.dummyHash, plain);
    return false;
  }
}
