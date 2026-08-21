/**
 * AI service — parses user's freetext into completed task IDs.
 * Uses Groq's free API (OpenAI-compatible) with Llama 3.
 */

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey:  process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL = 'llama-3.1-8b-instant';

/**
 * Given the user's message and today's task list, return IDs of tasks
 * the user has described completing.
 *
 * @param {string} userMessage  - Raw text from the user
 * @param {Array}  tasks        - Array of { id, text } objects for today
 * @returns {string[]}          - Array of matched task IDs
 */
export async function parseCompletedTasks(userMessage, tasks) {
  if (!tasks.length) return [];

  const taskList = tasks.map(t => `- ID: ${t.id} | Description: ${t.text}`).join('\n');

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 256,
    messages: [
      {
        role: 'system',
        content: 'You are a helper for a maternal and baby wellness app. Reply with ONLY valid JSON — no explanation, no markdown.',
      },
      {
        role: 'user',
        content: `A user has sent a message describing what they have done today.

Today's task list:
${taskList}

User's message: "${userMessage}"

Return ONLY a JSON array of task IDs that the user has described completing. Match loosely — if they say "tummy time" match any tummy time task. If they say "sang songs" match any singing/auditory task. If nothing matches, return an empty array.

Example: ["w1-m1", "w1-s1"]`,
      },
    ],
  });

  try {
    const raw    = response.choices[0].message.content.trim();
    // Strip any accidental markdown fences
    const clean  = raw.replace(/```json?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Generate a warm, brief response after logging tasks.
 */
export async function generateLogResponse(completedTasks, remainingCount, mode) {
  if (!completedTasks.length) {
    return "I couldn't match that to today's tasks — could you try being a little more specific? Or tap 📋 to see the full list.";
  }

  const modeEmoji = { prepare: '🌱', recover: '🌿', tumbuh: '🌸' }[mode] || '🌿';
  const taskNames = completedTasks.map(t => t.text.split('—')[0].trim()).join(', ');

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 120,
    messages: [
      {
        role: 'system',
        content: 'You are a warm, supportive wellness companion. Reply in plain text — no markdown.',
      },
      {
        role: 'user',
        content: `Write a warm, brief (2–3 sentence) response acknowledging that a new mother / parent just logged completing these activities: ${taskNames}. They have ${remainingCount} task(s) remaining today. End with a gentle encouragement. Use the emoji ${modeEmoji}.`,
      },
    ],
  });

  return response.choices[0].message.content.trim();
}
