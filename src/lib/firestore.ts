import 'dotenv/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import * as path from 'path';

let _db: Firestore | null = null;

function getDb(): Firestore {
  if (_db) return _db;

  if (!getApps().length) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const projectId = process.env.GCP_ID;

    if (credPath) {
      const absolutePath = path.isAbsolute(credPath)
        ? credPath
        : path.join(process.cwd(), credPath);
      initializeApp({ credential: cert(absolutePath), projectId });
      console.log('[Firestore] Initialized — project:', projectId, '| key file:', absolutePath);
    } else {
      initializeApp({ projectId });
      console.log('[Firestore] Initialized with application default credentials');
    }
  }

  _db = getFirestore();
  console.log('[Firestore] Connected to default database');
  return _db;
}

const MAX_HISTORY = 6;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export interface StagedSong {
  songName: string;
  artist: string;
  filename: string;
  gcsKey: string;
  folder: string;
  source: 'youtube' | 'soundcloud';
  sourceUrl: string;
  downloadedAt: string;
}

// ─── Collections ─────────────────────────────────────────────────────────────
// history/{userId}     → { turn_summary_queue: string[], last_updated: string }
// registry/main        → { folders: string[] }
// songs/{autoId}       → { type: "song", ...StagedSong }

// ─── History ─────────────────────────────────────────────────────────────────

export async function getHistory(userId: string): Promise<string[]> {
  const db = getDb();
  const docRef = db.collection('history').doc(userId);

  console.log(`[Firestore] getHistory → history/${userId}`);
  const snap = await docRef.get();

  if (!snap.exists) {
    console.log(`[Firestore] No history document found for ${userId} — starting fresh`);
    return [];
  }

  const data = snap.data()!;
  const lastUpdated = new Date(data.last_updated as string).getTime();
  const elapsedMin = Math.round((Date.now() - lastUpdated) / 60000);

  if (Date.now() - lastUpdated > SESSION_TIMEOUT_MS) {
    console.log(`[Firestore] Session timed out for ${userId} (last active ${elapsedMin}min ago) — resetting`);
    const resetEntry = 'Fresh session started due to timeout. Old history cleared.';
    await docRef.set({ turn_summary_queue: [resetEntry], last_updated: new Date().toISOString() });
    return [resetEntry];
  }

  const queue = data.turn_summary_queue as string[];
  console.log(`[Firestore] Loaded ${queue.length} history entries for ${userId} (last active ${elapsedMin}min ago)`);
  return queue;
}

export async function appendToHistory(userId: string, ...entries: string[]): Promise<void> {
  const db = getDb();
  const docRef = db.collection('history').doc(userId);

  const snap = await docRef.get();
  const queue: string[] = snap.exists ? (snap.data()!.turn_summary_queue as string[]) : [];

  for (const entry of entries) queue.push(entry);
  while (queue.length > MAX_HISTORY) queue.shift();

  await docRef.set({ turn_summary_queue: queue, last_updated: new Date().toISOString() });
  console.log(`[Firestore] History updated for ${userId}: ${queue.length} entries`);
}

// ─── Folders / Registry ──────────────────────────────────────────────────────

export async function getFolders(): Promise<string[]> {
  const db = getDb();
  const docRef = db.collection('registry').doc('main');

  const snap = await docRef.get();

  if (!snap.exists) {
    console.log('[Firestore] Registry doc missing — creating with defaults');
    const defaults = ['Manual_Review'];
    await docRef.set({ folders: defaults });
    return defaults;
  }

  const folders = snap.data()!.folders as string[];
  console.log('[Firestore] Folders:', folders);
  return folders;
}

export async function addFolder(folderName: string): Promise<void> {
  const db = getDb();
  const docRef = db.collection('registry').doc('main');
  const snap = await docRef.get();

  const folders: string[] = snap.exists ? (snap.data()!.folders as string[]) : ['Manual_Review'];

  if (folders.includes(folderName)) {
    console.log(`[Firestore] Folder "${folderName}" already exists`);
    return;
  }

  folders.push(folderName);
  await docRef.set({ folders });
  console.log(`[Firestore] Added folder: "${folderName}"`);
}

export async function resetRegistry(): Promise<void> {
  const db = getDb();
  await db.collection('registry').doc('main').set({ folders: ['Manual_Review'] });
  console.log('[Firestore] Registry reset to defaults');
}

// ─── Staged Songs ─────────────────────────────────────────────────────────────

export async function addStagedSong(data: StagedSong): Promise<void> {
  const db = getDb();
  await db.collection('songs').add({ type: 'song', ...data });
  console.log(`[Firestore] Staged: "${data.songName}" by ${data.artist} → ${data.folder}/`);
}

export async function getAllStagedSongs(): Promise<(StagedSong & { id: string })[]> {
  const db = getDb();
  const snapshot = await db.collection('songs').where('type', '==', 'song').get();
  const songs = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as StagedSong) }));
  console.log(`[Firestore] Found ${songs.length} staged songs`);
  return songs;
}

export async function clearStagedSongs(): Promise<void> {
  const db = getDb();
  const snapshot = await db.collection('songs').where('type', '==', 'song').get();

  if (snapshot.empty) {
    console.log('[Firestore] No staged songs to clear');
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  console.log(`[Firestore] Cleared ${snapshot.size} staged song records`);
}
