import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { existsSync } from 'fs';
import { join } from 'path';
import { TourVideoButton, TOUR_VIDEOS, pickTourVideo } from '../../components/landing/TourVideo';

// Oct 2026: the narrated 80-second tour on the home page — vertical cut on phones, widescreen elsewhere.
describe('Kovarti tour video', () => {
  it('phones get the vertical cut, computers the widescreen one', () => {
    expect(pickTourVideo(true)).toBe(TOUR_VIDEOS.vertical);
    expect(pickTourVideo(false)).toBe(TOUR_VIDEOS.wide);
  });

  it('the video and poster files it points at are shipped with the site', () => {
    const pub = join(__dirname, '../../../public');
    for (const v of Object.values(TOUR_VIDEOS)) {
      expect([v.src, existsSync(join(pub, v.src))]).toEqual([v.src, true]);
      expect([v.poster, existsSync(join(pub, v.poster))]).toEqual([v.poster, true]);
    }
  });

  it('the button opens a labelled player that Escape closes, giving focus back', () => {
    render(<TourVideoButton />);
    const button = screen.getByRole('button', { name: /watch the 80-second tour/i });
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: /feature tour video/i });
    expect(dialog.querySelector('video')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /close the tour video/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
