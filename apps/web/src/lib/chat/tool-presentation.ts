// Ported from edge/apps/web-platform/src/lib/execution/tool-presentation.ts; trip adaptations are local.
import type { ActivityGroupItem } from "./contracts";
import type { ToolMeta } from "./tool-classify";
import { hasProperty, isBoolean, isNonNullObject, isNumber, isString, type SharedInput } from "./type-guards";

type ToolRecord = Record<string, SharedInput>;

function asRecord(value: SharedInput): ToolRecord | null {
  if (!isNonNullObject(value) || Array.isArray(value)) return null;
  // SAFETY: callers only use this on structured tool payloads that are plain objects.
  return value as ToolRecord;
}

function humanize(value: string): string {
  if (/^[A-Z0-9]{2,8}$/.test(value.trim())) return value.trim();
  const words = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "Tool";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function stringifyScalar(value: string | number | boolean): string {
  return String(value);
}

function isScalar(value: SharedInput): value is string | number | boolean {
  return isString(value) || isNumber(value) || isBoolean(value);
}

function formatFieldValue(value: SharedInput): string | null {
  if (isScalar(value)) {
    const text = stringifyScalar(value).trim();
    return text.length > 0 ? text : null;
  }
  if (Array.isArray(value) && value.every(isScalar)) {
    const items = value.map((entry) => stringifyScalar(entry).trim()).filter((entry) => entry.length > 0);
    if (items.length === 0) return null;
    if (items.length <= 3) return items.join(", ");
    return `${items.slice(0, 3).join(", ")} +${items.length - 3} more`;
  }
  return null;
}

function pickFallbackFields(input: ToolRecord, exclude: Set<string>): Array<{ label: string; value: string }> {
  const picked: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(input)) {
    if (exclude.has(key)) continue;
    const formatted = formatFieldValue(value);
    if (!formatted) continue;
    picked.push({ label: humanize(key), value: formatted });
    if (picked.length === 4) break;
  }
  return picked;
}

function summarizeArray(value: SharedInput[]): string {
  return value.length === 1 ? "1 item returned." : `${value.length} items returned.`;
}

function extractErrorText(value: SharedInput): string | null {
  if (isString(value)) {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }

  const record = asRecord(value);
  if (!record) return null;
  if (hasProperty(record, "message") && isString(record.message) && record.message.trim()) return record.message.trim();
  if (hasProperty(record, "error") && isString(record.error) && record.error.trim()) return record.error.trim();
  return null;
}

function summarizeStructuredResult(result: SharedInput): string | null {
  const record = asRecord(result);
  if (record) {
    if (hasProperty(record, "error")) {
      const errorText = extractErrorText(record.error);
      if (errorText) return errorText;
    }
    if (hasProperty(record, "response")) {
      return summarizeStructuredResult(record.response);
    }
    if (hasProperty(record, "data")) {
      return summarizeStructuredResult(record.data);
    }
    if (hasProperty(record, "payload") && !(hasProperty(record, "webhookStatus") && isNumber(record.webhookStatus))) {
      return summarizeStructuredResult(record.payload);
    }
  }
  if (result === null || result === undefined) return null;
  if (isString(result)) {
    const text = result.trim();
    return text.length > 0 ? text : null;
  }
  if (isNumber(result) || isBoolean(result)) return String(result);
  if (Array.isArray(result)) return summarizeArray(result);
  if (!isNonNullObject(result)) return String(result);

  const entries = Object.entries(result);
  const arraySummaries = entries
    .filter(([, value]) => Array.isArray(value))
    .slice(0, 2)
      .map(([key, value]) => {
        return `${humanize(key)}: ${summarizeArray(value)}`;
      });
  if (arraySummaries.length > 0) {
    return arraySummaries.join(" | ");
  }

  const scalarEntries = entries
    .map(([key, value]) => {
      const formatted = formatFieldValue(value);
      return formatted ? `${humanize(key)}: ${formatted}` : null;
    })
    .filter((value): value is string => value !== null);
  if (scalarEntries.length > 0) {
    return scalarEntries.slice(0, 2).join(" | ");
  }

  return entries.length > 0 ? `${entries.length} fields returned.` : "Completed successfully.";
}

function toolBaseLabel(toolName: string, meta: ToolMeta): string {
  if (meta.connector) return meta.connector;
  return humanize(toolName.replace(/[_-]tool$/i, ""));
}

function operationLabel(toolName: string, meta: ToolMeta, discriminator: string | null): string {
  if (meta.kind === "command") return "Shell: Run command";
  if (meta.kind === "lookup") return "Tools: Search";
  if (!discriminator && !meta.connector) return meta.name;
  const operation = discriminator ? humanize(discriminator) : humanize(meta.name);
  return `${toolBaseLabel(toolName, meta)}: ${operation}`;
}

export function summarizeToolCall(
  toolName: string,
  meta: ToolMeta,
  input: SharedInput,
): Pick<ActivityGroupItem, "input" | "label" | "outcome" | "params"> {
  if (meta.kind === "skill") {
    const record = asRecord(input);
    const skillName =
      record && hasProperty(record, "skill") && isString(record.skill)
        ? record.skill
        : record && hasProperty(record, "name") && isString(record.name)
          ? record.name
          : record && hasProperty(record, "skillName") && isString(record.skillName)
            ? record.skillName
            : null;
    return {
      input,
      label: skillName ? `Loaded skill: ${skillName}` : "Loaded a skill",
      outcome: undefined,
      params: [],
    };
  }

  if (isString(input)) {
    const text = input.trim();
    return {
      input,
      label: operationLabel(toolName, meta, null),
      outcome: undefined,
      params: text ? [{ label: meta.kind === "command" ? "Command" : "Input", value: text }] : [],
    };
  }

  const record = asRecord(input);
  const discriminatorKey = "action";
  const discriminatorValue = record && hasProperty(record, discriminatorKey) && isString(record[discriminatorKey])
    ? record[discriminatorKey]
    : null;
  const exclude = new Set<string>();
  if (discriminatorValue) exclude.add(discriminatorKey);
  const params = record
    ? [
        ...pickFallbackFields(record, exclude),
      ].filter((field, index, fields) => fields.findIndex((entry) => entry.label === field.label && entry.value === field.value) === index).slice(0, 4)
    : [];

  return {
    input,
    label: operationLabel(toolName, meta, discriminatorValue),
    outcome: undefined,
    params,
  };
}

export function summarizeToolResult(
  toolName: string,
  result: SharedInput,
  error: string | null,
): Pick<ActivityGroupItem, "error" | "outcome" | "output" | "result" | "status"> {
  const record = asRecord(result);
  const envelopeError = record && hasProperty(record, "error")
    ? (() => {
        return extractErrorText(record.error);
      })()
    : record && hasProperty(record, "ok") && record.ok === false
      ? "Tool reported an error."
      : null;
  const finalError = error ?? envelopeError;
  if (finalError) {
    return { error: finalError, outcome: finalError, output: undefined, result: undefined, status: "error" };
  }

  const summary = summarizeStructuredResult(result) ?? "Completed successfully.";
  return {
    error: undefined,
    outcome: summary,
    output: result,
    result: isString(result) ? result : undefined,
    status: "ok",
  };
}
