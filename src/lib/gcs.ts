import 'dotenv/config';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';

let _storage: Storage | null = null;

export const BUCKET_NAME = 'dj-crate-stash';

export function getStorage(): Storage {
  if (_storage) return _storage;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCP_ID;

  if (credPath) {
    const keyFilename = path.isAbsolute(credPath)
      ? credPath
      : path.join(process.cwd(), credPath);
    _storage = new Storage({ projectId, keyFilename });
    console.log('[GCS] Initialized with key file:', keyFilename);
  } else {
    _storage = new Storage({ projectId });
    console.log('[GCS] Initialized with application default credentials');
  }

  return _storage;
}

export function getBucket() {
  return getStorage().bucket(BUCKET_NAME);
}
