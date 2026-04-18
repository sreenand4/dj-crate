import 'dotenv/config';
import { App } from '@slack/bolt';
import { run } from './agent';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

app.message(async ({ message, say, client }) => {
  if (message.subtype === 'bot_message' || !('text' in message) || !message.text) return;

  const text = message.text.trim();
  const userId = (message as any).user as string;
  const channel = message.channel as string;

  console.log(`[App] DM from ${userId}: "${text}"`);

  // Post a holding message so we have a ts to update in-place
  const initial = await say('...') as any;
  const ts = initial.ts as string;

  await run(text, channel, userId, ts, client);
});

(async () => {
  const port = Number(process.env.PORT) || 3000;
  await app.start(port);
  console.log(`Crate is running on port ${port}`);
})();
