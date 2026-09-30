import type { VerificationType } from '@ustago/types';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useRef, useState } from 'react';

import { errorMessage } from '../api/client';
import { providerApi } from '../api/services';
import { api } from '../api/session';
import { DOCUMENT_MIME_TYPES, documentFileError, type UploadStage } from '../lib/verification';

interface PickedFile {
  name: string;
  mimeType: string;
  blob: Blob;
}

export interface DocumentUploadState {
  stage: UploadStage;
  error: string | null;
  fileName: string | null;
  /** The last picked file is kept, so a failed upload can be retried without picking again. */
  canRetry: boolean;
}

const IDLE: DocumentUploadState = { stage: 'idle', error: null, fileName: null, canRetry: false };

/**
 * Picks a document and sends it through the existing flow: upload intent →
 * PUT to the signed URL → register the upload. One upload runs at a time;
 * each document type keeps its own stage, error and retry.
 */
export function useDocumentUpload(onUploaded: () => Promise<void>) {
  const [states, setStates] = useState<Partial<Record<VerificationType, DocumentUploadState>>>({});
  const files = useRef<Partial<Record<VerificationType, PickedFile>>>({});
  const running = useRef(false);
  const [busyType, setBusyType] = useState<VerificationType | null>(null);

  const set = useCallback((type: VerificationType, patch: Partial<DocumentUploadState>) => {
    setStates((s) => ({ ...s, [type]: { ...IDLE, ...s[type], ...patch } }));
  }, []);

  const send = useCallback(
    async (type: VerificationType, file: PickedFile) => {
      try {
        set(type, { stage: 'preparing', error: null, fileName: file.name, canRetry: false });
        const intent = await providerApi.verificationIntent({
          type,
          fileName: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.blob.size,
        });
        set(type, { stage: 'uploading' });
        await api.upload(intent.uploadUrl, file.blob, intent.headers);
        set(type, { stage: 'confirming' });
        await providerApi.submitVerification(type, intent.uploadId);
        files.current = { ...files.current, [type]: undefined };
        set(type, { stage: 'done', canRetry: false });
        await onUploaded();
      } catch (e) {
        set(type, { stage: 'failed', error: errorMessage(e), canRetry: true });
      }
    },
    [onUploaded, set],
  );

  const guard = useCallback(async (type: VerificationType, run: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusyType(type);
    try {
      await run();
    } finally {
      running.current = false;
      setBusyType(null);
    }
  }, []);

  const pick = useCallback(
    (type: VerificationType) =>
      guard(type, async () => {
        const picked = await DocumentPicker.getDocumentAsync({
          type: [...DOCUMENT_MIME_TYPES],
          copyToCacheDirectory: true,
          multiple: false,
        });
        const asset = picked.canceled ? null : picked.assets[0];
        if (!asset) return;
        let blob: Blob;
        try {
          blob = await api.readFile(asset.uri);
        } catch (e) {
          set(type, { stage: 'failed', error: errorMessage(e), canRetry: false });
          return;
        }
        const mimeType = asset.mimeType ?? blob.type;
        const invalid = documentFileError(mimeType, blob.size);
        if (invalid) {
          set(type, { stage: 'failed', error: invalid, fileName: asset.name, canRetry: false });
          return;
        }
        const file = { name: asset.name, mimeType, blob };
        files.current[type] = file;
        await send(type, file);
      }),
    [guard, send, set],
  );

  const retry = useCallback(
    (type: VerificationType) =>
      guard(type, async () => {
        const file = files.current[type];
        if (file) await send(type, file);
      }),
    [guard, send],
  );

  const stateOf = (type: VerificationType): DocumentUploadState => states[type] ?? IDLE;

  return { pick, retry, stateOf, busyType };
}
