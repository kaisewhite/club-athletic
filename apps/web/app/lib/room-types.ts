export const roomTypeLabel = { MASTER_DOUBLE: "Master double", DOUBLE: "Double room", TWIN: "Twin room", QUAD_BUNK: "Quad bunk room", BUNK_CABIN: "Bunk cabin" } as const;

export function formatRoomType(type: string) {
  return roomTypeLabel[type as keyof typeof roomTypeLabel] ?? type.toLowerCase().replaceAll("_", " ");
}
