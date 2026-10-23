import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoice } from '../../hooks/useVoice';

let utterances: Array<{ text: string; onend: (() => void) | null }>;
let recStart: ReturnType<typeof vi.fn>;

beforeEach(() => {
  utterances = [];
  recStart = vi.fn();
  class FakeUtterance { text: string; rate = 1; onend: (() => void) | null = null; constructor(t: string) { this.text = t; utterances.push(this); } }
  class FakeRecognition { continuous = false; interimResults = false; lang = ''; start = recStart; stop = vi.fn(); abort = vi.fn(); onresult = null; onend = null; onerror = null; }
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  Object.assign(window, { SpeechRecognition: FakeRecognition });
  Object.assign(window, { speechSynthesis: { speak: vi.fn(), cancel: vi.fn() } });
});

describe('useVoice', () => {
  it('speaks plain words, not markdown symbols', () => {
    const { result } = renderHook(() => useVoice());
    act(() => result.current.speak('This is **late**'));
    expect(utterances[0].text).toBe('This is late');
  });

  it('calls onDone when speech ends', () => {
    const { result } = renderHook(() => useVoice());
    const done = vi.fn();
    act(() => result.current.speak('Ready?', done));
    utterances[0].onend?.();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('does not call onDone for speech that was replaced or cancelled', () => {
    const { result } = renderHook(() => useVoice());
    const done = vi.fn();
    act(() => result.current.speak('First?', done));
    const first = utterances[0];
    act(() => result.current.speak('Second.'));
    first.onend?.();
    expect(done).not.toHaveBeenCalled();
    act(() => result.current.speak('Third?', done));
    act(() => result.current.cancelSpeech());
    utterances[2].onend?.();
    expect(done).not.toHaveBeenCalled();
  });

  it('reports speaking until the voice ends or is stopped', () => {
    const { result } = renderHook(() => useVoice());
    expect(result.current.isSpeaking).toBe(false);
    act(() => result.current.speak('Hello there'));
    expect(result.current.isSpeaking).toBe(true);
    act(() => result.current.cancelSpeech());
    expect(result.current.isSpeaking).toBe(false);
    act(() => result.current.speak('Again'));
    act(() => utterances[1].onend?.());
    expect(result.current.isSpeaking).toBe(false);
  });

  it('does not start recognition twice', () => {
    const { result } = renderHook(() => useVoice());
    act(() => result.current.startListening(() => {}));
    act(() => result.current.startListening(() => {}));
    expect(recStart).toHaveBeenCalledTimes(1);
  });
});
