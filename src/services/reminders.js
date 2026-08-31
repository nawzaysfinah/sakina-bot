/**
 * Reminder intent detection via Gemini.
 * Determines if a user message is trying to set a reminder,
 * and if so extracts the date and reminder text.
 */

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`;

async function callGemini(systemPrompt, userPrompt) {
  const url = `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

/**
 * Detect if a message is a reminder creation intent.
 * Returns { isReminder, text, date } or { isReminder: false }.
 *
 * date is returned as YYYY-MM-DD string.
 */
export async function parseReminderIntent(message) {
  const today = new Date().toISOString().split('T')[0];

  const raw = await callGemini(
    'You are a reminder parser. Reply with ONLY valid JSON — no markdown, no explanation.',
    `Today's date is ${today}.

A user sent this message: "${message}"

Determine if this is a request to set a reminder for a future date.
Examples of reminder requests: "remind me on Friday to call the hospital", "add a reminder for 25 Aug to pack my bag", "set a reminder for tomorrow to take my vitamins", "remember to check baby weight next Monday".

If it IS a reminder request, return:
{ "isReminder": true, "text": "<the thing to be reminded about>", "date": "<YYYY-MM-DD>" }

Resolve relative dates like "tomorrow", "next Friday", "this weekend" based on today's date.
For "this weekend" use the nearest Saturday.
For vague timing like "soon" or "later", return isReminder: false.

If it is NOT a reminder request (e.g. logging completed tasks, asking questions), return:
{ "isReminder": false }`
  );

  try {
    const clean  = raw.replace(/```json?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.isReminder) return { isReminder: false };
    if (!parsed.text || !parsed.date) return { isReminder: false };
    return { isReminder: true, text: parsed.text, date: parsed.date };
  } catch {
    return { isReminder: false };
  }
}

/**
 * Format a list of reminders for display in Telegram.
 */
export function formatReminderList(reminders) {
  if (!reminders.length) return '_No upcoming reminders_';
  return reminders.map(r => {
    const date  = formatDate(r.remind_on);
    const today = new Date().toISOString().split('T')[0];
    const tag   = r.remind_on === today ? ' _(today)_' : '';
    return `📌 *${date}*${tag}\n   ${r.text}`;
  }).join('\n\n');
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-SG', {
    weekday: 'short', day: 'numeric', month: 'short'
  });
}
