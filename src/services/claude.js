/**
 * Claude API service — parses user's freetext into completed task IDs.
 * Uses claude-haiku-4-5 (fast, cheap, ~$0.001 per message).
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Given the user's message and today's task list, return IDs of tasks
 * the user has described completing.
 *
 * @param {string} userMessage  - Raw text from the user
 * @param {Array}  tasks        - Array of { id, text } objects for today
 * @returns {string[]}          - Array of task IDs the user completed
 */
export async function parseCompletedTasks(userMessage, tasks) {
  if (!tasks.length) return [];

  const taskList = tasks.map(t => `- ID: ${t.id} | Description: ${t.text}`).join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `You are a helper for a maternal and baby wellness app. A user has sent a message describing what they have done today.

Today's task list:
${taskList}

User's message: "${userMessage}"

Return ONLY a JSON array of task IDs that the user has described completing, based on what they said. Match loosely — if they say "tummy time" match any tummy time task. If they say "sang songs" match any singing/auditory task. If nothing matches, return an empty array.

Reply with ONLY valid JSON, no explanation. Example: ["w1-m1", "w1-s1"]`,
      },
    ],
  });

  try {
    const raw = response.content[0].text.trim();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Generate an empathetic, brief response after logging tasks.
 */
export async function generateLogResponse(completedTasks, remainingCount, mode) {
  if (!completedTasks.length) {
    return "I couldn't match that to today's tasks — could you try being a little more specific? Or tap 📋 to see the full list.";
  }

  const modeEmoji = { prepare: '🌱', recover: '🌿', tumbuh: '🌸' }[mode] || '🌿';
  const taskNames = completedTasks.map(t => t.text.split('—')[0].trim()).join(', ');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 120,
    messages: [
      {
        role: 'user',
        content: `Write a warm, brief (2–3 sentence) response acknowledging that a new mother / parent just logged completing these activities: ${taskNames}. They have ${remainingCount} task(s) remaining today. End with a gentle encouragement. Use the emoji ${modeEmoji}. No markdown.`,
      },
    ],
  });

  return response.content[0].text.trim();
}
