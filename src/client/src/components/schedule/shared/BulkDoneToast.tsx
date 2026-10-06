import { Check } from 'lucide-react';

/**
 * Green "✓ Updated 3 tasks" after a bulk change or bulk delete worked, in the Gantt and the Table.
 * The bulk bar that used to hold this text closes on success (the selection is cleared), so the
 * confirmation sits on its own at the bottom, just above the Undo message. Read out to screen
 * readers; the view clears it after 3 s. Nothing is rendered when there is no message.
 */
export function BulkDoneToast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg"
    >
      <Check className="w-4 h-4" aria-hidden="true" />
      {message}
    </div>
  );
}
