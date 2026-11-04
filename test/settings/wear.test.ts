import { describe, expect, it } from 'vitest';
import { WearTracker, type GlassesStatus } from '../../src/wear';

const worn: GlassesStatus = { connectType: 'connected', isWearing: true, isInCase: false };
const off: GlassesStatus = { connectType: 'connected', isWearing: false, isInCase: false };

function after(...statuses: GlassesStatus[]): boolean {
  const t = new WearTracker();
  for (const s of statuses) t.update(s);
  return t.inUse;
}

describe('WearTracker', () => {
  it('counts as in use until told otherwise', () => {
    expect(new WearTracker().inUse).toBe(true);
    expect(after(worn)).toBe(true);
  });

  it('is out of use once worn glasses come off, and back in when put on', () => {
    expect(after(worn, off)).toBe(false);
    expect(after(worn, off, worn)).toBe(true);
  });

  it('doesn\'t believe isWearing: false until it has seen true, since the SDK defaults it', () => {
    expect(after(off)).toBe(true);
    expect(after(off, off)).toBe(true);
  });

  it('is out of use in the case, even if it has never reported being worn', () => {
    expect(after({ connectType: 'connected', isWearing: false, isInCase: true })).toBe(false);
    expect(after(worn, { connectType: 'connected', isWearing: false, isInCase: true }, worn)).toBe(true);
  });

  it('is out of use while not connected', () => {
    for (const connectType of ['connecting', 'disconnected', 'connectionFailed']) {
      expect(after({ ...worn, connectType }), connectType).toBe(false);
      expect(after({ ...worn, connectType }, worn), connectType).toBe(true);
    }
  });

  it('ignores a status with no connection state, which says nothing', () => {
    expect(after(worn, { connectType: 'none', isWearing: false })).toBe(true);
    expect(after(worn, off, { connectType: 'none', isWearing: true })).toBe(false);
    expect(after(worn, {})).toBe(true);
  });
});
