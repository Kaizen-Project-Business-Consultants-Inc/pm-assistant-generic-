import { claudeService } from '../claudeService';
import { config } from '../../config';
import { ragService } from '../RagService';
import {
  MitigationAISchema,
  type LessonLearned,
  type MitigationSuggestion,
} from '../../schemas/lessonsLearnedSchemas';
import { mitigationPrompt, triggerConditionPrompt, responsePlanPrompt } from './prompts';

export type SuggestionField = 'mitigation' | 'trigger' | 'response';

const fieldPrompts = {
  mitigation: mitigationPrompt,
  trigger: triggerConditionPrompt,
  response: responsePlanPrompt,
};

const fieldUserMessages: Record<SuggestionField, string> = {
  mitigation: 'Based on the historical lessons and risk, suggest mitigations. Return the JSON.',
  trigger: 'Based on the historical lessons and risk, suggest trigger conditions / early warning signs. Return the JSON.',
  response: 'Based on the historical lessons and risk, suggest response/contingency plans. Return the JSON.',
};

export async function suggestMitigations(
  riskDescription: string,
  projectType: string,
  getAllLessons: () => Promise<LessonLearned[]>,
  findSimilarLessons: (query: string, topK?: number) => Promise<LessonLearned[]>,
  field: SuggestionField = 'mitigation',
): Promise<MitigationSuggestion[]> {
  let relevantLessons: LessonLearned[];

  if (ragService.isAvailable()) {
    relevantLessons = await findSimilarLessons(
      `${riskDescription} ${projectType}`,
      10,
    );
  } else {
    const allLessons = await getAllLessons();
    relevantLessons = allLessons.filter((l) => {
      const typeMatch = l.projectType === projectType;
      const descLower = riskDescription.toLowerCase();
      const categoryMatch =
        descLower.includes(l.category) ||
        l.title.toLowerCase().includes(descLower.split(' ')[0]) ||
        l.description.toLowerCase().includes(descLower.split(' ')[0]);
      return typeMatch || categoryMatch;
    });
  }

  if (config.AI_ENABLED && claudeService.isAvailable() && relevantLessons.length > 0) {
    try {
      const historicalStr = JSON.stringify(
        relevantLessons.map((l) => ({
          id: l.id,
          projectName: l.projectName,
          category: l.category,
          title: l.title,
          description: l.description,
          impact: l.impact,
          recommendation: l.recommendation,
        })),
        null,
        2,
      );

      const prompt = fieldPrompts[field];
      const systemPrompt = prompt.render({
        riskDescription,
        projectType,
        historicalLessons: historicalStr,
      });

      const result = await claudeService.completeWithJsonSchema({
        systemPrompt,
        userMessage: fieldUserMessages[field],
        schema: MitigationAISchema,
        maxTokens: 2048,
      });

      return result.data.suggestions.map((s, i) => ({
        lessonId: relevantLessons[i]?.id,
        source: relevantLessons[i]?.projectName ?? 'AI Analysis',
        relevance: s.relevance,
        suggestion: s.suggestion,
        historicalOutcome: s.historicalOutcome,
      }));
    } catch {
      // Fall through to deterministic suggestions
    }
  }

  return suggestMitigationsDeterministic(riskDescription, relevantLessons);
}

function suggestMitigationsDeterministic(
  riskDescription: string,
  relevantLessons: LessonLearned[],
): MitigationSuggestion[] {
  if (relevantLessons.length === 0) {
    const suggestions: MitigationSuggestion[] = [];
    const descLower = riskDescription.toLowerCase();

    if (descLower.includes('budget') || descLower.includes('cost') || descLower.includes('spend')) {
      suggestions.push({
        source: 'General best practices',
        relevance: 60,
        suggestion: 'Implement weekly budget tracking with earned value metrics. Set up automatic alerts when spending exceeds 80% of allocated amounts.',
      });
    }
    if (descLower.includes('schedule') || descLower.includes('delay') || descLower.includes('timeline')) {
      suggestions.push({
        source: 'General best practices',
        relevance: 60,
        suggestion: 'Review the critical path and add buffer time to high-risk tasks. Increase check-in frequency for tasks on the critical path.',
      });
    }
    if (descLower.includes('resource') || descLower.includes('staff') || descLower.includes('team')) {
      suggestions.push({
        source: 'General best practices',
        relevance: 55,
        suggestion: 'Cross-train team members to reduce single points of failure. Maintain a resource contingency plan for key roles.',
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        source: 'General best practices',
        relevance: 40,
        suggestion: 'Conduct a detailed risk assessment with the project team. Document identified risks in a risk register with assigned owners and response plans.',
      });
    }

    return suggestions;
  }

  return relevantLessons.slice(0, 5).map((lesson) => ({
    lessonId: lesson.id,
    source: lesson.projectName,
    relevance: lesson.confidence,
    suggestion: lesson.recommendation,
    historicalOutcome: lesson.impact === 'negative'
      ? `This issue was observed on the "${lesson.projectName}" project: ${lesson.description}`
      : lesson.impact === 'positive'
        ? `The "${lesson.projectName}" project handled this well: ${lesson.description}`
        : undefined,
  }));
}
