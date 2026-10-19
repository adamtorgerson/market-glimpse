/**
 * "Look up" detection from the glasses' IMU. The SDK doesn't say what the
 * x/y/z readings measure, so rather than assume an axis, the user calibrates:
 * the mean reading looking straight ahead (`level`) and looking up (`up`).
 * A reading's progress is how far it has moved from `level` towards `up`
 * (0 at level, 1 at up). This works for any orientation-like signal (angles
 * or gravity), whatever the axes or units.
 */
export type Vec = [number, number, number];

export interface LookUpCalibration {
  level: Vec;
  up: Vec;
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 0 at the level position, 1 at the look-up position (can go beyond either). */
export function progress(cal: LookUpCalibration, v: Vec): number {
  const d = sub(cal.up, cal.level);
  const len2 = dot(d, d);
  return len2 ? dot(sub(v, cal.level), d) / len2 : 0;
}

/** Fires once per look-up: when progress passes `enter`, re-arming only after it falls back below `exit`. */
export class LookUpDetector {
  private armed = true;
  private smoothed: Vec | null = null;

  constructor(
    private readonly cal: LookUpCalibration,
    private readonly onLookUp: () => void,
    private readonly enter = 0.7,
    private readonly exit = 0.3,
  ) {}

  push(v: Vec): void {
    // Light smoothing so a single noisy sample can't trigger it.
    const s = this.smoothed;
    this.smoothed = s ? [s[0] * 0.5 + v[0] * 0.5, s[1] * 0.5 + v[1] * 0.5, s[2] * 0.5 + v[2] * 0.5] : v;
    const p = progress(this.cal, this.smoothed);
    if (this.armed && p >= this.enter) {
      this.armed = false;
      this.onLookUp();
    } else if (!this.armed && p <= this.exit) {
      this.armed = true;
    }
  }
}

/** Mean and spread (RMS distance from the mean) of a set of readings. */
export function summarize(samples: Vec[]): { mean: Vec; spread: number } {
  const n = samples.length;
  const mean: Vec = [0, 0, 0];
  for (const v of samples) for (let i = 0; i < 3; i++) mean[i]! += v[i]! / n;
  const spread = Math.sqrt(samples.reduce((sum, v) => sum + dot(sub(v, mean), sub(v, mean)), 0) / n);
  return { mean, spread };
}

/**
 * Build a calibration from readings taken looking ahead and looking up, or
 * explain why it can't: too few readings, or two positions the sensor can't
 * tell apart (e.g. if it reports rotation speed rather than orientation).
 */
export function calibrate(level: Vec[], up: Vec[]): LookUpCalibration | string {
  if (level.length < 3 || up.length < 3) return 'Not enough sensor readings. Is the glasses connection active?';
  const a = summarize(level), b = summarize(up);
  const d = sub(b.mean, a.mean);
  const distance = Math.sqrt(dot(d, d));
  if (distance < 4 * Math.max(a.spread, b.spread) || distance < 1e-6) {
    return "Couldn't tell looking ahead from looking up. Hold each position still, and tilt your head further up.";
  }
  return { level: a.mean, up: b.mean };
}

export function isCalibration(x: unknown): x is LookUpCalibration {
  const vec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
  return typeof x === 'object' && x !== null && vec((x as LookUpCalibration).level) && vec((x as LookUpCalibration).up);
}
