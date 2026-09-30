import type { UploadIntentResponse } from '@ustago/types';
import * as ImagePicker from 'expo-image-picker';

import { ApiError } from '../api/client';
import { api } from '../api/session';

export type ImageMime = 'image/jpeg' | 'image/png';

export interface PickedImage {
  uri: string;
  mimeType: ImageMime;
  blob: Blob;
}

/** 10 MB, the same limit as request photos; the server checks it again. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Lets the user pick one JPEG/PNG from the library; null when cancelled. */
export async function pickImage(): Promise<PickedImage | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
  });
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;
  const mime =
    asset.mimeType ?? (asset.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
  if (mime !== 'image/jpeg' && mime !== 'image/png') {
    throw new ApiError(422, 'INVALID_IMAGE', 'Yalnızca JPEG veya PNG fotoğraf ekleyebilirsiniz.');
  }
  const blob = await api.readFile(asset.uri);
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new ApiError(422, 'INVALID_IMAGE', 'Fotoğraf en fazla 10 MB olabilir.');
  }
  return { uri: asset.uri, mimeType: mime, blob };
}

/**
 * Upload intent → PUT the file to the signed URL (exactly like request
 * photos). Returns the upload id the next API call refers to.
 */
export async function uploadImage(
  image: PickedImage,
  intent: (mimeType: ImageMime, sizeBytes: number) => Promise<UploadIntentResponse>,
): Promise<string> {
  const created = await intent(image.mimeType, image.blob.size);
  await api.upload(created.uploadUrl, image.blob, created.headers);
  return created.uploadId;
}
