import { getFolders as _getFolders } from '../lib/firestore';

export async function getFolders(): Promise<{ folders: string[] }> {
  console.log('[getFolders] Fetching folder list from Firestore...');
  const folders = await _getFolders();
  return { folders };
}
