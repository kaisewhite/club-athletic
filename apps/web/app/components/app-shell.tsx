import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

const SECTIONS = [
  ["/", "Home"], ["/chat", "Chat"], ["/chalet", "Chalet"], ["/rooms", "Rooms"], ["/spots", "Pricing"],
  ["/shuttle", "Shuttle"], ["/flights", "Flights"], ["/schedule", "Schedule"],
  ["/folie-douce", "La Folie Douce"],
  ["/chef", "Chef"], ["/tasks", "Tasks"], ["/guests", "Guests"], ["/guest-details", "Guest details"], ["/links", "Links"], ["/faq", "FAQ"],
] as const;

/* The 860px seam, as the one query the browser itself evaluates. `innerWidth`
   includes a classic scrollbar's ~15px, so `innerWidth >= 860` switched the
   sidebar in a band where `@media (max-width: 859px)` was still applying the
   mobile rules. This is the same string as `app/components/flight-table.tsx`
   and the CSS side of the seam in `src/styles.css`, so there is one seam. */
const narrowQuery = "(max-width: 859px)";

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

/* Desktop splits the same pages in two: the six a guest checks most sit in the
   top bar, and the rest open from More on its far right. The mobile drawer and
   the footer still list every page. */
const PRIMARY = ["/chalet", "/rooms", "/spots", "/shuttle", "/flights", "/schedule"] as const;
// Guest details is a one-off form, so it lives in the footer rather than More.
const MORE = ["/chef", "/tasks", "/guests", "/links", "/faq", "/folie-douce"] as const;
const FOOTER_GROUPS = [
  ["The trip", ["/", "/chat", "/schedule", "/folie-douce", "/faq"]],
  ["Getting there", ["/flights", "/shuttle"]],
  ["The chalet", ["/chalet", "/rooms", "/spots", "/chef"]],
  ["The group", ["/guests", "/guest-details", "/tasks", "/links"]],
] as const;
const labelFor = (to: string) => SECTIONS.find(([path]) => path === to)![1];

function Navigation({ className = "side-nav", onNavigate }: { className?: string; onNavigate?: () => void }) {
  return <nav aria-label="Trip pages" className={className}>
    {SECTIONS.map(([to, label]) => <NavLink key={to} to={to} end className="side-item" onClick={onNavigate}>{label}</NavLink>)}
  </nav>;
}

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Desktop top bar: brand, the primary pages, the chat action and More. The More
 * overlay drops from under the bar (which stays put above it) and is `inert`
 * while closed, so its links are neither tabbable nor announced. */
function TopNav({ newChat }: { newChat: () => void }) {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!moreOpen) {
      if (wasOpen.current) toggle.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    panel.current?.querySelector<HTMLElement>("a")?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMoreOpen(false); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = overflow; };
  }, [moreOpen]);
  const onChat = location.pathname === "/chat";
  const moreActive = MORE.some((to) => to === location.pathname);
  return <header className="top-nav">
    <div className="top-nav-bar">
      <Link to="/" className="top-nav-brand">Méribel ’27</Link>
      <nav aria-label="Trip pages" className="top-nav-links">
        {PRIMARY.map((to) => <NavLink key={to} to={to} end className="top-nav-item">{labelFor(to)}</NavLink>)}
      </nav>
      <div className="top-nav-actions">
        {/* Icon-only actions: each carries its name for assistive tech and a
            matching tooltip. */}
        {onChat ? <button type="button" className="new-chat" aria-label="New chat" title="New chat" onClick={newChat}>
          <svg width="16" height="16" viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button> : <Link to="/chat" className="top-nav-chat" aria-label="Chat" title="Chat">
          <svg width="16" height="16" viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </Link>}
        <button ref={toggle} type="button" className={`more-toggle${moreActive ? " is-current" : ""}`} aria-label="More pages" title="More pages" aria-expanded={moreOpen} aria-controls="more-pages" onClick={() => setMoreOpen((open) => !open)}>
          <svg width="18" height="18" viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
      </div>
    </div>
    <div ref={panel} id="more-pages" className="more-menu" data-open={moreOpen} inert={!moreOpen} onClick={() => setMoreOpen(false)}>
      <div className="more-menu-inner">
        <nav aria-label="More trip pages" className="more-menu-links" onClick={(event) => event.stopPropagation()}>
          {MORE.map((to, index) => <NavLink key={to} to={to} end className="more-menu-item" style={{ "--i": index } as CSSProperties} onClick={() => setMoreOpen(false)}>{labelFor(to)}</NavLink>)}
        </nav>
      </div>
    </div>
  </header>;
}

