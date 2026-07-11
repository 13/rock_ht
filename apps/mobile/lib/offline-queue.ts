import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "sisigo:offline_completions_queue";

export interface QueuedCompletion {
  id: string;
  habit_id: string;
  date: string;
  action: "add" | "remove";
  queued_at: string;
}

export async function enqueueCompletion(
  item: Omit<QueuedCompletion, "id" | "queued_at">
): Promise<void> {
  const queue = await getQueue();

  // If there's a pending opposite action for same habit+date, cancel them out
  const existingIdx = queue.findIndex(
    (q) => q.habit_id === item.habit_id && q.date === item.date
  );

  if (existingIdx !== -1 && queue[existingIdx]!.action !== item.action) {
    queue.splice(existingIdx, 1);
  } else if (existingIdx === -1) {
    queue.push({
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      queued_at: new Date().toISOString(),
    });
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueue(): Promise<QueuedCompletion[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getQueue();
  const filtered = queue.filter((q) => q.id !== id);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}
