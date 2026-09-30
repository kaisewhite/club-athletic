// TODO §2.15's last bullet: "Codify the rule so it survives: an oxlint rule or a
// CSS convention comment stating that base styles are desktop-frozen."
//
// oxlint does not lint CSS, so the convention is a banner comment in each
// stylesheet — and this file is what makes the banner load-bearing rather than
// decorative. It parses the stylesheets and asserts mechanically that:
//
//   1. every declaration after the MOBILE banner sits inside a
//      `@media (max-width: 859px …)` block, so nothing added during a mobile
//      pass can leak above the 860px seam and break the frozen desktop
//      baseline in `tests/visual/__screenshots__/`;
//   2. 860px stays the single seam — no second `max-width` breakpoint;
//   3. the mobile sections never reintroduce `100vh` (mobile Safari's
//      collapsing toolbar makes it overflow) and never drop the composer
//      textarea below the 16px that stops iOS zooming on focus.
//
// A future pass that forgets the convention fails `bun run test` here, which is
// a cheaper and clearer failure than a 40-snapshot pixel diff.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** The banner that separates desktop-frozen base styles from the mobile pass. */
const BANNER = "BASE STYLES ABOVE THIS LINE ARE DESKTOP-FROZEN";
const BANNER_ALT = "THE CONVENTION, NOT A SUGGESTION";

/** Stylesheets that carry a mobile section, relative to `apps/web`. */
const SHEETS = [
  "src/styles.css",
  "app/components/trip-details.css",
  "app/components/chat/chat-attachment.css",
] as const;

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

