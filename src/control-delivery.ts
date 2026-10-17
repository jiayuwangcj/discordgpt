import { ChannelQueue } from "./channel-queue.js";

/** Serialize state changes, then deliver acknowledgements outside the control lock. */
export async function executeControl<T>(queue: ChannelQueue, key: string,
  action: (reply: (payload: any) => Promise<void>) => Promise<T>,
  deliver: (payload: any) => Promise<unknown>, onFailure: (error: unknown) => void): Promise<T> {
  const replies: any[] = [];
  const result = await queue.enqueue(key, () => action(async payload => { replies.push(payload); }));
  for (const payload of replies) {
    try { await deliver(payload); }
    catch (error) { onFailure(error); break; }
  }
  // A failed acknowledgement does not undo a successfully persisted model change.
  return result;
}

function transient(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: any = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (["ERR_SSL_PACKET_LENGTH_TOO_LONG", "ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(current.code)) return true;
    current = current.cause;
  }
  return false;
}

/** Only retry the idempotent PATCH of an existing interaction reply, not mutations or POSTs. */
export async function retryEditReply<T>(edit: () => Promise<T>,
  pause: (ms: number) => Promise<unknown> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await edit(); }
    catch (error) {
      if (attempt >= 2 || !transient(error)) throw error;
      await pause(attempt === 0 ? 250 : 750);
    }
  }
}
