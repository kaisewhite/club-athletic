// Ported from edge; document scrolling replaces the shell-specific scroller.
import { useEffect, useRef, type RefObject } from "react";

/** Distance (px) from the bottom within which the transcript counts as "pinned". */
export const STICK_TO_BOTTOM_THRESHOLD = 80;

/** True when the scroll position sits within `threshold` px of the bottom. */
export function isPinnedToBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold: number = STICK_TO_BOTTOM_THRESHOLD,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

/** How long (ms) growth is ignored after a user-initiated layout change. */
export const USER_LAYOUT_CHANGE_GRACE_MS = 300;
let followSuspendedUntil = 0;

/**
 * Call from any control inside the transcript that changes its own height on
 * user action — the tool-activity accordion, "Show raw diagnostics" — before the
 * state update. The follow-the-stream observer cannot tell a user expanding an
 * accordion apart from the agent appending text: both grow the transcript. Without
 * this, expanding an accordion while a run is live yanked the page to the bottom
 * ("pushes everything up") instead of opening downward like a normal accordion.
 * The browser's own scroll anchoring keeps the tapped row in place once we stop
 * following.
 */
export function suspendAutoScrollFollow(now: number = Date.now()): void {
  followSuspendedUntil = now + USER_LAYOUT_CHANGE_GRACE_MS;
}

/** True while growth must not be followed (a user just changed the layout). */
export function isAutoScrollFollowSuspended(now: number = Date.now()): boolean {
  return now < followSuspendedUntil;
}

/** The scroller the transcript follows — the document, as the shell scrolls the page. */
function documentScroller(): Element | null {
  if (typeof document === "undefined") return null;
  return document.scrollingElement ?? document.documentElement;
}

/**
 * Jump the transcript to its newest content. Used by the "jump to latest"
 * affordance shown once the reader has scrolled away from the bottom, so
 * returning is one click rather than a manual scroll. Instant, like `follow`:
 * a smooth animation here would fight both the stream and reduced-motion.
 */
export function scrollToLatest(): void {
  const scroller = documentScroller();
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

/**
 * Keep the `scrollSelector` container pinned to the bottom while `active` and the
 * `contentRef` element grows — the live-transcript "follow the stream" behavior
 * from ChatGPT / Claude. A ResizeObserver drives it (not a render effect) so it
 * tracks the token-by-token height growth *between* stream events, not just when
 * a new event arrives. Scrolling upward unpins until the user returns to the
 * bottom. The jump is instant, which keeps pace with the reveal and is
 * reduced-motion-safe.
 *
 * `onPinnedChange` reports that pin state outward, only on a change so it cannot
 * loop a render. The transcript's "jump to latest" button is shown exactly while
 * the reader is unpinned, which is also exactly when following is suppressed:
 * one observer owns both, so the button can never disagree with whether the
 * stream is being followed.
 */
export function useAutoScroll<T extends HTMLElement>({
  contentRef,
  active,
  followWhenPinned = false,
  onPinnedChange,
}: {
  contentRef: RefObject<T | null>;
  active: boolean;
  followWhenPinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
}): void {
  const pinnedRef = useRef(true);
  const reportRef = useRef(onPinnedChange);
  reportRef.current = onPinnedChange;

  useEffect(() => {
    if (!active && !followWhenPinned) return;
    const scroller = documentScroller();
    const content = contentRef.current;
    if (!scroller || !content) return;

    const setPinned = (pinned: boolean) => {
      if (pinnedRef.current === pinned) return;
      pinnedRef.current = pinned;
      reportRef.current?.(pinned);
    };

    if (active) {
      // Entering the live view starts pinned at the newest content.
      setPinned(true);
      scroller.scrollTop = scroller.scrollHeight;
    } else {
      setPinned(isPinnedToBottom(scroller));
    }

    const handleScroll = () => {
      setPinned(isPinnedToBottom(scroller));
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    const follow = () => {
      // Growth caused by the user opening something in the transcript is not new
      // content: leave the scroll position alone so the control opens downward.
      if (isAutoScrollFollowSuspended()) return;
      if (pinnedRef.current) scroller.scrollTop = scroller.scrollHeight;
    };
    const observer = new ResizeObserver(follow);
    observer.observe(content);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [active, followWhenPinned, contentRef]);
}
