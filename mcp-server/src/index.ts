#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';

import { registerProjectTools } from './tools/projects.js';
import { registerScheduleTools } from './tools/schedules.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerSprintTools } from './tools/sprints.js';
import { registerResourceTools } from './tools/resources.js';
import { registerTimeTrackingTools } from './tools/time-tracking.js';
import { registerApprovalTools } from './tools/approvals.js';
import { registerReportTools } from './tools/reports.js';
import { registerAIInsightTools } from './tools/ai-insights.js';
import { registerAutoRescheduleTools } from './tools/auto-reschedule.js';
import { registerIntakeTools } from './tools/intake.js';
import { registerCustomFieldTools } from './tools/custom-fields.js';
import { registerIntegrationTools } from './tools/integrations.js';
import { registerAdminTools } from './tools/admin.js';
import { registerTemplateTools } from './tools/templates.js';
import { registerRaidTools } from './tools/raid.js';
import { registerLessonsLearnedTools } from './tools/lessons-learned.js';
import { registerResourceOptimizerTools } from './tools/resource-optimizer.js';
import { type Role, isToolAllowed } from './permissions.js';
import { registerResources } from './resources/index.js';

export interface McpUserContext {
  role: Role;
  userId?: string;
  apiKeyId?: string;
  sessionId?: string;
}

/**
 * Wraps McpServer.tool() to only register tools the user's role permits.
 * Returns a proxy that intercepts tool registration calls.
 */
function createRoleFilteredServer(server: McpServer, role: Role): McpServer {
  const originalTool = server.tool.bind(server);

  // Override the tool method to filter by role
  server.tool = function filteredTool(name: string, ...rest: any[]) {
    if (!isToolAllowed(name, role)) {
      return; // Skip registration — tool won't appear in the tool list
    }
    return (originalTool as any)(name, ...rest);
  } as any;

  return server;
}

/**
 * Wraps McpServer.tool() to instrument each tool handler with timing + error capture.
 * Logs invocations to mcp_tool_invocations table via fire-and-forget INSERT.
 */
function createInstrumentedServer(server: McpServer, userContext?: McpUserContext): McpServer {
  const originalTool = server.tool.bind(server);

  server.tool = function instrumentedTool(name: string, ...rest: any[]) {
    // Find the handler (last argument that is a function)
    const handlerIndex = rest.findIndex((arg: any) => typeof arg === 'function');
    if (handlerIndex === -1) {
      return (originalTool as any)(name, ...rest);
    }

    const originalHandler = rest[handlerIndex];
    rest[handlerIndex] = async (...handlerArgs: any[]) => {
      const start = Date.now();
      let isSuccess = true;
      let errorMessage: string | null = null;

      try {
        const result = await originalHandler(...handlerArgs);
        return result;
      } catch (err: any) {
        isSuccess = false;
        errorMessage = err?.message || String(err);
        throw err;
      } finally {
        const durationMs = Date.now() - start;
        // Fire-and-forget logging
        logToolInvocation(
          userContext?.userId || null,
          userContext?.apiKeyId || null,
          userContext?.sessionId || null,
          name,
          durationMs,
          isSuccess,
          errorMessage,
        ).catch(() => {}); // swallow logging errors
      }
    };

    return (originalTool as any)(name, ...rest);
  } as any;

  return server;
}

