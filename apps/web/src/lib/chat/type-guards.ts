// Ported from edge/apps/web-platform/src/lib/shared/type-guards.ts; trip adaptations are local.
export type SharedInput = string | number | boolean | object | null | undefined;
export type SharedPropertyValue = string | number | boolean | null | undefined;

export function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

export function isNumber(value: unknown): value is number {
  return Object.prototype.toString.call(value) === "[object Number]" && !Number.isNaN(Number(value));
}

export function isBoolean(value: unknown): value is boolean {
  return Object.prototype.toString.call(value) === "[object Boolean]";
}

export function isNonNullObject(value: unknown): value is object {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function hasProperty<K extends string>(
  value: unknown,
  key: K,
): value is object & Record<K, SharedPropertyValue> {
  return typeof value === "object" && value !== null && key in value;
}
