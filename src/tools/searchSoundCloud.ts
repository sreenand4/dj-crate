interface SoundCloudResult {
  title: string;
  user: string;
  url: string;
}

interface SearchSoundCloudInput {
  query: string;
}

function extractUser(url: string): string {
  const match = url.match(/soundcloud\.com\/([^/?#]+)\//);
  return match ? match[1].replace(/-/g, ' ') : 'Unknown';
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*\|\s*Free[^|]*/i, '')
    .replace(/\s*\|\s*Listen[^|]*/i, '')
    .replace(/\s*on SoundCloud.*/i, '')
    .trim();
}

function isTrackUrl(url: string): boolean {
  if (!url.startsWith('https://soundcloud.com/')) return false;
  if (url.includes('/sets/')) return false;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length >= 2;
  } catch {
    return false;
  }
}

export async function searchSoundCloud(input: SearchSoundCloudInput): Promise<SoundCloudResult[]> {
  const { query } = input;
  const apiKey = process.env.BRAVE_SEARCH_KEY;

  if (!apiKey) {
    console.error('[searchSoundCloud] Missing BRAVE_SEARCH_KEY env var');
    return [];
  }

  console.log(`[searchSoundCloud] Searching SoundCloud via Brave for: "${query}"`);

  const params = new URLSearchParams({
    q: `site:soundcloud.com ${query}`,
    count: '5',
  });

  let data: any;
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[searchSoundCloud] Brave API error ${res.status}:`, text.slice(0, 200));
      return [];
    }
    data = await res.json();
  } catch (err: any) {
    console.error('[searchSoundCloud] Network error:', err.message);
    return [];
  }

  const items: any[] = data.web?.results ?? [];
  console.log(`[searchSoundCloud] Got ${items.length} raw results from Brave`);

  const results: SoundCloudResult[] = items
    .map((item: any) => ({
      url: (item.url ?? '') as string,
      title: cleanTitle(item.title ?? ''),
      user: extractUser(item.url ?? ''),
    }))
    .filter(r => isTrackUrl(r.url))
    .slice(0, 3);

  if (results.length === 0) {
    console.warn('[searchSoundCloud] No track results returned from Brave');
  } else {
    results.forEach((r, i) =>
      console.log(`[searchSoundCloud] ${i + 1}. "${r.title}" by ${r.user} — ${r.url}`)
    );
  }

  return results;
}
