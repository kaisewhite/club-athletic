export function preferenceItems(value: string | null | undefined): string[] {
  return value?.split(/[\n•]+/u).map((item) => item.trim()).filter(Boolean) ?? [];
}

export function formatPreferenceListForCopy(value: string | null | undefined): string {
  const items = preferenceItems(value);
  return items.length ? items.map((item) => `• ${item}`).join("\n") : "—";
}

export function GuestPreferenceList({ value, emptyLabel }: { value: string | null; emptyLabel: string }) {
  const items = preferenceItems(value);
  if (items.length === 0) return <span className="dietary-cell-empty">{emptyLabel}</span>;

  return <span className="dietary-preference-list">
    {items.map((item, index) => <span className="dietary-preference-item" key={`${index}-${item}`}>
      <span className="dietary-preference-bullet" aria-hidden="true">•</span>
      <span>{item}</span>
    </span>)}
  </span>;
}
