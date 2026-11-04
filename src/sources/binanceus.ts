import { binanceApiSource } from './binance';

// Binance.US: Binance.com blocks the US (HTTP 451).
export const binanceus = binanceApiSource('binanceus', 'Binance.US', 'https://api.binance.us/api/v3');
