const VARIANT_TERMS = [
  'slowed', 'reverb', 'sped up', 'nightcore', 'cover',
  'reaction', 'extended mix', ' hour', ' hours', 'tutorial',
];

interface YouTubeResult {
  title: string;
  channelTitle: string;
  videoId: string;
  url: string;
  score: number;
}

interface SearchYouTubeInput {
  query: string;
  excludeVariants: boolean;
}

function scoreResult(title: string, channelTitle: string): number {
  const t = title.toLowerCase();
  const c = channelTitle.toLowerCase();
  let score = 0;

  // Audio beats video — a clean audio rip is more useful for a DJ than a music video
  if (t.includes('official audio')) score += 4;
  if (t.includes('official video') || t.includes('official music video')) score += 2;
  if (t.includes('lyrics')) score += 1;
  if (c.includes('vevo')) score += 2;

  return score;
}

export async function searchYouTube(input: SearchYouTubeInput): Promise<YouTubeResult[]> {
  const { query, excludeVariants } = input;
  const apiKey = process.env.YT_DATA;

  if (!apiKey) {
    console.error('[searchYouTube] YT_DATA env var is not set');
    return [];
  }

  console.log(`[searchYouTube] Searching YouTube for: "${query}" (excludeVariants=${excludeVariants})`);

  const params = new URLSearchParams({
    q: query,
    part: 'snippet',
    type: 'video',
    maxResults: '10',
    key: apiKey,
  });

  let data: any;
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!res.ok) {
      const err = await res.text();
      console.error(`[searchYouTube] API error ${res.status}:`, err.slice(0, 200));
      return [];
    }
    data = await res.json();
  } catch (err: any) {
    console.error('[searchYouTube] Network error:', err.message);
    return [];
  }

  const items: any[] = data.items ?? [];
  console.log(`[searchYouTube] Got ${items.length} raw results`);

  let candidates = items.map((item: any) => ({
    title: item.snippet.title as string,
    channelTitle: item.snippet.channelTitle as string,
    videoId: item.id.videoId as string,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    score: 0,
  }));

  if (excludeVariants) {
    const before = candidates.length;
    candidates = candidates.filter(c => {
      const t = c.title.toLowerCase();
      return !VARIANT_TERMS.some(term => t.includes(term));
    });
    console.log(`[searchYouTube] After variant filter: ${candidates.length}/${before} remain`);
  }

  candidates = candidates.map(c => ({
    ...c,
    score: scoreResult(c.title, c.channelTitle),
  }));

  candidates.sort((a, b) => b.score - a.score);
  const top3 = candidates.slice(0, 3);

  console.log('[searchYouTube] Top results:');
  top3.forEach((r, i) => console.log(`  ${i + 1}. [score:${r.score}] "${r.title}" — ${r.channelTitle}`));

  return top3;
}
