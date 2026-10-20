// Sakina baby log: one entry point.
//
// Usage in src/bot.js:
//
//   import { registerBabyLog, BABY_TOOLS, BABY_TOOLS_PROMPT } from './babyLog/index.js';
//
//   const babyLog = registerBabyLog(bot, {
//     supabase,
//     miniAppUrl: process.env.MINIAPP_URL,   // e.g. https://<bot-domain>/app/  (trailing slash!)
//     botToken: process.env.BOT_TOKEN,
//     focusFor: (ageDays, baby) => getTumbuhContent(user),  // plug in Sakina's 0-12m content
//   });
//
//   // Mount on the existing HTTP server already in bot.js:
//   // (handler returned; mount at /app)
//   babyLog.miniApp            → (req, res, next) handler for /app
//   babyLog.rebuildPaperEvents → (babyId, month) => Promise<void>
//   babyLog.runTool            → (name, args, babyId) => Promise<object>
//   babyLog.queries            → createQueries result (for scheduler.js)
//
// Do NOT call babyLog.startJobs() — sakina-bot's own scheduler.js handles timing.

import { registerPaperLog } from './paper.js';
import { registerTapLog } from './tap.js';
import { createQueries } from './query.js';
import { createMiniAppHandler, verifyInitData } from './miniapp/server.js';
import { BABY_TOOLS, BABY_TOOLS_PROMPT, runBabyTool } from './tools.js';
import { composeBrief, defaultFocus } from './brief.js';
import { sendScanReminders, startDailyJobs } from './scheduler.js';

export function registerBabyLog(bot, {
  supabase,
  reader,
  miniAppUrl = process.env.MINIAPP_URL,
  botToken = process.env.BOT_TOKEN,
  focusFor = defaultFocus,
  miniAppBasePath = '',
} = {}) {
  const queries = createQueries(supabase);
  const paper = registerPaperLog(bot, { supabase, ...(reader ? { reader } : {}) });
  registerTapLog(bot, { supabase, queries });

  // /dashboard and /logs are registered in tap.js (text-based day view + navigation)

  return {
    queries,
    miniApp: botToken ? createMiniAppHandler({ queries, botToken, bot, basePath: miniAppBasePath }) : null,
    rebuildPaperEvents: paper.rebuildPaperEvents,
    runTool: (name, args, babyId) => runBabyTool(name, args, { queries, babyId }),
    // Exposed so sakina scheduler can call these directly with claimJob protection:
    sendScanReminders: (supabase_) => sendScanReminders(bot, supabase_, queries),
  };
}

export { BABY_TOOLS, BABY_TOOLS_PROMPT, runBabyTool, verifyInitData, composeBrief, defaultFocus };
