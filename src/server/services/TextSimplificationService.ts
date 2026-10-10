import { claudeService } from './claudeService';

export class TextSimplificationService {
  async simplify(text: string, level: 'mild' | 'strong'): Promise<string> {
    if (!claudeService.isAvailable()) {
      return text;
    }

    const instruction = level === 'mild'
      ? 'Rewrite this text to be slightly easier to read. Use simpler words where possible, but keep the meaning intact. Keep roughly the same length.'
      : 'Rewrite this text at a 6th-grade reading level. Use short sentences, simple words, and remove jargon. Explain any technical terms briefly.';

    try {
      const result = await claudeService.complete({
        systemPrompt: `You are a plain-language writing assistant. ${instruction} Return only the rewritten text, no commentary.`,
        userMessage: text,
        // About one token per 4 characters, with room to spare; never more than one bounded answer
        // (it was 1.5 per character: up to 75k tokens, past the model's limit — audit 2026-10-10 M3)
        maxTokens: Math.min(4096, Math.max(500, Math.ceil(text.length / 2))),
        temperature: 0.3,
      });
      return result.content.trim();
    } catch {
      return text;
    }
  }
}

export const textSimplificationService = new TextSimplificationService();
