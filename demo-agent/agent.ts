import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import * as readline from "readline";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PM_API_KEY = process.env.PM_API_KEY;
const PM_BASE_URL = (process.env.PM_BASE_URL || "https://kovarti.com").replace(
  /\/$/,
  ""
);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!PM_API_KEY) {
  console.error("❌  Missing PM_API_KEY in .env");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error("❌  Missing ANTHROPIC_API_KEY in .env");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let lastRateLimitHeaders: Record<string, string> = {};

async function api<T = unknown>(path: string): Promise<T> {
  const url = `${PM_BASE_URL}/api/v1${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${PM_API_KEY}` },
  });

  // Capture rate-limit headers
  for (const key of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
    const val = res.headers.get(key);
    if (val) lastRateLimitHeaders[key] = val;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

function log(msg: string) {
  console.log(`\x1b[36m▸\x1b[0m ${msg}`);
}

function logSection(title: string) {
  console.log(`\n\x1b[1;35m━━━ ${title} ━━━\x1b[0m\n`);
}

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  name: string;
  [key: string]: unknown;
}

async function fetchProjectDetails(project: Project) {
  const id = project.id;
  const [health, risks, budget, schedulesRes] = await Promise.allSettled([
    api(`/predictions/project/${id}/health`),
    api(`/predictions/project/${id}/risks`),
    api(`/predictions/project/${id}/budget`),
    api<{ schedules: { id: string }[] }>(`/schedules/project/${id}`),
  ]);

  // Fetch tasks for each schedule
  let tasks: unknown[] = [];
  if (schedulesRes.status === "fulfilled" && schedulesRes.value?.schedules) {
    const taskResults = await Promise.allSettled(
      schedulesRes.value.schedules.map((s) =>
        api<{ tasks: unknown[] }>(`/schedules/${s.id}/tasks`)
      )
    );
    tasks = taskResults.flatMap((r) =>
      r.status === "fulfilled" ? r.value?.tasks ?? [] : []
    );
  }

  return {
    project,
    health: health.status === "fulfilled" ? health.value : null,
    risks: risks.status === "fulfilled" ? risks.value : null,
    budget: budget.status === "fulfilled" ? budget.value : null,
    schedules:
      schedulesRes.status === "fulfilled"
        ? schedulesRes.value?.schedules ?? []
        : [],
    tasks,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior project management assistant with access to a live PM tool's data. You have been given a JSON dump of the organization's complete project portfolio.

You can answer any question about the portfolio: project names, PMs, statuses, tasks, schedules, risks, budgets, team members, deadlines, etc.

When answering:
- Be concise and direct
- Reference specific project names, task names, dates, and numbers from the data
- If a data point is missing or null, say so rather than guessing
- Use markdown formatting for readability
- If the user asks for a full report, produce a structured analysis

You are in an interactive chat. Answer the user's specific question — don't produce a full report unless asked.`;

async function main() {
  console.log(
    "\x1b[1;33m\n╔══════════════════════════════════════════════════╗"
  );
  console.log(
    "║       PM Agent — Interactive Assistant            ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════╝\x1b[0m\n"
  );

  log(`Connecting to ${PM_BASE_URL}`);

  // Step 1 — Fetch projects
  logSection("Loading Portfolio Data");
  const { projects } = await api<{ projects: Project[] }>("/projects");
  log(`Found ${projects.length} project(s)`);
  for (const p of projects) {
    log(`  • ${p.name}`);
  }

  // Fetch analytics summary
  let analytics: unknown = null;
  try {
    analytics = await api("/analytics/summary");
    log("Analytics summary loaded");
  } catch {
    log("Analytics not available");
  }

  // Fetch per-project details
  log("Fetching project details...");
  const projectDetails = await Promise.all(
    projects.map(async (p) => {
      const details = await fetchProjectDetails(p);
      return details;
    })
  );
  log("All data loaded");

  // Rate limit info
  if (Object.keys(lastRateLimitHeaders).length > 0) {
    log(`Rate limit: ${lastRateLimitHeaders["x-ratelimit-remaining"] || "?"} requests remaining`);
  }

  // Build context
  const context = {
    fetchedAt: new Date().toISOString(),
    baseUrl: PM_BASE_URL,
    totalProjects: projects.length,
    analytics,
    projects: projectDetails.map((d) => ({
      ...d.project,
      health: d.health,
      risks: d.risks,
      budget: d.budget,
      scheduleCount: d.schedules.length,
      taskCount: d.tasks.length,
      tasks: d.tasks,
    })),
  };

  const contextJson = JSON.stringify(context, null, 2);
  log(`Context: ${(contextJson.length / 1024).toFixed(1)} KB`);

  // Interactive chat loop
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [];

  // Inject portfolio data as the first user message (hidden context)
  messages.push({
    role: "user",
    content: `Here is the current portfolio data from the PM tool:\n\n\`\`\`json\n${contextJson}\n\`\`\`\n\nI'll now ask you questions about this data. Please confirm you're ready.`,
  });
  messages.push({
    role: "assistant",
    content: "I've loaded your portfolio data. I can see all your projects, schedules, tasks, analytics, and more. Ask me anything!",
  });

  console.log(`\n\x1b[1;32m━━━ Ready! Ask anything about your portfolio. Type "quit" to exit. ━━━\x1b[0m\n`);
  console.log(`\x1b[2mExamples: "List all projects", "What tasks are overdue?", "Give me a full report"\x1b[0m\n`);

  while (true) {
    const question = await ask("\x1b[1;36mYou:\x1b[0m ");
    if (!question || question.toLowerCase() === "quit" || question.toLowerCase() === "exit") {
      log("Goodbye!");
      break;
    }

    // Check for data refresh command
    if (question.toLowerCase() === "refresh") {
      log("Refreshing portfolio data...");
      const { projects: newProjects } = await api<{ projects: Project[] }>("/projects");
      const newDetails = await Promise.all(newProjects.map(fetchProjectDetails));
      const newContext = {
        fetchedAt: new Date().toISOString(),
        baseUrl: PM_BASE_URL,
        totalProjects: newProjects.length,
        analytics: await api("/analytics/summary").catch(() => null),
        projects: newDetails.map((d) => ({
          ...d.project,
          health: d.health,
          risks: d.risks,
          budget: d.budget,
          scheduleCount: d.schedules.length,
          taskCount: d.tasks.length,
          tasks: d.tasks,
        })),
      };
      messages.push({
        role: "user",
        content: `Data has been refreshed. Here is the updated portfolio data:\n\n\`\`\`json\n${JSON.stringify(newContext, null, 2)}\n\`\`\``,
      });
      messages.push({
        role: "assistant",
        content: "Portfolio data refreshed. I'm now working with the latest data.",
      });
      log("Data refreshed. Continue asking questions.");
      continue;
    }

    messages.push({ role: "user", content: question });

    process.stdout.write("\n\x1b[1;33mAssistant:\x1b[0m ");

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
    });

    let fullResponse = "";
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        process.stdout.write(event.delta.text);
        fullResponse += event.delta.text;
      }
    }

    console.log("\n");
    messages.push({ role: "assistant", content: fullResponse });

    const finalMessage = await stream.finalMessage();
    log(
      `\x1b[2m(${finalMessage.usage.input_tokens} in / ${finalMessage.usage.output_tokens} out tokens)\x1b[0m`
    );
    console.log();
  }
}

main().catch((err) => {
  console.error("\x1b[1;31m❌  Agent error:\x1b[0m", err.message || err);
  process.exit(1);
});
