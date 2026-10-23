import { describe, it, expect } from 'vitest';
import { toSpeechText, endsWithQuestion } from '../../utils/speechText';

describe('toSpeechText', () => {
  it('drops bold/italic marks', () => {
    expect(toSpeechText('This is **very** _important_')).toBe('This is very important');
  });
  it('reads bullets and headings as plain lines', () => {
    expect(toSpeechText('## Plan\n- **Task A** is late\n- Task B')).toBe('Plan. Task A is late. Task B');
  });
  it('keeps link words, not urls', () => {
    expect(toSpeechText('See [the guide](https://x.io/a)')).toBe('See the guide');
  });
  it('skips code blocks and table dividers', () => {
    expect(toSpeechText('Hi\n```\nx=1\n```\n| a | b |\n|---|---|')).not.toMatch(/[*`|-]/);
  });
  it('returns empty for symbols only', () => {
    expect(toSpeechText('**')).toBe('');
  });

  it('detects a closing question, even in bold or brackets', () => {
    expect(endsWithQuestion('Done. Want me to move it?')).toBe(true);
    expect(endsWithQuestion('Done. **Shall I continue?**')).toBe(true);
    expect(endsWithQuestion('Done. (Anything else?)')).toBe(true);
  });
  it('does not open the mic for a statement or a mid-text question', () => {
    expect(endsWithQuestion('Why late? Because of the holiday.')).toBe(false);
    expect(endsWithQuestion('All done.')).toBe(false);
  });
  it('reads a table row by row without stray commas', () => {
    expect(toSpeechText(['| Task | Owner |', '|---|---|', '| Build | Ann |'].join('\n'))).toBe('Task, Owner. Build, Ann');
  });
});
