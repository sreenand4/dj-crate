import * as path from 'path';
import { getBucket } from '../lib/gcs';
import { addStagedSong } from '../lib/firestore';

interface StageFileInput {
  gcsKey: string;
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
  const { gcsKey, folder, songName, artist, source, sourceUrl } = input;

  const filename = path.basename(gcsKey);
  const destKey = `${folder}/${filename}`;

  console.log(`[stageFile] Moving gs://dj-crate-stash/${gcsKey} → ${destKey}`);

  try {
    const bucket = getBucket();
    const srcFile = bucket.file(gcsKey);
    const destFile = bucket.file(destKey);

    // GCS server-side copy — no data travels through this process
    await srcFile.copy(destFile, { metadata: { contentType: 'audio/mpeg' } });
    console.log(`[stageFile] ✓ Copied to gs://dj-crate-stash/${destKey}`);

    // Delete the temp object — fire and forget
    srcFile.delete().catch((err: any) =>
      console.warn(`[stageFile] Could not delete temp object ${gcsKey}:`, err.message)
    );

    // Write to Firestore — fire and forget
    addStagedSong({
      songName,
      artist,
      filename,
      gcsKey: destKey,
      folder,
      source: source as 'youtube' | 'soundcloud',
      sourceUrl,
      downloadedAt: new Date().toISOString(),
    }).catch((e: any) => console.error('[stageFile] Firestore write failed:', e.message));

    console.log(`[stageFile] ✓ "${songName}" staged in ${folder}/`);
    return { gcsKey: destKey, folder, filename };

  } catch (err: any) {
    console.error('[stageFile] GCS copy failed:', err.message);
    return { error: `Stage failed: ${err.message}` };
  }
}
