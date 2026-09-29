import { type ObjectStorage, StorageUnavailableError } from './object-storage.js';

/** Uploads switched off (production until an S3-compatible driver exists). */
export class DisabledObjectStorage implements ObjectStorage {
  readonly driver = 'disabled';

  createUploadUrl(): never {
    throw new StorageUnavailableError();
  }
  createDownloadUrl(): never {
    throw new StorageUnavailableError();
  }
  head(): never {
    throw new StorageUnavailableError();
  }
  readPrefix(): never {
    throw new StorageUnavailableError();
  }
  delete(): never {
    throw new StorageUnavailableError();
  }
}
