import { Global, Module } from '@nestjs/common';

import { isStrictEnv } from '@ustago/config';

import { secretFor } from '../common/crypto/secrets.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { DisabledObjectStorage } from './disabled-object-storage.js';
import { LocalObjectStorage } from './local-object-storage.js';
import { LocalStorageController } from './local-storage.controller.js';
import { MALWARE_SCANNER, NoopMalwareScanner } from './malware-scanner.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';

export function createObjectStorage(env: ApiEnv): ObjectStorage {
  switch (env.STORAGE_DRIVER) {
    case 'local':
      if (isStrictEnv(env.APP_ENV)) {
        throw new Error(`The local storage driver must not be used in ${env.APP_ENV}.`);
      }
      return new LocalObjectStorage(
        env.STORAGE_LOCAL_DIR,
        env.STORAGE_PUBLIC_BASE_URL,
        secretFor(env, 'storage', env.STORAGE_SIGNING_SECRET),
      );
    case 'disabled':
      return new DisabledObjectStorage();
  }
}

@Global()
@Module({
  controllers: [LocalStorageController],
  providers: [
    { provide: OBJECT_STORAGE, inject: [API_ENV], useFactory: createObjectStorage },
    // Only the no-op scanner exists today (MALWARE_SCANNER=none).
    { provide: MALWARE_SCANNER, useValue: new NoopMalwareScanner() },
  ],
  exports: [OBJECT_STORAGE, MALWARE_SCANNER],
})
export class StorageModule {}
