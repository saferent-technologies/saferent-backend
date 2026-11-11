import { SHARING_BEDS } from "./schemas";

/** Beds a room may hold according to its sharing type (pure — unit tested). */
export function bedCapacity(room: { sharingType: keyof typeof SHARING_BEDS; customSharing?: number | null }): number {
  return room.sharingType === "CUSTOM" ? (room.customSharing ?? 0) : SHARING_BEDS[room.sharingType];
}
