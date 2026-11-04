/**
 * The glasses' loading screen list, against a stand-in for the Even bridge: in
 * place where its layout holds, a rebuild where it doesn't, and never over a chart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Glasses } from '../../src/glasses';

const row = (y: number, h: number, content: string) => ({ y, h, color: 15, content });
const SCREEN = { message: 'Loading… ~3s', topLeft: '', topRight: '', bottomLeft: '', bottomRight: '' };

describe('updateLoadingList', () => {
  const bridge = {
    createStartUpPageContainer: vi.fn(async () => 0),
    rebuildPageContainer: vi.fn(async () => true),
    textContainerUpgrade: vi.fn(async () => true),
    updateImageRawData: vi.fn(async () => 0),
    onEvenHubEvent: vi.fn(() => () => {}),
  };
  let glasses: Glasses;
  const texts = () => (bridge.rebuildPageContainer.mock.lastCall as unknown as [{ textObject: { content: string }[] }])[0].textObject.map((t) => t.content);

  beforeEach(() => {
    vi.clearAllMocks();
    glasses = new (Glasses as unknown as new (b: unknown) => Glasses)(bridge);
  });

  it('rebuilds the page when the first rows arrive on an empty list', async () => {
    await glasses.loading({ ...SCREEN, list: [row(27, 0, ''), row(27, 0, '')] });
    bridge.rebuildPageContainer.mockClear();
    await glasses.updateLoadingList([row(27, 216, 'Gen.G vs LYON'), row(27, 216, '...')]);
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
    expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
    expect(texts()).toEqual(expect.arrayContaining(['Gen.G vs LYON', '...']));
  });

  it('then rewrites those rows in place, as the prices come', async () => {
    await glasses.loading({ ...SCREEN, list: [row(27, 0, ''), row(27, 0, '')] });
    await glasses.updateLoadingList([row(27, 216, 'Gen.G vs LYON'), row(27, 216, '...')]);
    bridge.rebuildPageContainer.mockClear();
    await glasses.updateLoadingList([row(27, 216, 'Gen.G vs LYON'), row(27, 216, '92% GEN')]);
    expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    // Only the row that changed.
    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(1);
  });

  it('rewrites the estimate in place at the same width, and rebuilds for the time beside it at another', async () => {
    const rows = [row(27, 216, 'Gen.G vs LYON')];
    await glasses.loading({ ...SCREEN, message: 'Loading… ~20s', list: rows });
    bridge.rebuildPageContainer.mockClear();
    await glasses.updateLoadingList(rows, 'Loading… ~20s');
    expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
    await glasses.updateLoadingList(rows, 'Loading… ~30s');
    expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(1);
    await glasses.updateLoadingList(rows, 'Loading… ~9s');
    expect(bridge.rebuildPageContainer).toHaveBeenCalledTimes(1);
    expect(texts()).toContain('Loading… ~9s');
  });

  it('keeps the message when given none', async () => {
    await glasses.loading({ ...SCREEN, message: 'Loading… ~20s', list: [row(27, 0, '')] });
    await glasses.updateLoadingList([row(27, 216, 'Gen.G vs LYON')]);
    expect(texts()).toContain('Loading… ~20s');
  });

  it('leaves a chart alone once it\'s up, whatever the layout', async () => {
    await glasses.loading({ ...SCREEN, list: [row(27, 0, '')] });
    await glasses.show([]);
    bridge.rebuildPageContainer.mockClear();
    await glasses.updateLoadingList([row(27, 216, 'Gen.G vs LYON')]);
    await glasses.updateLoadingList([row(27, 216, '92% GEN')]);
    expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    expect(bridge.textContainerUpgrade).not.toHaveBeenCalled();
  });

  it('does nothing before a loading screen has gone up', async () => {
    await glasses.updateLoadingList([row(27, 216, 'Gen.G vs LYON')]);
    expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    expect(bridge.createStartUpPageContainer).not.toHaveBeenCalled();
  });
});