/** Removes CSS comments, so banner prose is never mistaken for a declaration. */
function stripComments(css: string) {
  return css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Splits a stylesheet at the mobile banner. Returns the CSS before it (the
 * desktop-frozen half) and the CSS after it (the mobile pass), both with
 * comments removed.
 */
function split(css: string) {
  const index = css.indexOf(BANNER) === -1 ? css.indexOf(BANNER_ALT) : css.indexOf(BANNER);
  expect(index, "the stylesheet carries the desktop-frozen banner").toBeGreaterThan(-1);
  // Rewind to the start of the comment block the banner lives in.
  const open = css.lastIndexOf("/*", index);
  return { base: stripComments(css.slice(0, open)), mobile: stripComments(css.slice(open)) };
}

/**
 * Walks `css` and returns every declaration that is NOT nested inside an
 * at-rule whose prelude matches `guard`. Brace-counting is enough here: these
 * are hand-written stylesheets with no strings or `@supports` nesting.
 */
function unguardedDeclarations(css: string, guard: RegExp) {
  const offenders: string[] = [];
  // Track the at-rule preludes currently open, outermost first.
  const stack: { prelude: string; guarded: boolean }[] = [];
  let index = 0;
  let pending = "";
  while (index < css.length) {
    const char = css[index]!;
    if (char === "{") {
      const prelude = pending.trim();
      if (prelude.startsWith("@")) {
        stack.push({ prelude, guarded: guard.test(prelude) || stack.some((entry) => entry.guarded) });
      } else {
        // A style rule. Its declarations count as guarded only if some enclosing
        // at-rule matched. Consume to the matching close brace.
        const guarded = stack.some((entry) => entry.guarded);
        let depth = 1;
        let cursor = index + 1;
        while (cursor < css.length && depth > 0) {
          if (css[cursor] === "{") depth += 1;
          else if (css[cursor] === "}") depth -= 1;
          cursor += 1;
        }
        if (!guarded && prelude.length > 0) offenders.push(prelude);
        index = cursor;
        pending = "";
        continue;
      }
      pending = "";
    } else if (char === "}") {
      stack.pop();
      pending = "";
    } else {
      pending += char;
    }
    index += 1;
  }
  return offenders;
}

describe("mobile CSS convention (TODO §2.15)", () => {
  it.each(SHEETS)("%s carries the desktop-frozen banner", (sheet) => {
    const css = read(sheet);
    expect(css.includes(BANNER) || css.includes(BANNER_ALT), `${sheet} must state that base styles are desktop-frozen`).toBe(true);
  });

  it.each(SHEETS)("%s keeps every mobile rule inside a max-width media query", (sheet) => {
    const { mobile } = split(read(sheet));
    // Anything in the mobile half must be wrapped in a `max-width` at-rule.
    expect(unguardedDeclarations(mobile, /@media[^{]*max-width/)).toEqual([]);
  });

  it.each(SHEETS)("%s uses 859px as its only mobile breakpoint", (sheet) => {
    const { mobile } = split(read(sheet));
    const widths = [...mobile.matchAll(/max-width:\s*(\d+)px/g)].map((match) => match[1]);
    expect(widths.length, `${sheet} must have at least one mobile media query`).toBeGreaterThan(0);
    // 860px is the single seam: `useWideLayout()` switches at >=860, so the CSS
    // side of it is `max-width: 859px` and nothing else.
    expect([...new Set(widths)]).toEqual(["859"]);
  });

  it.each(SHEETS)("%s never reintroduces 100vh below the seam", (sheet) => {
    const { mobile } = split(read(sheet));
    expect(mobile).not.toMatch(/\b100vh\b/);
  });

  it("uses 100dvh for the full-height shell on mobile", () => {
    const { mobile } = split(read("src/styles.css"));
    expect(mobile).toMatch(/\.app-shell\s*\{[^}]*min-height:\s*100dvh/);
  });

  it("never shrinks the composer input below the 16px that stops iOS zooming", () => {
    const css = read("src/styles.css");
    // Every font-size applied to the composer textarea, base rules included.
    const sizes = [...css.matchAll(/\.composer\s+textarea\s*\{([^}]*)\}/g)]
      .flatMap((rule) => [...rule[1]!.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1])));
    expect(sizes.length, "the composer textarea sets an explicit font-size").toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
  });

  it("declares viewport-fit=cover and interactive-widget=resizes-content", () => {
    const root = read("app/root.tsx");
    const meta = /<meta name="viewport" content="([^"]+)"/.exec(root)?.[1];
    expect(meta, "app/root.tsx sets a viewport meta").toBeTruthy();
    // `viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve;
    // `interactive-widget=resizes-content` is the declarative replacement for a
    // `visualViewport` resize listener, so no such JS should exist either.
    expect(meta).toContain("viewport-fit=cover");
    expect(meta).toContain("interactive-widget=resizes-content");
    expect(meta).toContain("width=device-width");
  });

  it("switches the JS seam on the same media query the CSS uses", () => {
    // One seam, not two: `innerWidth` counts a classic scrollbar, so a JS
    // threshold on it renders the desktop sidebar in a ~15px band where the
    // `max-width: 859px` stylesheets are still in force. Both components must
    // therefore ask the browser the same question the CSS asks.
    const seams = ["app/components/app-shell.tsx", "app/components/flight-table.tsx"].map((file) => {
      // Comments here explain the seam and name `innerWidth`, so compare code only.
      const source = stripComments(read(file)).replaceAll(/^\s*\/\/.*$/gm, "");
      expect(source, `${file} must not switch layout on window.innerWidth`).not.toMatch(/innerWidth/);
      return [...source.matchAll(/matchMedia\((\w+)\)/g)].map((match) => {
        const declaration = new RegExp(`const ${match[1]} = "([^"]+)"`).exec(source);
        expect(declaration, `${file} declares the query ${match[1]} as a literal`).not.toBeNull();
        return declaration![1];
      });
    }).flat();
    expect(seams.length, "both components resolve a matchMedia query").toBeGreaterThanOrEqual(2);
    // The single seam, and the CSS side of it (`max-width: 859px`) is asserted
    // against the stylesheets above.
    expect([...new Set(seams)]).toEqual(["(width < 860px)"]);
  });

  it("has no visualViewport JS, which the viewport meta replaces", () => {
    for (const sheet of ["app/components/chat/chat-composer.tsx", "app/components/chat/chat-panel.tsx", "app/components/app-shell.tsx", "app/root.tsx"]) {
      // Property access, not the word: the comment in `app/root.tsx` names the
      // API it replaces, which is documentation rather than a listener.
      expect(read(sheet), `${sheet} must not hand-roll keyboard tracking`).not.toMatch(/visualViewport\s*[.[]/);
    }
  });
});
