import { describe, it, expect } from 'vitest';
import { summariesNeedingChoice, deletedHeadingMessage, headingTitle, headingBody } from '../../utils/deleteSummaryChoice';

const t = (id: string, parentTaskId: string | null = null) => ({ id, name: id, parentTaskId });
const plan = [t('phase'), t('sum', 'phase'), t('kid', 'sum'), t('sub', 'sum'), t('deep', 'sub'), t('plain')];

describe('summariesNeedingChoice — when deleting asks "heading only, or its tasks too?"', () => {
  it('a task with nothing under it needs no question', () => {
    expect(summariesNeedingChoice(plan, ['plain'])).toBeNull();
    expect(summariesNeedingChoice(plan, ['kid'])).toBeNull();
  });

  it('a heading with tasks under it asks, counting every level below', () => {
    const c = summariesNeedingChoice(plan, ['sum'])!;
    expect(c.headings.map(h => h.id)).toEqual(['sum']);
    expect(c.below.map(x => x.id).sort()).toEqual(['deep', 'kid', 'sub']);
  });

  it('no question when every task under the heading is selected too', () => {
    expect(summariesNeedingChoice(plan, ['sum', 'kid', 'sub', 'deep'])).toBeNull();
  });

  it('only the tasks left behind count when some are selected too', () => {
    const c = summariesNeedingChoice(plan, ['sum', 'kid'])!;
    expect(c.below.map(x => x.id).sort()).toEqual(['deep', 'sub']);
  });

  it('several headings are named together; a plain task selected beside them is ignored', () => {
    const c = summariesNeedingChoice(plan, ['phase', 'sub', 'plain'])!;
    expect(c.headings.map(h => h.id)).toEqual(['phase', 'sub']);
    expect(c.below.map(x => x.id).sort()).toEqual(['deep', 'kid', 'sum']);
  });

  it('ids that are not in the plan are skipped', () => {
    expect(summariesNeedingChoice(plan, ['nope'])).toBeNull();
  });
});

describe('the words in the question and the Undo message', () => {
  it('names one heading, or counts several', () => {
    expect(headingTitle(summariesNeedingChoice(plan, ['sum'])!)).toBe('Delete "sum"?');
    expect(headingTitle(summariesNeedingChoice(plan, ['phase', 'sub'])!)).toBe('Delete 2 headings?');
  });
  it('says how many tasks are under it, naming a few', () => {
    expect(headingBody(summariesNeedingChoice(plan, ['sub'])!)).toBe('This heading has 1 task under it ("deep").');
    expect(headingBody(summariesNeedingChoice(plan, ['phase'])!)).toContain('and 1 more');
  });
  it('the message matches the choice made', () => {
    expect(deletedHeadingMessage([t('test')], 1, 'keep')).toBe("Deleted 'test'. 1 task kept");
    expect(deletedHeadingMessage([t('test')], 1, 'delete')).toBe("Deleted 'test' and 1 task");
    expect(deletedHeadingMessage([t('a'), t('b')], 3, 'keep')).toBe('Deleted 2 tasks. 3 tasks kept');
  });
});
