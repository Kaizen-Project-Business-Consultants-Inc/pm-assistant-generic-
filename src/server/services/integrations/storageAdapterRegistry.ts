import type { StorageAdapter } from './StorageAdapter';
import { oneDriveAdapter } from './OneDriveAdapter';
import { googleDriveAdapter } from './GoogleDriveAdapter';
import { dropboxAdapter } from './DropboxAdapter';
import { config } from '../../config';

export type StorageProvider = 'onedrive' | 'sharepoint' | 'google_drive' | 'dropbox';

const ADAPTER_MAP: Record<StorageProvider, StorageAdapter> = {
  onedrive: oneDriveAdapter,
  sharepoint: oneDriveAdapter, // Same adapter, different base path via connectorConfig.siteId
  google_drive: googleDriveAdapter,
  dropbox: dropboxAdapter,
};

export function getStorageAdapter(provider: StorageProvider): StorageAdapter {
  const adapter = ADAPTER_MAP[provider];
  if (!adapter) throw new Error(`Unknown storage provider: ${provider}`);
  return adapter;
}

export function getProviderCredentials(provider: StorageProvider): { clientId: string; clientSecret: string } {
  switch (provider) {
    case 'onedrive':
    case 'sharepoint':
      return { clientId: config.MICROSOFT_CLIENT_ID, clientSecret: config.MICROSOFT_CLIENT_SECRET };
    case 'google_drive':
      return { clientId: config.GOOGLE_DRIVE_CLIENT_ID, clientSecret: config.GOOGLE_DRIVE_CLIENT_SECRET };
    case 'dropbox':
      return { clientId: config.DROPBOX_APP_KEY, clientSecret: config.DROPBOX_APP_SECRET };
  }
}

export function isProviderConfigured(provider: StorageProvider): boolean {
  const creds = getProviderCredentials(provider);
  return !!(creds.clientId && creds.clientSecret);
}

const PROVIDER_LABELS: Record<StorageProvider, string> = {
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint',
  google_drive: 'Google Drive',
  dropbox: 'Dropbox',
};

export function getProviderLabel(provider: StorageProvider): string {
  return PROVIDER_LABELS[provider] || provider;
}

const CALLBACK_PATHS: Record<StorageProvider, string> = {
  onedrive: 'onedrive',
  sharepoint: 'onedrive', // SharePoint uses same Microsoft OAuth callback
  google_drive: 'google_drive',
  dropbox: 'dropbox',
};

export function getCallbackPath(provider: StorageProvider): string {
  return CALLBACK_PATHS[provider] || provider;
}

export const ALL_PROVIDERS: StorageProvider[] = ['onedrive', 'sharepoint', 'google_drive', 'dropbox'];
