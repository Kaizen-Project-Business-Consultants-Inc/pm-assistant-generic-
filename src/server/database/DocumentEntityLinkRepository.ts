import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';
import type { DocumentEntityLink, EntityLinkType } from '../schemas/documentSchemas';

function mapRow(row: any): DocumentEntityLink {
  return {
    id: row.id,
    documentId: row.document_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    linkReason: row.link_reason || null,
    createdAt: String(row.created_at),
  };
}

class DocumentEntityLinkRepository {
  async createLinks(documentId: string, links: {
    entityType: EntityLinkType;
    entityId: string;
    linkReason?: string;
  }[]): Promise<void> {
    if (links.length === 0) return;
    const values = links.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params: any[] = [];
    for (const link of links) {
      params.push(uuidv4(), documentId, link.entityType, link.entityId, link.linkReason || null);
    }
    await databaseService.query(
      `INSERT INTO document_entity_links (id, document_id, entity_type, entity_id, link_reason) VALUES ${values}`,
      params,
    );
  }

  async findByDocument(documentId: string): Promise<DocumentEntityLink[]> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM document_entity_links WHERE document_id = ? ORDER BY created_at ASC',
      [documentId],
    );
    return rows.map(mapRow);
  }

  async findByEntity(entityType: EntityLinkType, entityId: string): Promise<DocumentEntityLink[]> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM document_entity_links WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC',
      [entityType, entityId],
    );
    return rows.map(mapRow);
  }

  async deleteByDocument(documentId: string): Promise<void> {
    await databaseService.query(
      'DELETE FROM document_entity_links WHERE document_id = ?',
      [documentId],
    );
  }
}

export const documentEntityLinkRepository = new DocumentEntityLinkRepository();