/** Every page, grouped. Shown on all widths except /chat, where the pinned
 * composer is the bottom of the page. */
function SiteFooter() {
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <div className="site-footer-brand">
        <Link to="/" className="site-footer-mark">Méribel ’27</Link>
        <p>Club Athletic trip guide</p>
      </div>
      {FOOTER_GROUPS.map(([heading, paths]) => <nav key={heading} aria-label={heading} className="site-footer-group">
        <h2>{heading}</h2>
        <ul>{paths.map((to) => <li key={to}><Link to={to}>{labelFor(to)}</Link></li>)}</ul>
      </nav>)}
    </div>
  </footer>;
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
    document.cookie = `club-athletic-conversation=; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${window.location.protocol === "https:" ? "; Secure" : ""}`;
  }, []);
  const newChat = () => {
    setSelectedConversationId(null);
    setResettingChat(true);
    // Immediately unmount the consumer (aborting sends/recovery) before routing.
    setChatResetVersion(value => value + 1);
    // No route state: nothing reads it, and `navigate` mints a fresh
    // `location.key` on its own, which is what the scroll/reset effect keys on.
    void navigate("/chat");
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
      {wide && <TopNav newChat={newChat} />}
      <main className="shell-main">
        {!wide && <header className="mobile-header">
          {/* Menu on the left, brand, then the chat action on the right; both
              buttons are plain icons. */}
          <div className="mobile-nav-bar">
            <button ref={mobileNavButton} type="button" className="mobile-nav-toggle" aria-label={mobileNavOpen ? "Close menu" : "Open menu"} aria-expanded={mobileNavOpen} aria-controls="mobile-trip-navigation" onClick={() => setMobileNavOpen(open => !open)}>
              {mobileNavOpen ? <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg> : <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>}
            </button>
            <Link to="/" className="mobile-brand">Méribel ’27</Link>
            {location.pathname === "/chat" ? <button type="button" className="mobile-new-chat" aria-label="New chat" title="New chat" onClick={newChat}>
              <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            </button> : <Link to="/chat" className="mobile-chat-link" aria-label="Chat" title="Chat">
              <svg width="20" height="20" viewBox="0 0 24 24" {...ICON} aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </Link>}
          </div>
        </header>}
        {!wide && mobileNavOpen && <div className="mobile-nav-layer">
          <button type="button" className="mobile-nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />
          <aside ref={mobileDrawer} id="mobile-trip-navigation" className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Trip navigation">
            <div className="mobile-drawer-heading"><span>Trip pages</span><button type="button" className="mobile-drawer-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg></button></div>
            <Navigation className="side-nav" onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>}
        {/* `home-route` is the full-height chat layout, so it belongs to /chat;
            the home page is an ordinary page whose hero runs edge to edge. */}
        <div key={location.key} className={location.pathname === "/chat" ? "route-content home-route" : location.pathname === "/" ? "route-content page-route home-page" : "route-content page-route"}>
          <Outlet context={{ chatResetVersion, newChat, resettingChat, selectedConversationId, selectConversation: setSelectedConversationId }} />
        </div>
      </main>
      {location.pathname !== "/chat" && <SiteFooter />}
    </div>
  );
}
