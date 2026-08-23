import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileAttachmentRepository, FileAttachmentRow } from '../database/FileAttachmentRepository';
import { config } from '../config';

export interface FileAttachment {
  id: string;
  entityType: string;
  entityId: string;
  uploadedBy: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  filePath: string;
  version: number;
  parentId: string | null;
  createdAt: string;
}

function rowToDTO(row: FileAttachmentRow): FileAttachment {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    uploadedBy: row.uploaded_by,
    fileName: row.file_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    filePath: row.file_path,
    version: row.version,
    parentId: row.parent_id,
    createdAt: row.created_at,
  };
}

const ALLOWED_ENTITY_TYPES = ['project', 'task', 'schedule', 'risk', 'issue', 'decision', 'action', 'sprint', 'goal', 'meeting'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FileAttachmentService {
  private getUploadDir(entityType: string, entityId: string): string {
    if (!ALLOWED_ENTITY_TYPES.includes(entityType)) {
      throw new Error(`Invalid entity type: ${entityType}`);
    }
    if (!UUID_RE.test(entityId)) {
      throw new Error(`Invalid entity ID: ${entityId}`);
    }
    return path.join(config.UPLOAD_DIR, entityType, entityId);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async upload(
    entityType: string,
    entityId: string,
    uploadedBy: string,
    originalName: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<FileAttachment> {
    const id = uuidv4();
    const ext = path.extname(originalName);
    const storedName = `${id}${ext}`;
    const dir = this.getUploadDir(entityType, entityId);
    this.ensureDir(dir);
    const filePath = path.join(dir, storedName);
    await fsPromises.writeFile(filePath, buffer);

    await fileAttachmentRepository.insert(id, entityType, entityId, uploadedBy, storedName, originalName, mimeType, buffer.length, filePath, 1, null);

    const row = await fileAttachmentRepository.findById(id);
    return rowToDTO(row!);
  }

  async getByEntity(entityType: string, entityId: string): Promise<FileAttachment[]> {
    const rows = await fileAttachmentRepository.findByEntity(entityType, entityId);
    return rows.map(rowToDTO);
  }

  async getById(id: string): Promise<FileAttachment | null> {
    const row = await fileAttachmentRepository.findById(id);
    return row ? rowToDTO(row) : null;
  }

  async delete(id: string): Promise<void> {
    const attachment = await this.getById(id);
    if (attachment && fs.existsSync(attachment.filePath)) {
      fs.unlinkSync(attachment.filePath);
    }
    // Also delete all versions
    const versions = await fileAttachmentRepository.findVersions(id);
    for (const v of versions) {
      if (fs.existsSync(v.file_path)) {
        fs.unlinkSync(v.file_path);
      }
    }
    await fileAttachmentRepository.deleteWithVersions(id);
  }

  async uploadNewVersion(
    parentId: string,
    uploadedBy: string,
    originalName: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<FileAttachment> {
    const parent = await this.getById(parentId);
    if (!parent) throw new Error('Parent attachment not found');

    // Get max version for this file lineage
    const rootId = parent.parentId || parent.id;
    const maxVer = await fileAttachmentRepository.getMaxVersion(rootId);
    const nextVersion = maxVer + 1;

    const id = uuidv4();
    const ext = path.extname(originalName);
    const storedName = `${id}${ext}`;
    const dir = this.getUploadDir(parent.entityType, parent.entityId);
    this.ensureDir(dir);
    const filePath = path.join(dir, storedName);
    await fsPromises.writeFile(filePath, buffer);

    await fileAttachmentRepository.insert(id, parent.entityType, parent.entityId, uploadedBy, storedName, originalName, mimeType, buffer.length, filePath, nextVersion, rootId);

    const result = await fileAttachmentRepository.findById(id);
    return rowToDTO(result!);
  }

  async getVersionHistory(id: string): Promise<FileAttachment[]> {
    const attachment = await this.getById(id);
    if (!attachment) return [];
    const rootId = attachment.parentId || attachment.id;

    const rows = await fileAttachmentRepository.findVersionHistory(rootId);
    return rows.map(rowToDTO);
  }
}

export const fileAttachmentService = new FileAttachmentService();