async function logToolInvocation(
  userId: string | null,
  apiKeyId: string | null,
  sessionId: string | null,
  toolName: string,
  durationMs: number,
  isSuccess: boolean,
  errorMessage: string | null,
): Promise<void> {
  try {
    const { query } = await import('./db.js');
    await query(
      `INSERT INTO mcp_tool_invocations (user_id, api_key_id, session_id, tool_name, duration_ms, is_success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, apiKeyId, sessionId, toolName, durationMs, isSuccess ? 1 : 0, errorMessage],
    );
  } catch (err) {
    console.error('[MCP] Failed to log tool invocation:', err);
  }
}

function createMcpServer(userContext?: McpUserContext): McpServer {
  const server = new McpServer({
    name: 'pm-assistant',
    version: '3.0.0',
  });

  // Apply role filtering if user context is provided
  const roleFiltered = userContext
    ? createRoleFilteredServer(server, userContext.role)
    : server; // No filtering in stdio mode without context (backward compat)

  // Apply instrumentation (wraps handlers with timing + logging)
  const registrationTarget = createInstrumentedServer(roleFiltered, userContext);

  // Register all tool groups (filtered by role)
  registerProjectTools(registrationTarget);
  registerScheduleTools(registrationTarget);
  registerTaskTools(registrationTarget);
  registerSprintTools(registrationTarget);
  registerResourceTools(registrationTarget);
  registerTimeTrackingTools(registrationTarget);
  registerApprovalTools(registrationTarget);
  registerReportTools(registrationTarget);
  registerAIInsightTools(registrationTarget);
  registerAutoRescheduleTools(registrationTarget);
  registerIntakeTools(registrationTarget);
  registerCustomFieldTools(registrationTarget);
  registerIntegrationTools(registrationTarget);
  registerAdminTools(registrationTarget);
  registerTemplateTools(registrationTarget);
  registerRaidTools(registrationTarget);
  registerLessonsLearnedTools(registrationTarget);
  registerResourceOptimizerTools(registrationTarget);

  // Register MCP resources (role-filtered)
  registerResources(server, userContext?.role);

  return server;
}

async function resolveRoleFromApiKey(apiKey: string): Promise<Role> {
  try {
    const { query } = await import('./db.js');
    const crypto = await import('node:crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    interface KeyRow { user_role: string }
    const rows = await query<KeyRow & import('mysql2/promise').RowDataPacket>(
      `SELECT u.role AS user_role
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.key_hash = ? AND ak.is_active = 1 AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
      [keyHash],
    );

    if (rows.length > 0) {
      return rows[0].user_role as Role;
    }
  } catch (err) {
    console.error('[MCP] Failed to resolve role from API key:', err);
  }
  return 'team_member'; // fallback
}

