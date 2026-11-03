import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, ArrowsLeftRight } from "@phosphor-icons/react/ssr";

const arrows = {
  "→": { Icon: ArrowRight, spoken: "to" },
  "←": { Icon: ArrowLeft, spoken: "from" },
  "↔": { Icon: ArrowsLeftRight, spoken: "and" },
  "↗": { Icon: ArrowUpRight, spoken: "external link" },
  "↑": { Icon: ArrowUp, spoken: "up" },
  "↓": { Icon: ArrowDown, spoken: "down" },
} as const;

export function ArrowText({ children }: { children: string }) {
  return <>{children.split(/([→←↔↗↑↓])/g).map((part, index) => {
    const arrow = arrows[part as keyof typeof arrows];
    if (!arrow) return part;
    const { Icon, spoken } = arrow;
    return <span key={`${index}-${part}`}><span className="sr-only">{spoken}</span><Icon size="1em" aria-hidden="true" /></span>;
  })}</>;
}
