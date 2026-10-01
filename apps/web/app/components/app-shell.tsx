import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

const SECTIONS = [
  ["/", "Home"], ["/faq", "FAQ"], ["/schedule", "Schedule"], ["/flights", "Flights"],
  ["/shuttle", "Shuttle"], ["/chalet", "Chalet"], ["/rooms", "Rooms"],
  ["/spots", "Pricing"], ["/chef", "Chef"], ["/tasks", "Tasks"], ["/links", "Links"],
] as const;

/* The 860px seam, as the one query the browser itself evaluates. `innerWidth`
   includes a classic scrollbar's ~15px, so `innerWidth >= 860` switched the
   sidebar in a band where `@media (max-width: 859px)` was still applying the
   mobile rules. This is the same string as `app/components/flight-table.tsx`
   and the CSS side of the seam in `src/styles.css`, so there is one seam. */
const narrowQuery = "(width < 860px)";

function subscribeToSeam(onChange: () => void) {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const wideSnapshot = () => !window.matchMedia(narrowQuery).matches;
// SSR renders the wide shell (TODO §2.2) so the server and the first client
// pass agree; the seam takes over on the effect that follows hydration.
const serverSnapshot = () => true;

export function useWideLayout() {
  return useSyncExternalStore(subscribeToSeam, wideSnapshot, serverSnapshot);
}

function Navigation({ className = "side-nav", onNavigate }: { className?: string; onNavigate?: () => void }) {
  return <nav aria-label="Trip pages" className={className}>
    {SECTIONS.map(([to, label]) => <NavLink key={to} to={to} end className="side-item" onClick={onNavigate}>{label}</NavLink>)}
  </nav>;
}

export function AppShell(_props?: { daysUntil?: number }) {
  const wide = useWideLayout();
  const location = useLocation();
  const navigate = useNavigate();
  const [resettingChat, setResettingChat] = useState(false);
  const [chatResetVersion, setChatResetVersion] = useState(0);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const wasMobileNavOpen = useRef(false);
  const mobileNavButton = useRef<HTMLButtonElement>(null);
  const mobileDrawer = useRef<HTMLElement>(null);
  useEffect(() => {
    // Remove the prior 30-day selector cookie. The new selection is held in
    // memory only, so another tab or a fresh document starts with a clean chat.
    document.cookie = `club-athletic-conversation=; Path=/; SameSite=Lax; Max-Age=0${window.location.protocol === "https:" ? "; Secure" : ""}`;
  }, []);
  const newChat = () => {
    setSelectedConversationId(null);
    setResettingChat(true);
    // Immediately unmount the consumer (aborting sends/recovery) before routing.
    setChatResetVersion(value => value + 1);
    // No route state: nothing reads it, and `navigate` mints a fresh
    // `location.key` on its own, which is what the scroll/reset effect keys on.
    void navigate("/");
  };
  useEffect(() => { window.scrollTo(0, 0); setResettingChat(false); }, [location.key]);
  useEffect(() => {
    if (wide) { setMobileNavOpen(false); wasMobileNavOpen.current = false; return; }
    if (!mobileNavOpen) {
      if (wasMobileNavOpen.current) mobileNavButton.current?.focus();
      wasMobileNavOpen.current = false;
      return;
    }
    wasMobileNavOpen.current = true;
    const firstLink = mobileDrawer.current?.querySelector<HTMLElement>("a");
    firstLink?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMobileNavOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = [...(mobileDrawer.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? [])];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen, wide]);
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);
  return (
    <div className="app-shell">
      {wide && <aside className="sidebar">
        <button type="button" className="new-chat" onClick={newChat}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          New chat
        </button>
        <div className="nav-label">Trip pages</div>
        <Navigation />
      </aside>}
      <main className="shell-main">
        {!wide && <header className="mobile-header">
          <div className="mobile-nav-bar">
            <Link to="/" className="mobile-brand">Méribel ’27</Link>
            <button ref={mobileNavButton} type="button" className="mobile-nav-toggle" aria-label={mobileNavOpen ? "Close menu" : "Open menu"} aria-expanded={mobileNavOpen} aria-controls="mobile-trip-navigation" onClick={() => setMobileNavOpen(open => !open)}>
              {mobileNavOpen ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>}
            </button>
          </div>
        </header>}
        {!wide && mobileNavOpen && <div className="mobile-nav-layer">
          <button type="button" className="mobile-nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />
          <aside ref={mobileDrawer} id="mobile-trip-navigation" className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Trip navigation">
            <div className="mobile-drawer-heading"><span>Trip pages</span><button type="button" className="mobile-drawer-close" aria-label="Close menu" onClick={() => setMobileNavOpen(false)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg></button></div>
            <Navigation className="side-nav" onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>}
        <div key={location.key} className={location.pathname === "/" ? "route-content home-route" : "route-content page-route"}>
          <Outlet context={{ chatResetVersion, newChat, resettingChat, selectedConversationId, selectConversation: setSelectedConversationId }} />
        </div>
      </main>
    </div>
  );
}
