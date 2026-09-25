/**
 * Schedule Review — what a good plan looks like for each kind of project.
 *
 * Deterministic keyword matching over task names: no AI, same input → same result.
 * A phase or milestone "exists" when any task name (phase, summary or leaf) matches one of
 * its patterns. Patterns are deliberately broad — a false "missing" costs the PM trust, a
 * false "present" only costs a suggestion — so they err towards finding a match.
 *
 * Only software-family types have profiles so far (user's first priority, 2026-09-25):
 * IT (SDLC for Waterfall/Hybrid, Agile for Agile), Web Design, Web Application,
 * App Development. Other types get the general rules only.
 */

export type Methodology = 'waterfall' | 'agile' | 'hybrid' | string | null | undefined;

export interface Expectation {
  /** Shown to the PM: "Testing" */
  label: string;
  patterns: RegExp[];
}

export interface DomainProfile {
  /** Shown in messages: "an IT project run as Waterfall (SDLC)" */
  description: string;
  /** Leaf tasks longer than this many working days are flagged (R13). */
  longTaskWorkingDays: number;
  phases: Expectation[];
  milestones: Expectation[];
}

const re = (...parts: string[]) => parts.map(p => new RegExp(p, 'i'));

// Shared vocabulary -------------------------------------------------------------

const REQUIREMENTS = re('requirement', '\\bdiscovery\\b', '\\bscop(e|ing)\\b', 'business case', 'analysis', 'system study', 'user stor', '\\bbrd\\b', 'inception', 'kick-?off', 'workshop');
const DESIGN = re('design', 'architecture', 'specification', '\\bspecs?\\b', '\\bssd\\b', 'blueprint', 'wirefram', 'prototype', '\\bux\\b', '\\bui\\b', 'mock-?up');
const BUILD = re('develop', '\\bbuild', 'implement', 'configur', '\\bcod(e|ing)\\b', 'integration', 'front-?end', 'back-?end', '\\bapi\\b', 'set-?up');
const TESTING = re('\\btest', '\\bqa\\b', 'quality assurance', '\\bsit\\b', '\\buat\\b', 'verification', 'validation', '\\bbeta\\b', 'testflight');
const DEPLOY = re('deploy', 'go[\\s-]?live', 'release', 'cut-?over', 'launch', 'roll-?out', 'production', 'handover', 'hand-?off');
const SPRINTS = re('\\bsprint', 'iteration');
const BACKLOG = re('backlog', 'refinement', 'grooming', 'user stor', '\\bepics?\\b', 'discovery', 'requirement');

const SIGNOFF = '(sign[\\s-]?off|approv|accept|agreed|baselined?|complete)';

// Profiles ---------------------------------------------------------------------

const IT_SDLC: DomainProfile = {
  description: 'an IT project run as Waterfall (SDLC)',
  longTaskWorkingDays: 15,
  phases: [
    { label: 'Requirements', patterns: REQUIREMENTS },
    { label: 'Design', patterns: DESIGN },
    { label: 'Build', patterns: BUILD },
    { label: 'Testing', patterns: TESTING },
    { label: 'Deployment', patterns: DEPLOY },
  ],
  milestones: [
    { label: 'Requirements or design sign-off', patterns: re(`(requirement|scope|design|specification|\\bssd\\b|inception|\\bbrd\\b).*${SIGNOFF}`, `${SIGNOFF}.*(requirement|scope|design|specification|\\bssd\\b|inception)`) },
    { label: 'UAT sign-off', patterns: re('\\buat\\b', 'user acceptance', 'acceptance test') },
    { label: 'Go-live', patterns: re('go[\\s-]?live', 'launch', 'release', 'cut-?over', 'production') },
  ],
};

const IT_AGILE: DomainProfile = {
  description: 'an IT project run as Agile',
  longTaskWorkingDays: 15,
  phases: [
    { label: 'Backlog / discovery', patterns: BACKLOG },
    { label: 'Sprints', patterns: SPRINTS },
    { label: 'Testing', patterns: TESTING },
    { label: 'Release', patterns: DEPLOY },
  ],
  milestones: [
    { label: 'Release', patterns: re('release', 'go[\\s-]?live', 'launch', '\\bmvp\\b', 'production') },
  ],
};

