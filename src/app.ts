import 'dotenv/config';
import { App } from '@slack/bolt';
import { run } from './agent';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// ── Per-user message queue ────────────────────────────────────────────────────

interface QueuedMessage {
  text: string;
  channel: string;
  ts: string;
  client: any;
  userId: string;
}

const busy = new Map<string, boolean>();
const queues = new Map<string, QueuedMessage[]>();

async function processNext(userId: string): Promise<void> {
  const queue = queues.get(userId) ?? [];

  if (queue.length === 0) {
    busy.delete(userId);
    return;
  }

  const next = queue.shift()!;
  queues.set(userId, queue);
  busy.set(userId, true);

  // Update the queued placeholder from "queued" state to active
  await next.client.chat.update({
    channel: next.channel,
    ts: next.ts,
    text: '...',
  }).catch(() => {});

  try {
    await run(next.text, next.channel, next.userId, next.ts, next.client);
  } finally {
    await processNext(userId);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

app.message(async ({ message, say, client }) => {
  if (message.subtype === 'bot_message' || !('text' in message) || !message.text) return;

  const text = message.text.trim();
  const userId = (message as any).user as string;
  const channel = message.channel as string;

  console.log(`[App] DM from ${userId}: "${text}"`);

  // Always post a placeholder first so we have a ts to update in-place
  const initial = await say('...') as any;
  const ts = initial.ts as string;

  if (busy.get(userId)) {
    // User already has something processing — queue this message
    const queue = queues.get(userId) ?? [];
    queue.push({ text, channel, ts, client, userId });
    queues.set(userId, queue);

    const position = queue.length;
    const label = position === 1 ? 'queued' : `queued #${position}`;
    await client.chat.update({
      channel,
      ts,
      text: `_"${text}"_ _(${label})_`,
    }).catch(() => {});

    console.log(`[App] Queued message for ${userId} (position ${position}): "${text}"`);
    return;
  }

  // No active request — process immediately
  busy.set(userId, true);

  try {
    await run(text, channel, userId, ts, client);
  } finally {
    await processNext(userId);
  }
});

(async () => {
  const port = Number(process.env.PORT) || 3000;
  await app.start(port);
  console.log(`Crate is running on port ${port}`);
})();
