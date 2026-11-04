/**
 * Whether the glasses are in use, from the Even app's device status, so
 * scheduled updates can pause while nobody could see them.
 *
 * Each status is parsed afresh, and the SDK fills in whatever it lacks:
 * `isWearing` and `isInCase` become false, and `connectType` "none". So a false
 * `isWearing` only counts once the glasses have reported true, and a status
 * with no connection state says nothing. Being wrong in the other direction
 * only costs some battery, so anything unclear counts as in use.
 */
export interface GlassesStatus {
  connectType?: string;
  isWearing?: boolean;
  isInCase?: boolean;
}

const OFFLINE = new Set(['connecting', 'disconnected', 'connectionFailed']);

export class WearTracker {
  private seenWearing = false;
  /** The state the status last reported. */
  inUse = true;

  /** Take in a status, and return whether the glasses are now in use. */
  update(status: GlassesStatus): boolean {
    if (!status.connectType || status.connectType === 'none') return this.inUse;
    if (status.isWearing) this.seenWearing = true;
    this.inUse = !OFFLINE.has(status.connectType) && !status.isInCase && (status.isWearing === true || !this.seenWearing);
    return this.inUse;
  }
}
