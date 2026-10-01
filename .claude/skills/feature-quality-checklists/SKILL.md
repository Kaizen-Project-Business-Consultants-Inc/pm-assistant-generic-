---
name: feature-quality-checklists
description: Checklists to run before shipping any feature — editable content (save/cancel/conflicts/sanitising), real-time/WebSocket (auth, scoped broadcast, reconnect), accessibility, new components, SEO & performance.
---

# Feature Quality Checklists

Before shipping any feature, run through the applicable checklist. These exist because past audit findings repeatedly caught the same categories of gaps.

### Editable Content
- [ ] Save and cancel paths: auto-save on blur, explicit save, Escape to cancel/revert
- [ ] Unmount flush: if debounced save is pending and user navigates away, flush it
- [ ] Conflict detection: if multiple users can edit the same data, use optimistic locking (send `expectedUpdatedAt`, handle 409)
- [ ] Error feedback: show save failures with retry option, not silent swallowing
- [ ] Input sanitization: server-side stripping of dangerous HTML on write
- [ ] Output sanitization: DOMPurify on any `dangerouslySetInnerHTML`
- [ ] Use a proper parser (e.g., `marked`) for markdown — never hand-rolled regex
- [ ] Link clicks in rendered content should not trigger edit mode

### Real-Time / WebSocket Features
- [ ] Authorization: verify the user has access to the resource they're subscribing to (e.g., project membership on `presence:join`)
- [ ] Scoped broadcast: send events only to clients that need them, not all connected clients
- [ ] Scoped query invalidation: invalidate only the affected cache keys (e.g., `['tasks', scheduleId]`), not all cached data globally
- [ ] Reconnect: re-establish subscriptions after WebSocket reconnect (server state is gone)
- [ ] Connection limits: enforce per-user and global caps to prevent resource exhaustion
- [ ] Keepalive: ping/pong heartbeat to detect and terminate stale connections

### Accessibility (a11y)
- [ ] Keyboard access: interactive elements need `tabIndex`, `role`, and `onKeyDown` (Enter/Space)
- [ ] Screen readers: dynamic status indicators need `role="status"` and `aria-live="polite"`
- [ ] Reduced motion: animations must respect `prefers-reduced-motion` / `motion-reduce:` classes
- [ ] Focus management: modals trap focus, edit mode receives focus on entry

### New Components
- [ ] Check for existing shared primitives before building inline — search the codebase first
- [ ] If two+ components need the same behavior, extract the shared piece *before* building both
- [ ] Reorderable/draggable elements: integrate with existing grid/order systems, don't create parallel ones

### SEO & Performance
- [ ] SPA pages: provide `<noscript>` fallback or server-side prerender for crawlers
- [ ] External dependencies: use `preconnect` / `preload` for third-party origins
- [ ] Fonts: load non-render-blocking (`media="print"` with `onload` swap)
