/**
 * Transcript file parsers for VTT (Teams/Zoom), SRT, and Otter.ai formats.
 * Detects format from filename + content, parses into structured segments,
 * and produces a clean transcript string for AI analysis.
 */

export interface TranscriptSegment {
  speaker: string;
  timestamp: string; // normalized "H:MM:SS"
  text: string;
}

export type TranscriptFormat = 'vtt' | 'srt' | 'otter' | 'unknown';

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export function detectFormat(filename: string, content: string): TranscriptFormat {
  const trimmed = content.trimStart();

  // VTT: starts with "WEBVTT"
  if (trimmed.startsWith('WEBVTT')) return 'vtt';

  // SRT: first non-blank line is a digit, second line has "-->" with comma timestamps
  const lines = trimmed.split(/\r?\n/);
  const firstNonBlank = lines.find(l => l.trim().length > 0);
  if (firstNonBlank && /^\d+$/.test(firstNonBlank.trim())) {
    const nextIdx = lines.indexOf(firstNonBlank) + 1;
    if (nextIdx < lines.length && /-->/.test(lines[nextIdx]) && /,/.test(lines[nextIdx])) {
      return 'srt';
    }
  }

  // Otter: lines match "SpeakerName  H:MM" or "SpeakerName  HH:MM" pattern
  const otterPattern = /^[A-Za-z][\w\s'-]*\s{2,}\d{1,2}:\d{2}$/;
  const otterMatches = lines.filter(l => otterPattern.test(l.trim())).length;
  if (otterMatches >= 2) return 'otter';

  // Extension hint
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'vtt') return 'vtt';
  if (ext === 'srt') return 'srt';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Timestamp normalization
// ---------------------------------------------------------------------------

function normalizeTimestamp(ts: string): string {
  // Accept HH:MM:SS.mmm, H:MM:SS, H:MM, MM:SS, etc.
  const cleaned = ts.replace(/[,.].*$/, '').trim(); // strip fractional part
  const parts = cleaned.split(':').map(p => parseInt(p, 10));

  if (parts.length === 3) {
    return `${parts[0]}:${String(parts[1]).padStart(2, '0')}:${String(parts[2]).padStart(2, '0')}`;
  }
  if (parts.length === 2) {
    // Could be M:SS or H:MM — if first part > 59, treat as H:MM
    return `0:${String(parts[0]).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}`;
  }
  return '0:00:00';
}

// ---------------------------------------------------------------------------
// VTT Parser (Teams <v Speaker> and Zoom "Speaker:" formats)
// ---------------------------------------------------------------------------

export function parseVtt(content: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = content.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 2) continue;

    // Find timestamp line
    const tsLineIdx = lines.findIndex(l => /-->/.test(l));
    if (tsLineIdx < 0) continue;

    const tsParts = lines[tsLineIdx].split('-->');
    const timestamp = normalizeTimestamp(tsParts[0].trim());

    // Text lines are after the timestamp
    const textLines = lines.slice(tsLineIdx + 1).join(' ').trim();
    if (!textLines) continue;

    // Extract speaker from Teams <v SpeakerName>text</v> format
    const vMatch = textLines.match(/^<v\s+([^>]+)>(.+?)(?:<\/v>)?$/s);
    if (vMatch) {
      segments.push({
        speaker: vMatch[1].trim(),
        timestamp,
        text: vMatch[2].replace(/<[^>]*>/g, '').trim(),
      });
      continue;
    }

    // Extract speaker from "Speaker: text" format (Zoom)
    const colonMatch = textLines.match(/^([A-Za-z][\w\s'-]{0,60}):\s+(.+)$/s);
    if (colonMatch) {
      segments.push({
        speaker: colonMatch[1].trim(),
        timestamp,
        text: colonMatch[2].replace(/<[^>]*>/g, '').trim(),
      });
      continue;
    }

    // No speaker detected
    segments.push({
      speaker: 'Unknown',
      timestamp,
      text: textLines.replace(/<[^>]*>/g, '').trim(),
    });
  }

  return collapseConsecutiveSpeakers(segments);
}

// ---------------------------------------------------------------------------
// SRT Parser
// ---------------------------------------------------------------------------

export function parseSrt(content: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = content.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 3) continue;

    // Line 0: sequence number (skip)
    // Line 1: timestamps
    const tsLine = lines[1];
    if (!/-->/.test(tsLine)) continue;

    const tsParts = tsLine.split('-->');
    const timestamp = normalizeTimestamp(tsParts[0].trim());

    // Lines 2+: text
    const textLines = lines.slice(2).join(' ').trim();
    if (!textLines) continue;

    // Optional speaker prefix: "Speaker: text"
    const colonMatch = textLines.match(/^([A-Za-z][\w\s'-]{0,60}):\s+(.+)$/s);
    if (colonMatch) {
      segments.push({
        speaker: colonMatch[1].trim(),
        timestamp,
        text: colonMatch[2].trim(),
      });
    } else {
      segments.push({
        speaker: 'Unknown',
        timestamp,
        text: textLines,
      });
    }
  }

  return collapseConsecutiveSpeakers(segments);
}

// ---------------------------------------------------------------------------
// Otter.ai Parser ("SpeakerName  H:MM" header + text block)
// ---------------------------------------------------------------------------

export function parseOtter(content: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = content.split(/\r?\n/);
  const headerPattern = /^([A-Za-z][\w\s'-]*?)\s{2,}(\d{1,2}:\d{2})$/;

  let currentSpeaker = '';
  let currentTimestamp = '';
  let currentText: string[] = [];

  for (const line of lines) {
    const match = line.trim().match(headerPattern);
    if (match) {
      // Save previous segment
      if (currentSpeaker && currentText.length > 0) {
        segments.push({
          speaker: currentSpeaker,
          timestamp: normalizeTimestamp(currentTimestamp),
          text: currentText.join(' ').trim(),
        });
      }
      currentSpeaker = match[1].trim();
      currentTimestamp = match[2];
      currentText = [];
    } else if (line.trim()) {
      currentText.push(line.trim());
    }
  }

  // Last segment
  if (currentSpeaker && currentText.length > 0) {
    segments.push({
      speaker: currentSpeaker,
      timestamp: normalizeTimestamp(currentTimestamp),
      text: currentText.join(' ').trim(),
    });
  }

  return collapseConsecutiveSpeakers(segments);
}

// ---------------------------------------------------------------------------
// Collapse consecutive segments from the same speaker
// ---------------------------------------------------------------------------

function collapseConsecutiveSpeakers(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length === 0) return segments;

  const result: TranscriptSegment[] = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = result[result.length - 1];
    if (segments[i].speaker === prev.speaker) {
      prev.text += ' ' + segments[i].text;
    } else {
      result.push({ ...segments[i] });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Convert parsed segments to a clean transcript string for AI
// ---------------------------------------------------------------------------

export function segmentsToTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map(s => `[${s.speaker}] (${s.timestamp})\n${s.text}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Main entry point: parse a transcript file
// ---------------------------------------------------------------------------

export function parseTranscriptFile(
  filename: string,
  content: string,
): { format: TranscriptFormat; segments: TranscriptSegment[]; transcript: string } {
  const format = detectFormat(filename, content);

  let segments: TranscriptSegment[];
  switch (format) {
    case 'vtt':
      segments = parseVtt(content);
      break;
    case 'srt':
      segments = parseSrt(content);
      break;
    case 'otter':
      segments = parseOtter(content);
      break;
    default:
      segments = [];
      break;
  }

  const transcript = segments.length > 0
    ? segmentsToTranscript(segments)
    : content; // unknown format: pass raw text to AI

  return { format, segments, transcript };
}
