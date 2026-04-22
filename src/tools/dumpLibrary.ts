import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import { getBucket } from '../lib/gcs';
import { getAllStagedSongs, clearStagedSongs, resetRegistry } from '../lib/firestore';

const DUMP_DIR = '/tmp/crate_dump';
const DUMP_ZIP = '/tmp/crate_dump.zip';

interface DumpResult {
  downloadUrl: string;
  songCount: number;
  folders: string[];
}

interface DumpError {
  error: string;
}

async function downloadFromGCS(gcsKey: string, destPath: string): Promise<void> {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });

  const bucket = getBucket();
  console.log(`[dumpLibrary] Downloading gs://dj-crate-stash/${gcsKey} → ${destPath}`);
  await bucket.file(gcsKey).download({ destination: destPath });
}

function zipDirectory(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver.create('zip', { zlib: { level: 6 } });

    output.on('close', () => {
      console.log(`[dumpLibrary] Zip created: ${outputPath} (${(archive.pointer() / 1024 / 1024).toFixed(2)} MB)`);
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.unlinkSync(p);
        }
        console.log(`[dumpLibrary] Cleaned up: ${p}`);
      }
    } catch (e: any) {
      console.warn(`[dumpLibrary] Cleanup failed for ${p}:`, e.message);
    }
  }
}

export async function dumpLibrary(): Promise<DumpResult | DumpError> {
  console.log('[dumpLibrary] Starting dump process...');

  const songs = await getAllStagedSongs();
  if (songs.length === 0) {
    console.log('[dumpLibrary] No staged songs found');
    return { error: 'No songs staged yet. Add some songs first!' };
  }

  console.log(`[dumpLibrary] ${songs.length} songs to dump:`, songs.map(s => s.gcsKey));

  // Clean slate for local tmp
  cleanup(DUMP_DIR, DUMP_ZIP);
  fs.mkdirSync(DUMP_DIR, { recursive: true });

  // Download all staged files from GCS preserving folder structure
  console.log('[dumpLibrary] Downloading files from GCS...');
  const downloadErrors: string[] = [];

  await Promise.all(songs.map(async song => {
    const destPath = path.join(DUMP_DIR, song.folder, song.filename);
    try {
      await downloadFromGCS(song.gcsKey, destPath);
    } catch (err: any) {
      console.error(`[dumpLibrary] Failed to download ${song.gcsKey}:`, err.message);
      downloadErrors.push(song.gcsKey);
    }
  }));

  if (downloadErrors.length === songs.length) {
    cleanup(DUMP_DIR);
    return { error: `Failed to download any files from storage: ${downloadErrors.join(', ')}` };
  }

  if (downloadErrors.length > 0) {
    console.warn(`[dumpLibrary] ${downloadErrors.length} files failed to download — continuing with the rest`);
  }

  // Zip the dump dir
  console.log('[dumpLibrary] Zipping...');
  try {
    await zipDirectory(DUMP_DIR, DUMP_ZIP);
  } catch (err: any) {
    console.error('[dumpLibrary] Zip failed:', err.message);
    cleanup(DUMP_DIR);
    return { error: `Failed to create zip: ${err.message}` };
  }

  // Upload zip to GCS
  const timestamp = Date.now();
  const zipKey = `dumps/crate_dump_${timestamp}.zip`;
  const bucket = getBucket();

  console.log(`[dumpLibrary] Uploading zip to gs://dj-crate-stash/${zipKey}`);
  try {
    await bucket.upload(DUMP_ZIP, {
      destination: zipKey,
      metadata: { contentType: 'application/zip' },
    });
  } catch (err: any) {
    console.error('[dumpLibrary] Zip upload failed:', err.message);
    cleanup(DUMP_DIR, DUMP_ZIP);
    return { error: `Failed to upload zip: ${err.message}` };
  }

  // Generate signed download URL.
  // Use the GCS V4 maximum of 7 days (604800 s) so the link survives any
  // realistic server clock drift and gives the user a full week to download.
  // A 1-hour TTL was previously used, which caused "expired" errors on click
  // whenever the host clock lagged behind real time by even a few minutes.
  const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 604800 s — GCS V4 max
  let downloadUrl: string;
  try {
    const [url] = await bucket.file(zipKey).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: new Date(Date.now() + SIGNED_URL_TTL_MS),
    });
    downloadUrl = url;
    console.log('[dumpLibrary] Signed URL generated (expires in 7 days)');
  } catch (err: any) {
    console.error('[dumpLibrary] Failed to generate signed URL:', err.message);
    cleanup(DUMP_DIR, DUMP_ZIP);
    return { error: `Failed to generate download URL: ${err.message}` };
  }

  // Tally results before cleanup
  const folderSet = new Set(songs.map(s => s.folder));
  const songCount = songs.length - downloadErrors.length;

  // Async cleanup — fire and forget so user gets their URL immediately
  (async () => {
    console.log('[dumpLibrary] Running async cleanup...');

    // Delete staged MP3s from GCS
    await Promise.all(songs.map(async song => {
      try {
        await bucket.file(song.gcsKey).delete();
        console.log(`[dumpLibrary] Deleted from GCS: ${song.gcsKey}`);
      } catch (e: any) {
        console.warn(`[dumpLibrary] Could not delete ${song.gcsKey}:`, e.message);
      }
    }));

    // Wipe Firestore
    await clearStagedSongs().catch(e => console.error('[dumpLibrary] clearStagedSongs failed:', e.message));
    await resetRegistry().catch(e => console.error('[dumpLibrary] resetRegistry failed:', e.message));

    // Local cleanup
    cleanup(DUMP_DIR, DUMP_ZIP);

    console.log('[dumpLibrary] ✓ Cleanup complete');
  })();

  console.log(`[dumpLibrary] ✓ Done — ${songCount} songs across ${folderSet.size} folders`);
  return {
    downloadUrl,
    songCount,
    folders: [...folderSet],
  };
}