const WEB_DESIGN: DomainProfile = {
  description: 'a web design project',
  longTaskWorkingDays: 10,
  phases: [
    { label: 'Discovery / brief', patterns: re('discovery', '\\bbrief', 'requirement', 'research', 'kick-?off', 'workshop', '\\bscop(e|ing)\\b') },
    { label: 'Wireframes / UX', patterns: re('wirefram', '\\bux\\b', 'user experience', 'site ?map', 'information architecture', 'prototype', 'user journey') },
    { label: 'Visual design', patterns: re('visual design', '\\bui\\b', 'mock-?up', 'style ?guide', 'look and feel', 'branding', 'design') },
    { label: 'Content', patterns: re('content', 'copy', 'imagery', 'photograph', '\\bassets?\\b', '\\bseo\\b') },
    { label: 'Review and approval', patterns: re('review', 'approv', 'sign[\\s-]?off', 'feedback', 'revision') },
    { label: 'Launch / handover', patterns: DEPLOY.concat(re('publish')) },
  ],
  milestones: [
    { label: 'Design approved', patterns: re(`design.*${SIGNOFF}`, `${SIGNOFF}.*design`) },
    { label: 'Site launch', patterns: re('launch', 'go[\\s-]?live', 'publish', 'handover') },
  ],
};

const WEB_APPLICATION_WATERFALL: DomainProfile = {
  description: 'a web application project',
  longTaskWorkingDays: 10,
  phases: [
    { label: 'Discovery / requirements', patterns: REQUIREMENTS },
    { label: 'UX/UI design', patterns: DESIGN },
    { label: 'Front end', patterns: re('front-?end', 'client[\\s-]?side', '\\bui build', 'react', 'angular', '\\bvue\\b', 'web app', 'portal', 'interface') },
    { label: 'Back end / API', patterns: re('back-?end', '\\bapi\\b', 'server', 'database', 'integration', 'services?\\b') },
    { label: 'Testing', patterns: TESTING },
    { label: 'Deployment', patterns: DEPLOY },
  ],
  milestones: [
    { label: 'Design approved', patterns: re(`design.*${SIGNOFF}`, `${SIGNOFF}.*design`) },
    { label: 'UAT or beta', patterns: re('\\buat\\b', '\\bbeta\\b', 'user acceptance', 'pilot') },
    { label: 'Production release', patterns: re('release', 'go[\\s-]?live', 'launch', 'production') },
  ],
};

const APP_DEVELOPMENT_WATERFALL: DomainProfile = {
  description: 'an app development project',
  longTaskWorkingDays: 10,
  phases: [
    { label: 'Requirements', patterns: REQUIREMENTS },
    { label: 'UX/UI design', patterns: DESIGN },
    { label: 'Development', patterns: BUILD.concat(re('flutter', '\\bios\\b', 'android', 'mobile')) },
    { label: 'Testing', patterns: TESTING },
    { label: 'Store release', patterns: re('app ?store', 'play ?store', 'google play', 'store submission', 'publish', 'release', 'launch', 'go[\\s-]?live') },
  ],
  milestones: [
    { label: 'Design approved', patterns: re(`design.*${SIGNOFF}`, `${SIGNOFF}.*design`) },
    { label: 'Beta / TestFlight', patterns: re('\\bbeta\\b', 'testflight', '\\buat\\b', 'pilot', 'internal testing') },
    { label: 'Store release', patterns: re('app ?store', 'play ?store', 'store (approval|submission|release)', 'release', 'launch', 'go[\\s-]?live') },
  ],
};

/** Agile web / app work: same kind of plan as Agile IT, with the type's own length limit. */
function agileVariant(base: DomainProfile, description: string): DomainProfile {
  return { ...IT_AGILE, description, longTaskWorkingDays: base.longTaskWorkingDays };
}

/**
 * The profile for a project, or null when the type has none yet (general rules only).
 * Hybrid is planned like Waterfall: phases up front, sprints inside the build.
 */
export function profileFor(projectType?: string | null, methodology?: Methodology): DomainProfile | null {
  const agile = methodology === 'agile';
  switch (projectType) {
    case 'it': return agile ? IT_AGILE : IT_SDLC;
    case 'web_design': return WEB_DESIGN;
    case 'web_application': return agile ? agileVariant(WEB_APPLICATION_WATERFALL, 'a web application project run as Agile') : WEB_APPLICATION_WATERFALL;
    case 'app_development': return agile ? agileVariant(APP_DEVELOPMENT_WATERFALL, 'an app development project run as Agile') : APP_DEVELOPMENT_WATERFALL;
    default: return null;
  }
}

export function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}
