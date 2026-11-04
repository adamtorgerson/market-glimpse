#!/usr/bin/env python3
"""Writes test/charting/fixtures/analysis-reference.json, the outside reference
for test/charting/analysis-reference.test.ts: real Kraken candles, and what
TA-Lib makes of them. Run from a virtualenv with `pip install TA-Lib numpy`:

  python scripts/analysis-fixtures.py [--save-history FILE]

Each market's whole history (up to Kraken's 720 candles) goes through TA-Lib,
but only the tail a chart can show is kept. So `talibLong` says what a chart
with long history shows, for the candles kept, and `talib` what TA-Lib makes of
just the last `SHOWN` of them, as we do. --save-history keeps the whole of it.

Kraken's own per-candle VWAP is kept too. TA-Lib has no VWAP, and Kraken's comes
from its trades, so it's an independent check on ours.

This goes back further than a chart does (CLAUDE.md's rule 3 is for the app's
requests), but still makes one request per market, one per 1.5s.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import talib

PATH = Path(__file__).resolve().parent.parent / 'test/charting/fixtures/analysis-reference.json'
SHOWN = 129  # A full-width chart of narrow candles.
KEPT = 172  # Of thin ones, the most a chart shows.
TOKENIZED = '&asset_class=tokenized_asset'  # As src/sources/kraken.ts sends it.
# Busy, slower and thinly traded (no-volume and flat candles), then each daily.
MARKETS = [
    ('BTC-USD 5m', 'XBTUSD', 5, ''),
    ('ETH-USD 1h', 'ETHUSD', 60, ''),
    ('TSLA-USD 5m', 'TSLAxUSD', 5, TOKENIZED),
    ('BTC-USD 1d', 'XBTUSD', 1440, ''),
    ('ETH-USD 1d', 'ETHUSD', 1440, ''),
    ('TSLA-USD 1d', 'TSLAxUSD', 1440, TOKENIZED),
]


def fetch(pair, interval, query):
    url = f'https://api.kraken.com/0/public/OHLC?pair={pair}&interval={interval}{query}'
    request = urllib.request.Request(url, headers={'User-Agent': 'MarketGlimpse-fixtures'})
    with urllib.request.urlopen(request, timeout=20) as r:
        body = json.load(r)
    if body['error']:
        raise SystemExit(f'{pair} {interval}: {body["error"]}')
    return next(v for k, v in body['result'].items() if k != 'last')


def series(a):
    """Twelve significant figures is plenty to compare with, and keeps the file small."""
    return [None if np.isnan(v) else float(f'{v:.12g}') for v in a]


def columns(rows):
    return tuple(np.array([float(r[i]) for r in rows]) for i in (2, 3, 4))


def history_dependent(h, l, c):
    """Those that carry their past forward; the rest only look at a window of candles."""
    line, signal, hist = talib.MACD(c, 12, 26, 9)
    return {
        'ema': talib.EMA(c, 20), 'rsi': talib.RSI(c, 14), 'atr': talib.ATR(h, l, c, 14),
        'macd': line, 'macdSignal': signal, 'macdHist': hist, 'sar': talib.SAR(h, l, 0.02, 0.2),
    }


def reference(h, l, c):
    upper, mid, lower = talib.BBANDS(c, 20, 2, 2, 0)
    return {
        **history_dependent(h, l, c),
        'sma': talib.SMA(c, 20), 'bollingerUpper': upper, 'bollingerMid': mid, 'bollingerLower': lower,
        'donchianUpper': talib.MAX(h, 20), 'donchianLower': talib.MIN(l, 20), 'sarFast': talib.SAR(h, l, 0.05, 0.5),
    }


markets, history = [], {}
for i, (name, pair, interval, query) in enumerate(MARKETS):
    if i:
        time.sleep(1.5)
    rows = fetch(pair, interval, query)
    history[name] = rows
    long = history_dependent(*columns(rows))
    kept = rows[-KEPT:]
    markets.append({
        'name': name,
        'history': len(rows),
        # time, open, high, low, close, volume
        'candles': [[r[0], float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[6])] for r in kept],
        'krakenVwap': [float(r[5]) for r in kept],
        'talib': {k: series(a) for k, a in reference(*columns(rows[-SHOWN:])).items()},
        'talibLong': {k: series(a[-KEPT:]) for k, a in long.items()},
    })

PATH.write_text(json.dumps({'talibVersion': talib.__version__, 'shown': SHOWN, 'markets': markets}, separators=(',', ':')) + '\n')
print(PATH, f'{PATH.stat().st_size // 1024} KB, TA-Lib {talib.__version__}')
if '--save-history' in sys.argv:
    Path(sys.argv[sys.argv.index('--save-history') + 1]).write_text(json.dumps(history))
for name, rows in history.items():
    step = next(interval for n, _, interval, _ in MARKETS if n == name) * 60
    gaps = sum(b[0] - a[0] != step for a, b in zip(rows, rows[1:]))
    print(f'  {name}: {len(rows)} candles, {gaps} gaps, {sum(float(r[6]) == 0 for r in rows)} with no volume, {sum(r[2] == r[3] for r in rows)} flat')
