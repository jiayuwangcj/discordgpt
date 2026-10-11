import { ChannelQueue } from "./channel-queue.js";

export async function dispatchMessage(
  queue: ChannelQueue,
  key: string,
  control: () => Promise<boolean>,
  task: () => Promise<void>,
): Promise<void> {
  if (await control()) return;
  await queue.enqueue(key, task);
}
