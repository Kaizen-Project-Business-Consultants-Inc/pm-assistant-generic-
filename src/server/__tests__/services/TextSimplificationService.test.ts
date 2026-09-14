import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before import
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: vi.fn(),
    complete: vi.fn(),
  },
}));

import { TextSimplificationService } from '../../services/TextSimplificationService';
import { claudeService } from '../../services/claudeService';

describe('TextSimplificationService', () => {
  let service: TextSimplificationService;
  const mockIsAvailable = claudeService.isAvailable as ReturnType<typeof vi.fn>;
  const mockComplete = claudeService.complete as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TextSimplificationService();
  });

  describe('simplify', () => {
    it('returns original text when AI is not available', async () => {
      mockIsAvailable.mockReturnValue(false);
      const input = 'This is a complex sentence with multifaceted terminology.';
      const result = await service.simplify(input, 'mild');
      expect(result).toBe(input);
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns original text when AI is not available (strong level)', async () => {
      mockIsAvailable.mockReturnValue(false);
      const input = 'Technical jargon and obfuscated language.';
      const result = await service.simplify(input, 'strong');
      expect(result).toBe(input);
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('calls Claude with mild instruction for mild level', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({
        content: 'This is a simpler sentence.',
      });

      const input = 'This is a complex sentence with multifaceted terminology.';
      const result = await service.simplify(input, 'mild');

      expect(result).toBe('This is a simpler sentence.');
      expect(mockComplete).toHaveBeenCalledOnce();

      const callArg = mockComplete.mock.calls[0][0];
      expect(callArg.systemPrompt).toContain('slightly easier to read');
      expect(callArg.systemPrompt).toContain('simpler words');
      expect(callArg.userMessage).toBe(input);
      expect(callArg.temperature).toBe(0.3);
    });

    it('calls Claude with strong instruction for strong level', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({
        content: 'This is easy to read.',
      });

      const input = 'Obfuscated verbiage requiring simplification.';
      const result = await service.simplify(input, 'strong');

      expect(result).toBe('This is easy to read.');
      expect(mockComplete).toHaveBeenCalledOnce();

      const callArg = mockComplete.mock.calls[0][0];
      expect(callArg.systemPrompt).toContain('6th-grade reading level');
      expect(callArg.systemPrompt).toContain('short sentences');
      expect(callArg.userMessage).toBe(input);
    });

    it('trims whitespace from Claude response', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({
        content: '  Simplified text with extra whitespace.  \n',
      });

      const result = await service.simplify('Input text.', 'mild');
      expect(result).toBe('Simplified text with extra whitespace.');
    });

    it('returns original text when Claude call throws an error', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockRejectedValue(new Error('API timeout'));

      const input = 'Original text that should be returned on error.';
      const result = await service.simplify(input, 'mild');
      expect(result).toBe(input);
    });

    it('returns original text when Claude call throws a non-Error', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockRejectedValue('string error');

      const input = 'Original text.';
      const result = await service.simplify(input, 'strong');
      expect(result).toBe(input);
    });

    it('calculates maxTokens as max(500, ceil(text.length * 1.5))', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({ content: 'Short.' });

      // Short text: length 5 * 1.5 = 7.5, ceil = 8, max(500, 8) = 500
      await service.simplify('Hello', 'mild');
      expect(mockComplete.mock.calls[0][0].maxTokens).toBe(500);

      mockComplete.mockClear();

      // Long text: 400 chars * 1.5 = 600, max(500, 600) = 600
      const longText = 'A'.repeat(400);
      await service.simplify(longText, 'strong');
      expect(mockComplete.mock.calls[0][0].maxTokens).toBe(600);
    });

    it('handles empty string input', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({ content: '' });

      const result = await service.simplify('', 'mild');
      expect(result).toBe('');
      expect(mockComplete).toHaveBeenCalledOnce();
      expect(mockComplete.mock.calls[0][0].maxTokens).toBe(500);
    });

    it('passes the system prompt with plain-language assistant preamble', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({ content: 'Simplified.' });

      await service.simplify('Some text.', 'mild');

      const callArg = mockComplete.mock.calls[0][0];
      expect(callArg.systemPrompt).toContain('You are a plain-language writing assistant');
      expect(callArg.systemPrompt).toContain('Return only the rewritten text, no commentary');
    });
  });
});
