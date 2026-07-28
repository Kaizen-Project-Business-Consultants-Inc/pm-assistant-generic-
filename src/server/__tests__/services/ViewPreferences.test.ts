import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/UserRepository', () => {
  const mockRepo = {
    getViewPrefs: vi.fn(),
    updateViewPrefs: vi.fn(),
  };
  return { userRepository: mockRepo };
});

import { UserService } from '../../services/UserService';
import { userRepository } from '../../database/UserRepository';

describe('ViewPreferences', () => {
  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserService();
  });

  describe('getViewPrefs', () => {
    it('returns null when no prefs exist', async () => {
      (userRepository.getViewPrefs as any).mockResolvedValue(null);
      const result = await service.getViewPrefs('user-1');
      expect(result).toBeNull();
      expect(userRepository.getViewPrefs).toHaveBeenCalledWith('user-1');
    });

    it('returns stored preferences', async () => {
      const prefs = { theme: 'dark', sidebarCollapsed: true, scheduleViewMode: 'kanban' };
      (userRepository.getViewPrefs as any).mockResolvedValue(prefs);
      const result = await service.getViewPrefs('user-1');
      expect(result).toEqual(prefs);
    });
  });

  describe('updateViewPrefs', () => {
    it('delegates to repository', async () => {
      const prefs = { theme: 'light', aiPanelOpen: false };
      await service.updateViewPrefs('user-1', prefs);
      expect(userRepository.updateViewPrefs).toHaveBeenCalledWith('user-1', prefs);
    });

    it('handles partial updates', async () => {
      const partial = { sidebarCollapsed: true };
      await service.updateViewPrefs('user-1', partial);
      expect(userRepository.updateViewPrefs).toHaveBeenCalledWith('user-1', partial);
    });
  });
});
