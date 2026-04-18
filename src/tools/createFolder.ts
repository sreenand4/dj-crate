import { addFolder } from '../lib/firestore';

interface CreateFolderInput {
  folderName: string;
}

export async function createFolder(
  input: CreateFolderInput
): Promise<{ created: boolean; folderName: string } | { error: string }> {
  const { folderName } = input;
  console.log(`[createFolder] Creating new folder: "${folderName}"`);

  try {
    await addFolder(folderName);
    console.log(`[createFolder] ✓ Folder "${folderName}" created`);
    return { created: true, folderName };
  } catch (err: any) {
    console.error(`[createFolder] Failed to create folder "${folderName}":`, err.message);
    return { error: err.message };
  }
}
