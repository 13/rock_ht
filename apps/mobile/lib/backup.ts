import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { parseBackup, type LocalStore } from "@rock_ht/local-db";
import { today } from "@rock_ht/utils";

/** Writes the backup to the cache dir and opens the share sheet (Save to Files, Drive, email…). */
export async function exportToShareSheet(store: LocalStore, userId: string): Promise<void> {
  const backup = await store.exportBackup(userId);
  const file = new File(Paths.cache, `rock-backup-${today()}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(backup));
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Save rock backup" });
}

/** Returns null when the user cancels the picker. Throws BackupError for foreign files. */
export async function importFromPicker(
  store: LocalStore,
  userId: string,
): Promise<{ imported: number; skipped: number } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
  if (res.canceled) return null;
  const text = await new File(res.assets[0]!.uri).text();
  return store.importBackup(userId, parseBackup(text));
}
