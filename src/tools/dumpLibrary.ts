import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import { getBucket } from '../lib/gcs';
import { getAllStagedSongs, clearStagedSongs, resetRegistry } from '../lib/firestore';

const DUMP_DIR = '/tmp/crate_dump';
const DUMP_ZIP = '/tmp/crate_dump.zip';

/** GCS V4 read URLs allow at most 7 days from signing time (same limit enforced by @google-cloud/storage). */
const SIGNED_URL_MAX_MS = 7 * 24 * 60 * 60 * 1000;

interface DumpResult {
  downloadUrl: string;
  /** ISO-8601 UTC — link stops working after this instant. */
  downloadUrlExpiresAt: string;
  songCount: number;
  folders: string[];
}

interface DumpError {
  error: string;
}

async function downloadFromGCS(
  gcsKey: string,
  destPath: string,
  label: string,
): Promise<void> {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });

  const bucket = getBucket();
  const t0 = Date.now();
  console.log(`[dumpLibrary] ${label} ▶ downloading gs://dj-crate-stash/${gcsKey}`);
  await bucket.file(gcsKey).download({ destination: destPath });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  let sizeStr = '?';
  try {
    const bytes = fs.statSync(destPath).size;
    sizeStr = `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  } catch { /* non-fatal */ }
  console.log(`[dumpLibrary] ${label} ✓ done in ${elapsed}s (${sizeStr})`);
}

function zipDirectory(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver.create('zip', { zlib: { level: 6 } });
    let lastProgressLog = Date.now();

    output.on('close', () => {
      console.log(`[dumpLibrary] Zip complete: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
      resolve();
    });
    archive.on('error', reject);
    archive.on('progress', ({ entries, fs: arcFs }) => {
      const now = Date.now();
      if (now - lastProgressLog >= 5000) {
        lastProgressLog = now;
        console.log(
          `[dumpLibrary] Zipping... ${entries.processed}/${entries.total} files,` +
          ` ${(arcFs.processedBytes / 1024 / 1024).toFixed(2)} MB processed`,
        );
      }
    });
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
  const dumpT0 = Date.now();
  console.log('[dumpLibrary] ── Starting dump ──────────────────────────────');

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
  console.log(`[dumpLibrary] Downloading ${songs.length} files from GCS in parallel...`);
  const downloadErrors: string[] = [];
  let completed = 0;

  await Promise.all(songs.map(async (song, i) => {
    const label = `[${i + 1}/${songs.length}] ${song.filename}`;
    const destPath = path.join(DUMP_DIR, song.folder, song.filename);
    try {
      await downloadFromGCS(song.gcsKey, destPath, label);
      completed++;
      console.log(`[dumpLibrary] Progress: ${completed}/${songs.length} downloads complete`);
    } catch (err: any) {
      console.error(`[dumpLibrary] ✗ Failed to download ${song.gcsKey}:`, err.message);
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

  // Log total size of downloaded files
  let totalBytes = 0;
  try {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else totalBytes += fs.statSync(full).size;
      }
    };
    walk(DUMP_DIR);
    console.log(`[dumpLibrary] Total downloaded size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB across ${songs.length - downloadErrors.length} files`);
  } catch (e: any) {
    console.warn('[dumpLibrary] Could not calculate total size:', e.message);
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

  // Log zip file size before uploading
  try {
    const zipBytes = fs.statSync(DUMP_ZIP).size;
    console.log(`[dumpLibrary] Zip file size: ${(zipBytes / 1024 / 1024).toFixed(2)} MB`);
  } catch (e: any) {
    console.warn('[dumpLibrary] Could not stat zip file:', e.message);
  }

  // Upload zip to GCS
  const timestamp = Date.now();
  const zipKey = `dumps/crate_dump_${timestamp}.zip`;
  const bucket = getBucket();

  console.log(`[dumpLibrary] Starting GCS upload → gs://dj-crate-stash/${zipKey}`);
  const uploadT0 = Date.now();
  try {
    await bucket.upload(DUMP_ZIP, {
      destination: zipKey,
      metadata: { contentType: 'application/zip' },
    });
    console.log(`[dumpLibrary] GCS upload complete in ${((Date.now() - uploadT0) / 1000).toFixed(1)}s — gs://dj-crate-stash/${zipKey}`);
  } catch (err: any) {
    console.error('[dumpLibrary] Zip upload failed:', err.message);
    cleanup(DUMP_DIR, DUMP_ZIP);
    return { error: `Failed to upload zip: ${err.message}` };
  }

  // GCS V4 signed URL — use max allowed lifetime so links stay valid if Slack/history replays
  // or the user downloads later. (Still finite: never paste URLs from old tool results.)
  const expiresAt = new Date(Date.now() + SIGNED_URL_MAX_MS);
  console.log(`[dumpLibrary] Signing URL — now=${new Date().toISOString()} expires=${expiresAt.toISOString()}`);

  let downloadUrl: string;
  try {
    const [url] = await bucket.file(zipKey).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });
    downloadUrl = url;
    console.log(`[dumpLibrary] Signed URL generated (expires ${expiresAt.toISOString()})`);
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

  const totalSec = ((Date.now() - dumpT0) / 1000).toFixed(1);
  console.log(`[dumpLibrary] ✓ Done — ${songCount} songs across ${folderSet.size} folders in ${totalSec}s`);
  return {
    downloadUrl,
    downloadUrlExpiresAt: expiresAt.toISOString(),
    songCount,
    folders: [...folderSet],
  };
}
