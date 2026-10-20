import { randomUUID } from 'crypto';
import { BaseRepository } from './BaseRepository';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatConversation {
  id: string;
  userId: string;
  projectId: string | null;
  contextType: string;
  title: string;
  tokenCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  actions: any[] | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapConversationRow(row: any): ChatConversation {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    contextType: row.context_type,
    title: row.title,
    tokenCount: row.token_count,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessageRow(row: any): ChatMessage {
  let actions = row.actions;
  if (typeof actions === 'string') {
    try { actions = JSON.parse(actions); } catch { actions = null; }
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    actions,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class ChatRepository extends BaseRepository<ChatConversation> {
  constructor() {
    super('chat_conversations', mapConversationRow);
  }

  async createConversation(data: {
    userId: string;
    projectId?: string;
    contextType: string;
    title: string;
  }): Promise<ChatConversation> {
    const id = randomUUID();
    await this.queryRaw(
      `INSERT INTO chat_conversations (id, user_id, project_id, context_type, title)
       VALUES (?, ?, ?, ?, ?)`,
      [id, data.userId, data.projectId || null, data.contextType, data.title],
    );
    const rows = await this.queryRaw('SELECT * FROM chat_conversations WHERE id = ?', [id]);
    return mapConversationRow(rows[0]);
  }

  async findByUserId(userId: string, limit = 50): Promise<ChatConversation[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM chat_conversations
       WHERE user_id = ? AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT ?`,
      [userId, limit],
    );
    return rows.map(mapConversationRow);
  }

  async findByIdForUser(id: string, userId: string): Promise<ChatConversation | null> {
    const rows = await this.queryRaw(
      'SELECT * FROM chat_conversations WHERE id = ? AND user_id = ? AND is_active = 1',
      [id, userId],
    );
    return rows.length > 0 ? mapConversationRow(rows[0]) : null;
  }

  async softDelete(id: string, userId: string): Promise<boolean> {
    const result: any = await this.queryRaw(
      'UPDATE chat_conversations SET is_active = 0 WHERE id = ? AND user_id = ?',
      [id, userId],
    );
    return (result.affectedRows ?? 0) > 0;
  }

  /** Only each action's outcome line is kept: the chat shows those, and a tool's data (a whole
   *  task list) would add megabytes to a row kept forever (audit 2026-10-10 H1) */
  async addMessage(conversationId: string, message: {
    role: 'user' | 'assistant';
    content: string;
    actions?: any[];
  }): Promise<ChatMessage> {
    const id = randomUUID();
    await this.queryRaw(
      `INSERT INTO chat_messages (id, conversation_id, role, content, actions)
       VALUES (?, ?, ?, ?, ?)`,
      [id, conversationId, message.role, message.content, message.actions ? JSON.stringify(message.actions.map(storedAction)) : null],
    );
    // Touch the conversation's updated_at
    await this.queryRaw(
      'UPDATE chat_conversations SET updated_at = NOW() WHERE id = ?',
      [conversationId],
    );
    const rows = await this.queryRaw('SELECT * FROM chat_messages WHERE id = ?', [id]);
    return mapMessageRow(rows[0]);
  }

  async getMessages(conversationId: string, limit = 20): Promise<ChatMessage[]> {
    // Get latest N messages in chronological order
    const rows = await this.queryRaw(
      `SELECT * FROM (
        SELECT * FROM chat_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC, ${REPLY_AFTER_QUESTION} DESC
        LIMIT ?
      ) sub ORDER BY created_at ASC, ${REPLY_AFTER_QUESTION} ASC`,
      [conversationId, limit],
    );
    return rows.map(mapMessageRow);
  }

  async getAllMessages(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM chat_messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, ${REPLY_AFTER_QUESTION} ASC`,
      [conversationId],
    );
    return rows.map(mapMessageRow);
  }

  async updateTokenCount(conversationId: string, tokens: number): Promise<void> {
    await this.queryRaw(
      'UPDATE chat_conversations SET token_count = token_count + ? WHERE id = ?',
      [tokens, conversationId],
    );
  }
}

export const chatRepository = new ChatRepository();

/** A question and its reply are saved in the same second (created_at has whole seconds): the reply sorts after it */
const REPLY_AFTER_QUESTION = "(role = 'assistant')";

/** At most this many items an action named are kept with it (one action can list 200 rows) */
const MAX_ACTION_REFS = 30;

/** One item an action found or changed: what a follow-up question needs to act on it again (U58) */
interface ActionRef { id: string; name?: string; scheduleId?: string; projectId?: string }

/**
 * The items in an action's result, from whatever shape it has (a task, a list of rows, an object
 * holding lists): anything with an id, with its name and where it lives. A `failed` list is left
 * out — those items were not done, and a follow-up must not take them as done.
 */
export function actionRefsOf(data: unknown): ActionRef[] {
  if (!data || typeof data !== 'object') return [];
  const lists = Object.entries(data as Record<string, unknown>).filter(([k, v]) => k !== 'failed' && Array.isArray(v)).map(([, v]) => v as unknown[]);
  const candidates: unknown[] = Array.isArray(data) ? data : [data, ...lists.flat()];
  const refs: ActionRef[] = [];
  for (const c of candidates) {
    if (refs.length >= MAX_ACTION_REFS) break;
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : typeof o.taskId === 'string' ? o.taskId : null;
    if (!id) continue;
    const name = typeof o.name === 'string' ? o.name : typeof o.taskName === 'string' ? o.taskName : undefined;
    refs.push({
      id,
      ...(name ? { name: name.slice(0, 120) } : {}),
      ...(typeof o.scheduleId === 'string' ? { scheduleId: o.scheduleId } : {}),
      ...(typeof o.projectId === 'string' ? { projectId: o.projectId } : {}),
    });
  }
  return refs;
}

/**
 * What a stored chat message keeps of one Mjuzi action: the line the chat panel shows, and the
 * ids of the items it named — the next question in the chat gets them back, so "mark them complete"
 * doesn't have to guess or search again (U58, 2026-10-20)
 */
function storedAction(a: { success?: boolean; toolName?: string; summary?: string; error?: string; data?: unknown }) {
  const refs = a.success ? actionRefsOf(a.data) : []; // a failed action named nothing that was done
  return { success: a.success, toolName: a.toolName, summary: a.summary, error: a.error, ...(refs.length ? { refs } : {}) };
}