async function startStdio() {
  // Resolve role from PM_API_KEY if available
  const apiKey = process.env.PM_API_KEY || '';
  let userContext: McpUserContext | undefined;

  if (apiKey) {
    const role = await resolveRoleFromApiKey(apiKey);
    userContext = { role };
    console.error(`[MCP STDIO] Resolved role: ${role}`);
  }

  const server = createMcpServer(userContext);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp() {
  // Dynamic imports for Express + OAuth (only needed in HTTP mode)
  const express = (await import('express')).default;
  const { mcpAuthRouter } = await import('@modelcontextprotocol/sdk/server/auth/router.js');
  const { requireBearerAuth } = await import('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
  const bcryptModule = await import('bcryptjs');
  const bcrypt = bcryptModule.default ?? bcryptModule;
  const { PmOAuthProvider } = await import('./oauth/provider.js');
  const { query } = await import('./db.js');

  const provider = new PmOAuthProvider();

  const baseUrl = process.env.PM_BASE_URL || 'https://kovarti.com';
  const issuerUrl = new URL(baseUrl);
  const resourceServerUrl = new URL('/mcp', baseUrl);

  const app = express();

  // CORS headers for all responses
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Trust reverse proxy (LiteSpeed) for X-Forwarded-For
  app.set('trust proxy', 1);

  // Request logging
  app.use((req, _res, next) => {
    console.error(`[MCP HTTP] ${req.method} ${req.url} from ${req.headers.origin || 'no-origin'}`);
    console.error(`[MCP HTTP] Full URL: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
    if (req.url.includes('/authorize') || req.url.includes('/register') || req.url.includes('/token') || req.url.includes('/mcp')) {
      console.error(`[MCP HTTP] Headers: ${JSON.stringify(req.headers)}`);
      console.error(`[MCP HTTP] Query: ${JSON.stringify(req.query)}`);
      if (req.body) console.error(`[MCP HTTP] Body: ${JSON.stringify(req.body)}`);
    }
    next();
  });

  // POST /authorize/submit — MUST be mounted BEFORE mcpAuthRouter
  // so the SDK's /authorize handler doesn't capture /authorize/submit
  app.post('/authorize/submit', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const { username, password, client_id, redirect_uri, code_challenge, state, scope } = req.body;

      if (!username || !password || !client_id || !redirect_uri || !code_challenge) {
        res.status(400).type('html').send('<h1>Missing required fields</h1>');
        return;
      }

      // Validate credentials against users table (accept username or email)
      interface UserRow { id: string; username: string; password_hash: string; role: string }
      const users = await query<UserRow & import('mysql2/promise').RowDataPacket>(
        'SELECT id, username, password_hash, role FROM users WHERE (username = ? OR email = ?) AND is_active = 1',
        [username, username],
      );

      if (users.length === 0) {
        // Re-render login with error
        const { renderAuthorizePage } = await import('./oauth/authorizePage.js');
        res.status(401).type('html').send(renderAuthorizePage({
          clientId: client_id,
          redirectUri: redirect_uri,
          state,
          codeChallenge: code_challenge,
          scope,
          error: 'Invalid username or password.',
        }));
        return;
      }

      const user = users[0];
      const passwordValid = await bcrypt.compare(password, user.password_hash);
      if (!passwordValid) {
        const { renderAuthorizePage } = await import('./oauth/authorizePage.js');
        res.status(401).type('html').send(renderAuthorizePage({
          clientId: client_id,
          redirectUri: redirect_uri,
          state,
          codeChallenge: code_challenge,
          scope,
          error: 'Invalid username or password.',
        }));
        return;
      }

      // Issue authorization code
      const code = randomUUID();
      await query(
        `INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, scope, state, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
        [code, client_id, user.id, redirect_uri, code_challenge, scope || null, state || null],
      );

      // Redirect back to Claude's callback
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('code', code);
      if (state) redirectUrl.searchParams.set('state', state);
      res.redirect(302, redirectUrl.toString());
    } catch (err) {
      console.error('[OAuth] /authorize/submit error:', err);
      res.status(500).type('html').send('<h1>Internal server error</h1>');
    }
  });

  // Mount OAuth auth router (handles /.well-known/*, /authorize, /token, /register, /revoke)
  app.use(mcpAuthRouter({
    provider,
    issuerUrl,
    baseUrl: issuerUrl,
    resourceServerUrl,
    resourceName: 'PM Assistant MCP',
  }));

  // Bearer auth for MCP endpoint
  const bearerAuth = requireBearerAuth({ verifier: provider });

  // Session management
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  // Helper: resolve user role from OAuth authInfo
  async function resolveRoleFromAuth(authInfo: any): Promise<Role> {
    const userId = authInfo?.extra?.userId;
    if (!userId) return 'team_member';

    try {
      interface RoleRow { role: string }
      const rows = await query<RoleRow & import('mysql2/promise').RowDataPacket>(
        'SELECT role FROM users WHERE id = ?',
        [userId],
      );
      if (rows.length > 0) return rows[0].role as Role;
    } catch (err) {
      console.error('[MCP] Failed to resolve role from auth:', err);
    }
    return 'team_member';
  }

  // MCP endpoint with auth
  app.post('/mcp', bearerAuth, async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      // Stale/unknown session ID — return 404 per MCP spec so client re-initializes
      if (sessionId) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session expired' },
          id: null,
        });
        return;
      }

      // New session (no session ID = fresh initialize) — resolve role for this user
      const authInfo = (req as any).auth;
      const role = await resolveRoleFromAuth(authInfo);
      const userContext: McpUserContext = {
        role,
        userId: authInfo?.extra?.userId,
        apiKeyId: authInfo?.extra?.apiKeyId,
      };

      const mcpSessionId = randomUUID();
      userContext.sessionId = mcpSessionId;
      const server = createMcpServer(userContext);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => mcpSessionId,
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res);

      if (transport.sessionId) {
        sessions.set(transport.sessionId, { server, transport });
      }
    } catch (err) {
      console.error('[MCP] POST /mcp error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  app.get('/mcp', bearerAuth, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      return;
    }
    res.status(400).json({ error: 'Invalid or missing session ID' });
  });

  app.delete('/mcp', bearerAuth, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      sessions.delete(sessionId);
      return;
    }
    res.status(400).json({ error: 'Invalid or missing session ID' });
  });

  const port = parseInt(process.env.PORT || process.env.PM_PORT || '3100', 10);
  app.listen(port, () => {
    console.error(`PM Assistant MCP server (HTTP+OAuth) listening on http://localhost:${port}`);
    console.error(`  MCP endpoint: /mcp`);
    console.error(`  OAuth metadata: /.well-known/oauth-authorization-server`);
    console.error(`  Resource metadata: /.well-known/oauth-protected-resource/mcp`);
  });
}

async function main() {
  // Default to HTTP when PORT is set (Passenger) or PM_TRANSPORT is explicit
  const transport = process.env.PM_TRANSPORT || (process.env.PORT ? 'http' : 'stdio');

  if (transport === 'http') {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
