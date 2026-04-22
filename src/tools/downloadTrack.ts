import 'dotenv/config';

const CRATE_DL_URL = (process.env.CRATE_DL_URL ?? '').replace(/\/$/, '');
const CRATE_DL_SECRET = process.env.CRATE_DL_SECRET ?? '';

interface DownloadInput {
  url: string;
  source: 'youtube' | 'soundcloud';
  songName: string;
  artist: string;
}

interface DownloadSuccess {
  gcsKey: string;
  filename: string;
}

interface DownloadError {
  error: string;
  retriable?: boolean;
}

export async function downloadTrack(
  input: DownloadInput
): Promise<DownloadSuccess | DownloadError> {
  const { url, source, songName, artist } = input;

  if (!CRATE_DL_URL) {
    return { error: 'CRATE_DL_URL is not configured on this service' };
  }
  if (!CRATE_DL_SECRET) {
    return { error: 'CRATE_DL_SECRET is not configured on this service' };
  }

  console.log(`[downloadTrack] Delegating to crate-dl — source=${source} artist="${artist}" song="${songName}"`);
  console.log(`[downloadTrack] URL: ${url}`);

  let response: Response;
  try {
    response = await fetch(`${CRATE_DL_URL}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CRATE_DL_SECRET}`,
      },
      body: JSON.stringify({ url, source, songName, artist }),
    });
  } catch (err: any) {
    console.error('[downloadTrack] Network error calling crate-dl:', err.message);
    return { error: `Could not reach download service: ${err.message}`, retriable: true };
  }

  let body: any;
  try {
    body = await response.json();
  } catch {
    return { error: `crate-dl returned non-JSON response (status ${response.status})` };
  }

  if (!response.ok) {
    console.error(`[downloadTrack] crate-dl error (${response.status}):`, body);
    return {
      error: body?.error ?? `Download service returned ${response.status}`,
      retriable: body?.retriable ?? false,
    };
  }

  const { gcsKey, filename } = body as DownloadSuccess;
  console.log(`[downloadTrack] ✓ crate-dl succeeded — gcsKey=${gcsKey}`);
  return { gcsKey, filename };
}
