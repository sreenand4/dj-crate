import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { getHistory, appendToHistory } from './lib/firestore';
import { tools, toolHandlers } from './tools/index';
import { SYSTEM_PROMPT } from './config/prompts';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STATUS_MESSAGES: Record<string, string> = {
  searchYouTube: '⚙️ Scraping YouTube...',
  searchSoundCloud: '⚙️ Scraping SoundCloud...',
  downloadTrack: '⇩ Downloading track...',
  stageFile: 'Saving to your library...',
  getFolders: 'Checking folders...',
  createFolder: 'Creating new folder...',
  dumpLibrary: '🎁 Packing your crate...',
};

function statusFor(toolName: string): string {
  return STATUS_MESSAGES[toolName] ?? `⚙️ Running ${toolName}...`;
}

export async function run(
  text: string,
  channel: string,
  userId: string,
  ts: string,
  client: any
): Promise<void> {
  console.log(`\n[Agent] ━━━ New request from ${userId} ━━━`);
  console.log(`[Agent] Message: "${text}"`);

  try {
    // ── Pre-LLM: load history ────────────────────────────────────────────────
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

    // ── Agentic loop ──────────────────────────────────────────────────────────
    let finalResponse = '';
    const MAX_ITERATIONS = 10;

    for (let i = 1; i <= MAX_ITERATIONS; i++) {
      console.log(`[Agent] Loop iteration ${i}/${MAX_ITERATIONS}`);

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      console.log(`[Agent] Claude responded — stop_reason: "${response.stop_reason}", blocks: ${response.content.length}`);

      messages.push({ role: 'assistant', content: response.content });

      // No tool use → final answer
      if (response.stop_reason !== 'tool_use') {
        finalResponse = response.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();

        console.log(`[Agent] Final response (${finalResponse.length} chars): "${finalResponse.slice(0, 120)}"`);
        break;
      }

      // ── Process tool calls ─────────────────────────────────────────────────
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
      );

      console.log(`[Agent] Tool calls: ${toolUseBlocks.map(b => b.name).join(', ')}`);

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`[Agent] → Calling "${toolUse.name}" with:`, JSON.stringify(toolUse.input).slice(0, 200));

        // Update Slack status immediately — fire and forget
        client.chat.update({ channel, ts, text: statusFor(toolUse.name) }).catch((e: any) =>
          console.warn(`[Agent] Slack status update failed: ${e.message}`)
        );

        const handler = toolHandlers[toolUse.name];
        let result: unknown;

        if (!handler) {
          console.error(`[Agent] No handler registered for tool: "${toolUse.name}"`);
          result = { error: `Tool "${toolUse.name}" is not implemented` };
        } else {
          result = await handler(toolUse.input);
        }

        const resultPreview = JSON.stringify(result).slice(0, 300);
        console.log(`[Agent] ← "${toolUse.name}" result: ${resultPreview}`);

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

    // ── Respond to user immediately ───────────────────────────────────────────
    await client.chat.update({ channel, ts, text: finalResponse });
    console.log('[Agent] Slack message updated — user has their response');

    // ── Post-LLM Firestore write — fire and forget ────────────────────────────
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
