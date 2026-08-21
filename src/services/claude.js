/**
 * AI service — uses Google Gemini REST API directly (no SDK).
 * Free tier: 1,500 requests/day on gemini-1.5-flash.
 */

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`;

async function callGemini(systemPrompt, userPrompt) {
  const url = `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

/**
 * Given the user's message and today's task list, return IDs of tasks
 * the user has described completing.
 */
export async function parseCompletedTasks(userMessage, tasks) {
  if (!tasks.length) return [];

  const taskList = tasks.map(t => `- ID: ${t.id} | Description: ${t.text}`).join('\n');

  const text = await callGemini(
    'You are a helper for a maternal wellness app. Reply with ONLY valid JSON — no markdown, no explanation.',
    `A user described what they did today. Match their message to completed tasks.

Today's tasks:
${taskList}

User said: "${userMessage}"

Return ONLY a JSON array of matched task IDs. Match loosely — "tummy time" matches any tummy time task, "sang" matches any singing task. Empty array if nothing matches.
Example: ["w1-m1", "w1-s1"]`
  );

  try {
    const clean  = text.replace(/```json?|```/g, '').trim();
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
    return "I couldn't match that to today's tasks — try being a little more specific, or tap 📋 to see the full list.";
  }

  const modeEmoji = { prepare: '🌱', recover: '🌿', tumbuh: '🌸' }[mode] || '🌿';
  const taskNames = completedTasks.map(t => t.text.split('—')[0].trim()).join(', ');

  const text = await callGemini(
    'You are a warm, supportive wellness companion. Reply in plain text only — no markdown.',
    `Write a warm, brief (2–3 sentence) response for a new parent who just logged: ${taskNames}. They have ${remainingCount} task(s) left today. End with gentle encouragement. Use the ${modeEmoji} emoji.`
  );

  return text;
}
