import { describe, it, expect } from 'vitest';
import { progressViews, fitView } from '../../utils/methodology';

/** U18: Agile = Burndown, Waterfall = S-curve, Hybrid = both; a remembered view that doesn't fit is swapped */
describe('schedule progress charts by methodology', () => {
  it('offers the right charts', () => {
    expect(progressViews('agile')).toEqual(['burndown']);
    expect(progressViews('waterfall')).toEqual(['scurve']);
    expect(progressViews(undefined)).toEqual(['scurve']);
    expect(progressViews('hybrid')).toEqual(['burndown', 'scurve']);
  });
  it('swaps a remembered view only when the project does not offer it', () => {
    expect(fitView('waterfall', 'burndown')).toBe('scurve');
    expect(fitView('agile', 'scurve')).toBe('burndown');
    expect(fitView('hybrid', 'scurve')).toBe('scurve');
    expect(fitView('hybrid', 'burndown')).toBe('burndown');
    expect(fitView('waterfall', 'gantt')).toBe('gantt');
  });
});
