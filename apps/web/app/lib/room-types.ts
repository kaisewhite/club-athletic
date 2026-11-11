export const roomTypeLabel = { MASTER_DOUBLE: "Master bedroom", DOUBLE: "Double room", TWIN: "Twin room", QUAD_BUNK: "Quad bunk room", BUNK_CABIN: "Bunk cabin" } as const;

export function formatRoomDescription(type: string, description: string | null) {
  if (type !== "MASTER_DOUBLE" || !description) return description;
  return description.replace(/^Master double\b/i, "Master bedroom");
}

export function formatRoomType(type: string) {
  return roomTypeLabel[type as keyof typeof roomTypeLabel] ?? type.toLowerCase().replaceAll("_", " ");
}
