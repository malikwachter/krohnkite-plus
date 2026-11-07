/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

/**
 * Minimal shape needed to order windows by the time they appeared on a
 * surface. Keeping the helpers generic lets the selection logic be tested
 * without a KWin runtime.
 */
interface ICapacityWindow {
  window: { srfTime: number };
  focusTime: number;
}

interface ISurfaceBoundWindow {
  surface: { id: string };
}

type OvercapacityMode = "float" | "minimize";
type OvercapacityEvictionPolicy = "lastFocused" | "oldest";

/**
 * Combine the layout capacity with the surface capacity.
 *
 * `null` means "no limit"; a layout without an explicit capacity reports
 * `undefined`. The stricter of the two limits wins, and a single limit is
 * used as-is.
 */
function resolveSurfaceCapacity(
  layoutCapacity: number | null | undefined,
  surfaceCapacity: number | null,
): number | null {
  const layoutCap = layoutCapacity === undefined ? null : layoutCapacity;
  if (layoutCap === null && surfaceCapacity === null) return null;
  if (layoutCap === null || surfaceCapacity === null)
    return layoutCap || surfaceCapacity;
  return Math.min(layoutCap, surfaceCapacity);
}

/**
 * Minimize mode is only usable when KWin is allowed to minimize windows.
 * Otherwise KWin immediately restores every window we hide and the two
 * rules would fight each other.
 */
function isMinimizeOvercapacityMode(
  mode: OvercapacityMode,
  preventMinimize: boolean,
): boolean {
  return mode === "minimize" && !preventMinimize;
}

/**
 * Number of excess windows a target surface can accept.
 *
 * `capacity` is the number of free slots reported for the surface; `null`
 * means unlimited. `allowOverfill` is used by shortcut moves: a surface with
 * positive capacity but no free slots may still accept the moved window. A
 * surface whose effective capacity is zero is rejected by the caller before
 * this helper is reached.
 */
function resolveAvailableSlots(
  capacity: number | null,
  awaitToMove: number,
  overCapacity: number,
  allowOverfill: boolean,
): number {
  if (capacity === null) return overCapacity;
  const freeSlots = capacity - awaitToMove;
  if (freeSlots > 0) return Math.min(freeSlots, overCapacity);
  return allowOverfill ? overCapacity : 0;
}

/**
 * Split `tileables` into the windows that fit the capacity and the excess.
 *
 * `oldest` orders the excess by the time a window appeared on the surface.
 * `lastFocused` orders it by focus time, so the window that received focus
 * most recently is evicted first; equal focus times fall back to the newer
 * surface time. `protectedWindows` are skipped while choosing the excess, so
 * a window that was just moved to a full surface survives its first arrange
 * and the policy evicts another window instead.
 * `freeSlots` is the number of remaining places when nothing had to be
 * removed, and `0` otherwise.
 */
function selectOverCapacityWindows<T extends ICapacityWindow>(
  tileables: T[],
  capacity: number | null,
  eviction: OvercapacityEvictionPolicy,
  protectedWindows: T[] = [],
): { tileables: T[]; overCapacity: T[]; freeSlots: number | null } {
  if (capacity === null || tileables.length <= capacity) {
    return {
      tileables: tileables.slice(),
      overCapacity: [],
      freeSlots: capacity === null ? null : capacity - tileables.length,
    };
  }

  const excess = tileables.length - capacity;
  const sorted = [...tileables].sort((a, b) =>
    eviction === "oldest"
      ? a.window.srfTime - b.window.srfTime
      : b.focusTime - a.focusTime || b.window.srfTime - a.window.srfTime,
  );
  const candidates = sorted.filter(
    (win) => protectedWindows.indexOf(win) < 0,
  );
  const pool = candidates.length >= excess ? candidates : sorted;
  const overCapacity = pool.slice(0, excess);
  const toRemove = new Set(overCapacity);

  return {
    tileables: tileables.filter((tile) => !toRemove.has(tile)),
    overCapacity,
    freeSlots: 0,
  };
}

/**
 * Choose the hidden windows to restore on a surface, in LIFO order: the
 * window hidden last is restored first.
 *
 * `freeSlots === null` means unlimited capacity. When `restoreAll` is set,
 * every window of that surface is returned regardless of `freeSlots`; this
 * is used after switching back to float mode so the normal overcapacity
 * logic can float them again.
 */
function selectRestorableWindows<T extends ISurfaceBoundWindow>(
  hidden: T[],
  srfId: string,
  freeSlots: number | null,
  restoreAll: boolean,
): T[] {
  const restore: T[] = [];
  let slots = freeSlots;

  for (let i = hidden.length - 1; i >= 0; i--) {
    if (!restoreAll && slots !== null && slots <= 0) break;
    const win = hidden[i];
    if (win.surface.id !== srfId) continue;
    restore.push(win);
    if (!restoreAll && slots !== null) slots--;
  }

  return restore;
}
