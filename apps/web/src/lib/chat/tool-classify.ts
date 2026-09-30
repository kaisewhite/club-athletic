// Ported from edge/apps/web-platform/src/lib/shared/tool-classify.ts; trip adaptations are local.
// Tool classification is metadata, computed once in the data-projection layer so
// render components never string-match tool names. A tool resolves to a `kind`
// (command / lookup / tool) plus presentation (connector + human name), driving
// both the per-row label and the descriptive group header.

export type ToolKind = "command" | "skill" | "lookup" | "tool";

export interface ToolMeta {
  kind: ToolKind;
  /** Owning connector/integration for a named tool, when known (e.g. "Slack"). */
  connector: string | null;
  /** Human-readable tool name, e.g. "Post report", "Get accounts". */
  name: string;
}

// Shell/exec tools count as commands; skill loads are their own kind; genuine
// tool-discovery tools are lookups.
const COMMAND_NAMES = new Set(["bash", "sh", "shell", "exec", "command", "run_command"]);
const SKILL_NAMES = new Set(["load_skill", "load-skill"]);
const LOOKUP_NAMES = new Set(["tool_search", "search_tools", "find_tools", "list_tools"]);

/** snake_case / kebab-case / camelCase -> "Sentence case". */
function humanize(value: string): string {
  const words = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "Tool";
  return words
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()))
    .join(" ");
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()).trim();
}

/** Resolve one raw tool name to its kind + presentation metadata. */
export function classifyTool(rawName: string | null | undefined): ToolMeta {
  const raw = (rawName ?? "").trim() || "tool";
  const lower = raw.toLowerCase();

  if (COMMAND_NAMES.has(lower)) return { kind: "command", connector: null, name: "command" };
  if (SKILL_NAMES.has(lower)) return { kind: "skill", connector: null, name: "skill" };
  if (LOOKUP_NAMES.has(lower)) return { kind: "lookup", connector: null, name: "tools" };

  // eve:subagent:generalist -> a delegated subagent call.
  const subagent = raw.match(/^eve:subagent:(.+)$/i);
  if (subagent) return { kind: "tool", connector: "Subagent", name: humanize(subagent[1]!) };

  // eve:load-skill and other eve built-ins.
  const eveBuiltin = raw.match(/^eve:(.+)$/i);
  if (eveBuiltin) {
    const base = eveBuiltin[1]!.toLowerCase();
    if (SKILL_NAMES.has(base)) return { kind: "skill", connector: null, name: "skill" };
    if (LOOKUP_NAMES.has(base)) return { kind: "lookup", connector: null, name: "tools" };
  }

  // MCP namespacing: mcp__Trip__get_rooms -> Trip / Get rooms.
  const mcp = raw.match(/^mcp__(.+?)__(.+)$/i);
  if (mcp) return { kind: "tool", connector: titleCase(mcp[1]!), name: humanize(mcp[2]!) };

  // Generic connector namespacing: connector:tool, connector.tool, connector/tool.
  const namespaced = raw.match(/^([a-z0-9]+)[:./](.+)$/i);
  if (namespaced) return { kind: "tool", connector: titleCase(namespaced[1]!), name: humanize(namespaced[2]!) };

  return { kind: "tool", connector: null, name: humanize(raw) };
}

/**
 * The per-row label for one action. Skill loads render as a single line naming
 * the skill (the body never appears) — pass the loaded skill name from the call
 * arguments; the classifier alone only knows it is a skill.
 */
export function toolRowLabel(meta: ToolMeta, skillName?: string | null): string {
  if (meta.kind === "command") return "Ran a command";
  if (meta.kind === "skill") return skillName ? `Loaded skill: ${skillName}` : "Loaded a skill";
  if (meta.kind === "lookup") return "Found tools";
  return meta.connector ? `Used ${meta.connector}: ${meta.name}` : `Used ${meta.name}`;
}

/** Join clause fragments as a natural list: "a", "a and b", "a, b, and c". */
function joinClauses(parts: string[]): string {
  if (parts.length === 0) return "No activity";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/**
 * Summarize a group's actions by kind, e.g. "Ran 11 shell commands and used 2
 * tools" or "Loaded a skill and used 2 tools". Commands, skill loads, and tools
 * each get their own segment (lookups fold into the tools bucket). The first
 * segment's verb is capitalized, the rest lower.
 */
export function describeToolGroup(kinds: ToolKind[]): string {
  const commands = kinds.filter((kind) => kind === "command").length;
  const skills = kinds.filter((kind) => kind === "skill").length;
  const tools = kinds.length - commands - skills;
  const segments: string[] = [];
  const lead = () => segments.length === 0;

  if (commands > 0) {
    segments.push(commands === 1 ? "Ran a shell command" : `Ran ${commands} shell commands`);
  }
  if (skills > 0) {
    const verb = lead() ? "Loaded" : "loaded";
    segments.push(skills === 1 ? `${verb} a skill` : `${verb} ${skills} skills`);
  }
  if (tools > 0) {
    const verb = lead() ? "Used" : "used";
    segments.push(tools === 1 ? `${verb} a tool` : `${verb} ${tools} tools`);
  }
  return joinClauses(segments);
}
