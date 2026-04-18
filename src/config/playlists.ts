// default playlist folder — agent will intelligently organize files and songs within them
export const KNOWN_FOLDERS = [
  'Manual_Review',
] as const;

export type KnownFolder = typeof KNOWN_FOLDERS[number];
