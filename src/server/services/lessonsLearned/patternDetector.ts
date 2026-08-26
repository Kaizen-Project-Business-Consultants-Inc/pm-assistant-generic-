import { claudeService } from '../claudeService';
import { config } from '../../config';
import {
  PatternDetectionAISchema,
  type LessonLearned,
  type Pattern,
} from '../../schemas/lessonsLearnedSchemas';
import { patternDetectionPrompt } from './prompts';

export async function detectPatterns(
  lessons: LessonLearned[],
  persistPatterns: (patterns: Pattern[]) => Promise<void>,
): Promise<Pattern[]> {
  if (lessons.length === 0) {
    return [];
  }

  if (config.AI_ENABLED && claudeService.isAvailable()) {
    try {
      const lessonsDataStr = JSON.stringify(
        lessons.map((l) => ({
          projectName: l.projectName,
          projectType: l.projectType,
          category: l.category,
          title: l.title,
          description: l.description,
          impact: l.impact,
          recommendation: l.recommendation,
        })),
        null,
        2,
      );

      const systemPrompt = patternDetectionPrompt.render({
        lessonsData: lessonsDataStr,
      });

      const result = await claudeService.completeWithJsonSchema({
        systemPrompt,
        userMessage: 'Analyze these lessons learned and identify cross-project patterns. Return the JSON.',
        schema: PatternDetectionAISchema,
        maxTokens: 4096,
      });

      const now = new Date().toISOString();
      const newPatterns: Pattern[] = result.data.patterns.map((p, i) => ({
        id: `pat-${Date.now()}-${i}`,
        title: p.title,
        description: p.description,
        frequency: p.frequency,
        projectTypes: p.projectTypes,
        category: p.category,
        recommendation: p.recommendation,
        confidence: p.confidence,
        detectedAt: now,
      }));

      await persistPatterns(newPatterns);
      return newPatterns;
    } catch {
      // Fall through to deterministic detection
    }
  }

  return detectPatternsDeterministic(lessons, persistPatterns);
}

async function detectPatternsDeterministic(
  lessons: LessonLearned[],
  persistPatterns: (patterns: Pattern[]) => Promise<void>,
): Promise<Pattern[]> {
  const categoryGroups: Record<string, LessonLearned[]> = {};

  for (const lesson of lessons) {
    if (!categoryGroups[lesson.category]) {
      categoryGroups[lesson.category] = [];
    }
    categoryGroups[lesson.category].push(lesson);
  }

  const detectedPatterns: Pattern[] = [];
  let counter = 0;
  const now = new Date().toISOString();

  for (const [category, categoryLessons] of Object.entries(categoryGroups)) {
    if (categoryLessons.length < 2) continue;

    const negativeCount = categoryLessons.filter((l) => l.impact === 'negative').length;
    const positiveCount = categoryLessons.filter((l) => l.impact === 'positive').length;
    const projectTypes = Array.from(new Set(categoryLessons.map((l) => l.projectType)));
    const projectCount = Array.from(new Set(categoryLessons.map((l) => l.projectId))).length;

    if (negativeCount >= 2) {
      detectedPatterns.push({
        id: `pat-det-${++counter}`,
        title: `Recurring ${category} issues across projects`,
        description: `${negativeCount} negative ${category}-related lessons found across ${projectCount} project(s). This is a systemic area requiring attention.`,
        frequency: projectCount,
        projectTypes,
        category,
        recommendation: `Establish organization-wide ${category} management standards and conduct retrospectives focused on ${category} challenges.`,
        confidence: Math.min(90, 50 + negativeCount * 10),
        detectedAt: now,
      });
    }

    if (positiveCount >= 2) {
      detectedPatterns.push({
        id: `pat-det-${++counter}`,
        title: `Consistent ${category} strengths`,
        description: `${positiveCount} positive ${category}-related lessons found across ${projectCount} project(s). These successes can be replicated.`,
        frequency: projectCount,
        projectTypes,
        category,
        recommendation: `Document and standardize the ${category} practices that led to positive outcomes across these projects.`,
        confidence: Math.min(85, 45 + positiveCount * 10),
        detectedAt: now,
      });
    }
  }

  await persistPatterns(detectedPatterns);
  return detectedPatterns;
}
