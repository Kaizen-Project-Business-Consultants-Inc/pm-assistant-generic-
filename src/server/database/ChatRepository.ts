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

  async addMessage(conversationId: string, message: {
    role: 'user' | 'assistant';
    content: string;
    actions?: any[];
  }): Promise<ChatMessage> {
    const id = randomUUID();
    await this.queryRaw(
      `INSERT INTO chat_messages (id, conversation_id, role, content, actions)
       VALUES (?, ?, ?, ?, ?)`,
      [id, conversationId, message.role, message.content, message.actions ? JSON.stringify(message.actions) : null],
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
        ORDER BY created_at DESC
        LIMIT ?
      ) sub ORDER BY created_at ASC`,
      [conversationId, limit],
    );
    return rows.map(mapMessageRow);
  }

  async getAllMessages(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM chat_messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
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

  async findByProjectId(projectId: string, userId: string): Promise<ChatConversation[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM chat_conversations
       WHERE project_id = ? AND user_id = ? AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT 10`,
      [projectId, userId],
    );
    return rows.map(mapConversationRow);
  }
}

export const chatRepository = new ChatRepository();
