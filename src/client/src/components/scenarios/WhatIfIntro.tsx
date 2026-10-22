import { ROUTES } from '../../routes';
import { InfoTip } from '../ui/InfoTip';

/**
 * The line at the top of both What-If screens (U74, approved mock
 * https://claude.ai/artifact/D94EMU7a1MfJDvcQPMjeGk): nothing in the plan changes, and how to use it.
 */
export function WhatIfIntro({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 ${className}`}>
      <InfoTip title="What-If" guide={`${ROUTES.helpFull}#what-if-scenario-modeling`}>
        A quick estimate of what a change would do to the schedule, budget, people and risk. The sliders give a
        rules-based estimate; your description lets the AI add detail when it is available.
      </InfoTip>
      <span>
        Try a change before you make it. <strong>Nothing in your plan changes.</strong> Describe the change, move one or
        more sliders, then run it.
      </span>
    </div>
  );
}
