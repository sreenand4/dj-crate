import * as fs from 'fs';
import * as path from 'path';
import { getBucket } from '../lib/gcs';
import { addStagedSong } from '../lib/firestore';

interface StageFileInput {
  localPath: string;
  folder: string;
  songName: string;
  artist: string;
  source: string;
  sourceUrl: string;
}

interface StageFileResult {
  gcsKey: string;
  folder: string;
  filename: string;
}

interface StageFileError {
  error: string;
}

export async function stageFile(
  input: StageFileInput
): Promise<StageFileResult | StageFileError> {
  const { localPath, folder, songName, artist, source, sourceUrl } = input;

  console.log(`[stageFile] Staging "${path.basename(localPath)}" → ${folder}/`);

  if (!fs.existsSync(localPath)) {
    console.error(`[stageFile] Local file not found: ${localPath}`);
    return { error: `File not found at path: ${localPath}` };
  }

  const filename = path.basename(localPath);
  const gcsKey = `${folder}/${filename}`;

  try {
    const bucket = getBucket();
    console.log(`[stageFile] Uploading to GCS: gs://dj-crate-stash/${gcsKey}`);

    await bucket.upload(localPath, {
      destination: gcsKey,
      metadata: { contentType: 'audio/mpeg' },
    });

    const stats = fs.statSync(localPath);
    console.log(`[stageFile] ✓ Uploaded ${(stats.size / 1024 / 1024).toFixed(2)} MB to GCS`);

    // Delete local temp file — fire and forget
    fs.unlink(localPath, err => {
      if (err) console.warn(`[stageFile] Could not delete temp file ${localPath}:`, err.message);
      else console.log(`[stageFile] Cleaned up local temp file: ${localPath}`);
    });

    // Write to Firestore — fire and forget
    addStagedSong({
      songName,
      artist,
      filename,
      gcsKey,
      folder,
      source: source as 'youtube' | 'soundcloud',
      sourceUrl,
      downloadedAt: new Date().toISOString(),
    }).catch(e => console.error('[stageFile] Firestore write failed:', e.message));

    console.log(`[stageFile] ✓ "${songName}" staged in ${folder}/`);
    return { gcsKey, folder, filename };

  } catch (err: any) {
    console.error('[stageFile] GCS upload failed:', err.message);
    return { error: `Upload failed: ${err.message}` };
  }
}
