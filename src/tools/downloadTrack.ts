import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BASE_DIR = '/tmp/crate_downloads';
const TIMEOUT_MS = 120_000;

const HOME = process.env.HOME ?? '';
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const COOKIES = process.env.YTDLP_COOKIES || '';
const EXEC_ENV = {
  ...process.env,
  PATH: [
    `${HOME}/.pyenv/shims`,
    `${HOME}/.pyenv/versions/3.12.7/bin`,
    `${HOME}/.pyenv/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    `${HOME}/.local/bin`,
    process.env.PATH ?? '',
  ].join(':'),
};

interface DownloadInput {
  url: string;
  source: 'youtube' | 'soundcloud';
  songName: string;
  artist: string;
}

interface DownloadSuccess {
  localPath: string;
  filename: string;
}

interface DownloadError {
  error: string;
}

function sanitize(str: string): string {
  return str
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, 60);
}

function execWithTimeout(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { timeout: TIMEOUT_MS, env: EXEC_ENV }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          reject(new Error(`Command timed out after ${TIMEOUT_MS / 1000}s`));
        } else {
          reject(Object.assign(err, { stdout, stderr }));
        }
        return;
      }
      resolve({ stdout, stderr });
    });

    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, TIMEOUT_MS + 2000);
  });
}

// yt-dlp handles both YouTube and SoundCloud — scdl is no longer used.
// SoundCloud URLs come directly from searchSoundCloud (real sc URLs via yt-dlp scsearch).
async function ytdlpDownload(
  url: string,
  filename: string,
  platform: string
): Promise<DownloadSuccess | DownloadError> {
  const outputTemplate = path.join(BASE_DIR, `${filename}.%(ext)s`);
  const expectedPath = path.join(BASE_DIR, `${filename}.mp3`);

  const cmd = [
    YTDLP,
    '--extract-audio',
    '--audio-format mp3',
    '--audio-quality 320K',
    '--no-playlist',
    ...(platform === 'youtube' && COOKIES ? [`--cookies "${COOKIES}"`] : []),
    `--output "${outputTemplate}"`,
    `"${url}"`,
  ].join(' ');

  console.log(`[downloadTrack] [${platform}] yt-dlp command:\n  ${cmd}`);

  try {
    const { stdout, stderr } = await execWithTimeout(cmd);
    console.log('[downloadTrack] yt-dlp stdout:', stdout.slice(-500));
    if (stderr) console.log('[downloadTrack] yt-dlp stderr:', stderr.slice(-300));
  } catch (err: any) {
    console.error('[downloadTrack] yt-dlp failed:', err.message);
    if (err.stderr) console.error('[downloadTrack] yt-dlp stderr:', (err.stderr as string).slice(-400));
    return { error: `yt-dlp failed: ${err.message}` };
  }

  if (!fs.existsSync(expectedPath)) {
    const nearby = fs.readdirSync(BASE_DIR).filter(f => f.startsWith(filename));
    console.error(`[downloadTrack] Expected file not found: ${expectedPath}`);
    console.error('[downloadTrack] Files with matching name prefix:', nearby);
    return { error: `File not found after download: ${expectedPath}` };
  }

  const stats = fs.statSync(expectedPath);
  console.log(`[downloadTrack] ✓ ${platform} download complete: ${expectedPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  return { localPath: expectedPath, filename: `${filename}.mp3` };
}

export async function downloadTrack(
  input: DownloadInput
): Promise<DownloadSuccess | DownloadError> {
  const { url, source, songName, artist } = input;

  fs.mkdirSync(BASE_DIR, { recursive: true });

  const safeArtist = sanitize(artist);
  const safeSong = sanitize(songName);
  const filename = `${safeArtist}-${safeSong}`;

  console.log(`[downloadTrack] Starting — source=${source}, output="${filename}.mp3"`);
  console.log(`[downloadTrack] URL: ${url}`);

  return ytdlpDownload(url, filename, source);
}
