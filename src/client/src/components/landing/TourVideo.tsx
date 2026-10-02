import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The 80-second Kovarti feature tour (Oct 2026), narrated. Phones and portrait screens get the
 * vertical cut, everything else the widescreen one. Files live in client/public/videos.
 */
export const TOUR_VIDEOS = {
  wide: { src: '/videos/kovarti-tour-wide.mp4', poster: '/videos/kovarti-tour-wide.jpg' },
  vertical: { src: '/videos/kovarti-tour-vertical.mp4', poster: '/videos/kovarti-tour-vertical.jpg' },
} as const;

/** Same breakpoint as the tour page's own phone layout */
export const pickTourVideo = (isPortraitOrNarrow: boolean) => (isPortraitOrNarrow ? TOUR_VIDEOS.vertical : TOUR_VIDEOS.wide);

const PORTRAIT_QUERY = '(max-width: 760px), (max-aspect-ratio: 4/5)';

/** "Watch the 80-second tour" button + the player it opens */
export const TourVideoButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-3 mt-5 pl-2 pr-5 py-2 rounded-full text-[15px] font-semibold text-white transition-all hover:-translate-y-0.5"
        style={{ background: 'rgba(14,165,233,0.14)', border: '1px solid rgba(14,165,233,0.45)' }}
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-sky-500 shadow-lg shadow-sky-500/40 group-hover:bg-sky-400 transition-colors" aria-hidden="true">
          <svg className="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </span>
        Watch the 80-second tour
      </button>
      {open && <TourVideoModal onClose={close} />}
    </>
  );
};

export const TourVideoModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [video] = useState(() =>
    pickTourVideo(typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(PORTRAIT_QUERY).matches),
  );
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [onClose]);

  const vertical = video === TOUR_VIDEOS.vertical;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Kovarti feature tour video"
    >
      <div className={`relative w-full ${vertical ? 'max-w-[440px]' : 'max-w-5xl'} flex flex-col items-center`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between w-full mb-3">
          <h3 className="text-white text-base sm:text-lg font-semibold">Kovarti in 80 seconds</h3>
          <button ref={closeRef} onClick={onClose} className="text-slate-300 hover:text-white p-1.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" aria-label="Close the tour video">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <video
          src={video.src}
          poster={video.poster}
          controls
          autoPlay
          playsInline
          preload="metadata"
          className={`w-full h-auto ${vertical ? 'max-h-[82vh]' : 'max-h-[80vh]'} object-contain rounded-xl ring-1 ring-white/10 shadow-2xl bg-black`}
        >
          Your browser can't play this video. <a href={video.src}>Download the tour</a>.
        </video>
        <p className="text-slate-400 text-xs sm:text-sm mt-3">Press Escape or tap outside the video to close</p>
      </div>
    </div>
  );
};
