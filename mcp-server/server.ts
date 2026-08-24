import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_KEY = process.env.PM_API_KEY!;
const BASE_URL = (process.env.PM_BASE_URL || "https://kovarti.com").replace(
  /\/$/,
  ""
);

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({
  name: "pm-assistant",
  version: "1.0.0",
});

// --- Tools ---

server.tool("list-projects", "List all projects in the PM system", {}, async () => {
  return jsonResult(await apiGet("/projects"));
});

server.tool(
  "get-project",
  "Get detailed info about a specific project",
  { projectId: z.number().describe("Project ID") },
  async ({ projectId }) => jsonResult(await apiGet(`/projects/${projectId}`))
);

server.tool(
  "get-schedules",
  "Get all schedules for a project",
  { projectId: z.number().describe("Project ID") },
  async ({ projectId }) =>
    jsonResult(await apiGet(`/schedules/project/${projectId}`))
);

server.tool(
  "get-tasks",
  "Get all tasks in a schedule",
  { scheduleId: z.number().describe("Schedule ID") },
  async ({ scheduleId }) =>
    jsonResult(await apiGet(`/schedules/${scheduleId}/tasks`))
);

server.tool(
  "get-project-health",
  "Get AI health score for a project",
  { projectId: z.number().describe("Project ID") },
  async ({ projectId }) =>
    jsonResult(await apiGet(`/predictions/project/${projectId}/health`))
);

server.tool(
  "get-project-risks",
  "Get AI risk assessment for a project",
  { projectId: z.number().describe("Project ID") },
  async ({ projectId }) =>
    jsonResult(await apiGet(`/predictions/project/${projectId}/risks`))
);

server.tool(
  "get-project-budget",
  "Get AI budget forecast for a project",
  { projectId: z.number().describe("Project ID") },
  async ({ projectId }) =>
    jsonResult(await apiGet(`/predictions/project/${projectId}/budget`))
);

server.tool(
  "get-analytics",
  "Get portfolio-level analytics summary",
  {},
  async () => jsonResult(await apiGet("/analytics/summary"))
);

server.tool(
  "get-alerts",
  "Get proactive alerts across all projects",
  {},
  async () => jsonResult(await apiGet("/alerts"))
);

server.tool(
  "search",
  "Search projects and tasks by keyword",
  { query: z.string().describe("Search query") },
  async ({ query }) =>
    jsonResult(await apiGet(`/search?q=${encodeURIComponent(query)}`))
);

server.tool(
  "get-portfolio",
  "Get full portfolio overview across all projects",
  {},
  async () => jsonResult(await apiGet("/portfolio"))
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
