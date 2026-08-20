import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  parseVtt,
  parseSrt,
  parseOtter,
  segmentsToTranscript,
  parseTranscriptFile,
} from '../../utils/transcriptParser';

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

describe('detectFormat', () => {
  it('detects VTT from content', () => {
    expect(detectFormat('meeting.txt', 'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nHello')).toBe('vtt');
  });

  it('detects SRT from content', () => {
    const srt = '1\n00:00:01,000 --> 00:00:05,000\nHello world';
    expect(detectFormat('meeting.txt', srt)).toBe('srt');
  });

  it('detects Otter from content', () => {
    const otter = 'John Smith  0:05\nHello everyone.\n\nJane Doe  1:22\nThanks for joining.';
    expect(detectFormat('meeting.txt', otter)).toBe('otter');
  });

  it('falls back to extension for VTT', () => {
    expect(detectFormat('meeting.vtt', 'some random content')).toBe('vtt');
  });

  it('falls back to extension for SRT', () => {
    expect(detectFormat('meeting.srt', 'some random content')).toBe('srt');
  });

  it('returns unknown for unrecognized content', () => {
    expect(detectFormat('notes.txt', 'Just some meeting notes about the project.')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// parseVtt
// ---------------------------------------------------------------------------

describe('parseVtt', () => {
  it('parses Teams <v Speaker> format', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v John Smith>Hello everyone, welcome to the meeting.</v>

00:00:05.500 --> 00:00:10.000
<v Jane Doe>Thanks John. Let's get started.</v>`;

    const segments = parseVtt(vtt);
    expect(segments).toHaveLength(2);
    expect(segments[0].speaker).toBe('John Smith');
    expect(segments[0].timestamp).toBe('0:00:01');
    expect(segments[0].text).toBe('Hello everyone, welcome to the meeting.');
    expect(segments[1].speaker).toBe('Jane Doe');
  });

  it('parses Zoom "Speaker: text" format', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:05.000
John Smith: Hello everyone.

00:00:06.000 --> 00:00:10.000
Jane Doe: Welcome to the sprint review.`;

    const segments = parseVtt(vtt);
    expect(segments).toHaveLength(2);
    expect(segments[0].speaker).toBe('John Smith');
    expect(segments[1].speaker).toBe('Jane Doe');
  });

  it('collapses consecutive same-speaker segments', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<v John Smith>Hello everyone.</v>

00:00:03.500 --> 00:00:06.000
<v John Smith>Welcome to the meeting.</v>

00:00:07.000 --> 00:00:10.000
<v Jane Doe>Thanks John.</v>`;

    const segments = parseVtt(vtt);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe('Hello everyone. Welcome to the meeting.');
  });

  it('handles segments without speaker', () => {
    const vtt = `WEBVTT

00:01:30.000 --> 00:01:35.000
Some text without speaker attribution`;

    const segments = parseVtt(vtt);
    expect(segments).toHaveLength(1);
    expect(segments[0].speaker).toBe('Unknown');
    expect(segments[0].text).toBe('Some text without speaker attribution');
  });
});

// ---------------------------------------------------------------------------
// parseSrt
// ---------------------------------------------------------------------------

describe('parseSrt', () => {
  it('parses standard SRT with speaker prefix', () => {
    const srt = `1
00:00:01,000 --> 00:00:05,000
John: Hello everyone.

2
00:00:06,000 --> 00:00:10,000
Jane: Let's discuss the roadmap.`;

    const segments = parseSrt(srt);
    expect(segments).toHaveLength(2);
    expect(segments[0].speaker).toBe('John');
    expect(segments[0].timestamp).toBe('0:00:01');
    expect(segments[1].speaker).toBe('Jane');
    expect(segments[1].text).toBe("Let's discuss the roadmap.");
  });

  it('parses SRT without speaker prefix (consecutive Unknown collapsed)', () => {
    const srt = `1
00:00:01,000 --> 00:00:05,000
Hello world

2
00:00:06,000 --> 00:00:10,000
Testing`;

    const segments = parseSrt(srt);
    // Consecutive same-speaker segments are collapsed
    expect(segments).toHaveLength(1);
    expect(segments[0].speaker).toBe('Unknown');
    expect(segments[0].text).toBe('Hello world Testing');
  });

  it('collapses consecutive same-speaker segments', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
John: First sentence.

2
00:00:03,500 --> 00:00:06,000
John: Second sentence.

3
00:00:07,000 --> 00:00:10,000
Jane: Reply.`;

    const segments = parseSrt(srt);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe('First sentence. Second sentence.');
  });
});

// ---------------------------------------------------------------------------
// parseOtter
// ---------------------------------------------------------------------------

describe('parseOtter', () => {
  it('parses Otter.ai format', () => {
    const otter = `John Smith  0:05
Hello everyone. Welcome to the sprint review meeting.

Jane Doe  1:22
Thanks John. Let me share the progress update.

John Smith  3:45
Great, that looks good. Any blockers?`;

    const segments = parseOtter(otter);
    expect(segments).toHaveLength(3);
    expect(segments[0].speaker).toBe('John Smith');
    expect(segments[0].timestamp).toBe('0:00:05');
    expect(segments[0].text).toBe('Hello everyone. Welcome to the sprint review meeting.');
    expect(segments[1].speaker).toBe('Jane Doe');
    expect(segments[1].timestamp).toBe('0:01:22');
    expect(segments[2].speaker).toBe('John Smith');
    expect(segments[2].text).toBe('Great, that looks good. Any blockers?');
  });

  it('handles multi-line text blocks', () => {
    const otter = `Speaker A  2:30
This is line one.
This is line two.
And line three.`;

    const segments = parseOtter(otter);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe('This is line one. This is line two. And line three.');
  });
});

// ---------------------------------------------------------------------------
// segmentsToTranscript
// ---------------------------------------------------------------------------

describe('segmentsToTranscript', () => {
  it('formats segments into readable transcript', () => {
    const result = segmentsToTranscript([
      { speaker: 'John', timestamp: '0:00:05', text: 'Hello' },
      { speaker: 'Jane', timestamp: '0:01:22', text: 'Hi there' },
    ]);
    expect(result).toBe('[John] (0:00:05)\nHello\n\n[Jane] (0:01:22)\nHi there');
  });
});

// ---------------------------------------------------------------------------
// parseTranscriptFile (integration)
// ---------------------------------------------------------------------------

describe('parseTranscriptFile', () => {
  it('auto-detects and parses VTT', () => {
    const content = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v John>Hello</v>`;

    const result = parseTranscriptFile('meeting.vtt', content);
    expect(result.format).toBe('vtt');
    expect(result.segments).toHaveLength(1);
    expect(result.transcript).toContain('[John]');
  });

  it('returns raw content for unknown format', () => {
    const content = 'Just random meeting notes about the project status.';
    const result = parseTranscriptFile('notes.txt', content);
    expect(result.format).toBe('unknown');
    expect(result.segments).toHaveLength(0);
    expect(result.transcript).toBe(content);
  });
});
