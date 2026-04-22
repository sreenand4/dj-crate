import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { getHistory, appendToHistory } from './lib/firestore';
import { tools, toolHandlers } from './tools/index';
import { SYSTEM_PROMPT } from './config/prompts';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Status helpers ────────────────────────────────────────────────────────────

function statusBefore(name: string, input: any): string {
  switch (name) {
    case 'searchSoundCloud':
      return `Searching SoundCloud for *${input.query}*...`;
    case 'searchYouTube':
      return `Searching YouTube for *${input.query}*...`;
    case 'downloadTrack': {
      const src = input.source === 'youtube' ? 'YouTube' : 'SoundCloud';
      return `Downloading *${input.artist} — ${input.songName}* from ${src}...`;
    }
    case 'stageFile':
      return `Filing *${input.songName}* into your library...`;
    case 'getFolders':
      return `Checking your folders...`;
    case 'createFolder':
      return `Creating folder *${input.folderName}*...`;
    case 'dumpLibrary':
      return `Packing your crate...`;
    default:
      return `Running ${name}...`;
  }
}

function statusAfter(name: string, input: any, result: any): string | null {
  switch (name) {
    case 'searchSoundCloud': {
      if (!Array.isArray(result) || result.length === 0) {
        return `Nothing on SoundCloud — trying YouTube...`;
      }
      const top = result[0];
      return `Found *<${top.url}|${top.title}>* by ${top.user} on SoundCloud`;
    }
    case 'searchYouTube': {
      if (!Array.isArray(result) || result.length === 0) {
        return `No YouTube results found.`;
      }
      const top = result[0];
      return `Found *<${top.url}|${top.title}>* by ${top.channelTitle} on YouTube`;
    }
    case 'downloadTrack': {
      if (result?.error) {
        return `Download failed — ${result.error}`;
      }
      const src = input.source === 'youtube' ? 'YouTube' : 'SoundCloud';
      return `Downloaded *${input.artist} — ${input.songName}* from ${src} ✓`;
    }
    case 'stageFile': {
      if (result?.error) {
        return `Failed to save — ${result.error}`;
      }
      return `Saved *${input.songName}* to *${result.folder}/* ✓`;
    }
    case 'dumpLibrary': {
      if (result?.error) return null;
      return `Zipped ${result.songCount} track${result.songCount === 1 ? '' : 's'} across ${result.folders?.length ?? '?'} folder${result.folders?.length === 1 ? '' : 's'} — uploading...`;
    }
    default:
      return null;
  }
}

// ── Main agent loop ───────────────────────────────────────────────────────────

export async function run(
  text: string,
  channel: string,
  userId: string,
  ts: string,
  client: any
): Promise<void> {
  console.log(`\n[Agent] ━━━ New request from ${userId} ━━━`);
  console.log(`[Agent] Message: "${text}"`);

  const slackUpdate = (msg: string) =>
    client.chat.update({ channel, ts, text: msg }).catch((e: any) =>
      console.warn(`[Agent] Slack update failed: ${e.message}`)
    );

  try {
    console.log('[Agent] Loading conversation history from Firestore...');
    const history = await getHistory(userId);

    const historyBlock = history.length > 0
      ? 'Conversation history:\n' + history.map(e => `- ${e}`).join('\n')
      : 'No prior conversation history.';

    const userContent = `${historyBlock}\n\nCurrent request: ${text}`;

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: userContent },
    ];

    console.log(`[Agent] History loaded (${history.length} entries). Entering Claude loop...`);

    let finalResponse = '';
    const MAX_ITERATIONS = 10;

    for (let i = 1; i <= MAX_ITERATIONS; i++) {
      console.log(`[Agent] Loop iteration ${i}/${MAX_ITERATIONS}`);

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      console.log(`[Agent] Claude responded — stop_reason: "${response.stop_reason}", blocks: ${response.content.length}`);

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        finalResponse = response.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();

        console.log(`[Agent] Final response (${finalResponse.length} chars): "${finalResponse.slice(0, 120)}"`);
        break;
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
      );

      console.log(`[Agent] Tool calls: ${toolUseBlocks.map(b => b.name).join(', ')}`);

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`[Agent] → Calling "${toolUse.name}" with:`, JSON.stringify(toolUse.input).slice(0, 200));

        // Pre-tool status — say what we're about to do with specifics
        slackUpdate(statusBefore(toolUse.name, toolUse.input));

        const handler = toolHandlers[toolUse.name];
        let result: unknown;

        if (!handler) {
          console.error(`[Agent] No handler registered for tool: "${toolUse.name}"`);
          result = { error: `Tool "${toolUse.name}" is not implemented` };
        } else {
          result = await handler(toolUse.input);
        }

        console.log(`[Agent] ← "${toolUse.name}" result: ${JSON.stringify(result).slice(0, 300)}`);

        // Post-tool status — show what we actually got back
        const after = statusAfter(toolUse.name, toolUse.input, result);
        if (after) slackUpdate(after);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: 'user', content: toolResults });

      if (i === MAX_ITERATIONS) {
        finalResponse = '⚠️ Something went wrong — took too many steps. Please try again.';
        console.warn('[Agent] Hit max iterations limit');
      }
    }

    await client.chat.update({ channel, ts, text: finalResponse });
    console.log('[Agent] Slack message updated — user has their response');

    appendToHistory(userId, `User said: ${text}`, `Agent: ${finalResponse}`)
      .then(() => console.log('[Agent] History persisted to Firestore'))
      .catch((e: any) => console.error('[Agent] Failed to persist history:', e.message));

  } catch (err: any) {
    console.error('[Agent] Fatal error:', err);
    try {
      await client.chat.update({ channel, ts, text: '❌ Something went wrong. Try again.' });
    } catch (slackErr: any) {
      console.error('[Agent] Could not even send error message to Slack:', slackErr.message);
    }
  }
}
