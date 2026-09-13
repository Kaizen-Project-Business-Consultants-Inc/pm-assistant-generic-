import React from 'react';
import { Clock, ListChecks, Eye } from 'lucide-react';

interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  projectType: string;
  category: string;
  isBuiltIn: boolean;
  estimatedDurationDays: number;
  taskCount: number;
  phaseCount: number;
  tags: string[];
  usageCount: number;
}

interface TemplateCardProps {
  template: TemplateSummary;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({ template, onSelect, onPreview }) => {
  return (
    <div className="card hover:shadow-md transition-shadow duration-200 flex flex-col">
      <div className="flex-1">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-tight">{template.name}</h3>
          {template.isBuiltIn && (
            <span className="text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded flex-shrink-0 ml-2">
              Built-in
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">{template.description}</p>

        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-500 mb-3">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            ~{template.estimatedDurationDays}d
          </span>
          <span className="flex items-center gap-1">
            <ListChecks className="w-3 h-3" />
            {template.phaseCount} phases, {template.taskCount} tasks
          </span>
        </div>

        {template.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {template.tags.slice(0, 4).map(tag => (
              <span key={tag} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={() => onPreview(template.id)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
        >
          <Eye className="w-3 h-3" />
          Preview
        </button>
        <button
          onClick={() => onSelect(template.id)}
          className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
        >
          Select
        </button>
      </div>
    </div>
  );
};
