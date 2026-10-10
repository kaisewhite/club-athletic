import { guestInstagramUrl } from "../lib/guest-instagrams";

type GuestInstagramLinkProps = {
  displayName: string;
  className?: string;
};

export function GuestInstagramAffordance({ displayName, className }: GuestInstagramLinkProps) {
  return <span className={`guest-instagram-label${className ? ` ${className}` : ""}`}>
    <span>{displayName}</span><svg className="guest-instagram-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 19 19 5" /><path d="M8 5h11v11" /></svg>
  </span>;
}

/** The shared guest-name treatment: the arrow makes the external profile action explicit. */
export function GuestInstagramLink({ displayName, className }: GuestInstagramLinkProps) {
  const href = guestInstagramUrl(displayName);
  if (!href) return <>{displayName}</>;
  return <a className={`guest-instagram-link${className ? ` ${className}` : ""}`} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${displayName} on Instagram`}>
    <GuestInstagramAffordance displayName={displayName} />
  </a>;
}
