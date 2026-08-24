/**
 * Flesch-Kincaid readability analysis.
 * Client-side mirror of src/server/utils/readingLevel.ts
 */

export interface ReadingLevelResult {
  score: number;
  grade: string;
  level: 'easy' | 'moderate' | 'advanced';
}

export function analyzeReadingLevel(text: string): ReadingLevelResult {
  const sentences = countSentences(text);
  const words = countWords(text);
  const syllables = countSyllables(text);

  if (words === 0 || sentences === 0) {
    return { score: 100, grade: 'K', level: 'easy' };
  }

  const score = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
  const clampedScore = Math.max(0, Math.min(100, Math.round(score * 10) / 10));

  const gradeLevel = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
  const roundedGrade = Math.max(0, Math.round(gradeLevel * 10) / 10);

  const grade = roundedGrade <= 1 ? 'K' : roundedGrade.toFixed(0);

  let level: ReadingLevelResult['level'];
  if (clampedScore >= 60) {
    level = 'easy';
  } else if (clampedScore >= 30) {
    level = 'moderate';
  } else {
    level = 'advanced';
  }

  return { score: clampedScore, grade, level };
}

function countSentences(text: string): number {
  const matches = text.match(/[.!?]+/g);
  return matches ? matches.length : 1;
}

function countWords(text: string): number {
  const matches = text.trim().split(/\s+/).filter(w => w.length > 0);
  return matches.length;
}

function countSyllables(text: string): number {
  const words = text.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
  return words.reduce((sum, word) => sum + countWordSyllables(word), 0);
}

function countWordSyllables(word: string): number {
  word = word.replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;

  word = word.replace(/(?:[^leas])e$/, '');
  word = word.replace(/^re/, 're');

  const matches = word.match(/[aeiouy]+/g);
  let count = matches ? matches.length : 1;

  if (word.match(/(?:ia|ious|eous)$/)) count++;

  return Math.max(1, count);
}
