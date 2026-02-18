const axios = require('axios');

// Binance symbol mapping for supported coins
const BINANCE_SYMBOLS = {
  'btc': 'BTCUSDT',
  'eth': 'ETHUSDT',
  'sol': 'SOLUSDT',
  'xrp': 'XRPUSDT'
};

/**
 * Calculate Exponential Moving Average
 * @param {number[]} prices - Array of prices
 * @param {number} period - EMA period
 * @returns {number} - EMA value
 */
function calculateEMA(prices, period) {
  if (!prices || prices.length === 0) return 0;
  
  const k = 2 / (period + 1);
  let ema = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
}

/**
 * Calculate Relative Strength Index
 * @param {number[]} prices - Array of prices
 * @param {number} period - RSI period (default 7)
 * @returns {number} - RSI value (0-100)
 */
function calculateRSI(prices, period = 7) {
  if (!prices || prices.length < period + 1) return 50; // neutral
  
  let gains = 0;
  let losses = 0;
  
  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // Calculate RSI using smoothed averages
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param {number[]} prices - Array of prices
 * @returns {Object} - { macdLine, signalLine, histogram }
 */
function calculateMACD(prices) {
  if (!prices || prices.length < 13) {
    return { macdLine: 0, signalLine: 0, histogram: 0 };
  }
  
  const fastEMA = calculateEMA(prices, 5);
  const slowEMA = calculateEMA(prices, 13);
  const macdLine = fastEMA - slowEMA;
  
  // For signal line, we need MACD values over time
  // Simplified: use current MACD as signal (in production, track MACD history)
  const signalLine = macdLine * 0.7; // Approximation
  const histogram = macdLine - signalLine;
  
  return { macdLine, signalLine, histogram };
}

/**
 * Calculate Volume Weighted Average Price
 * @param {Array} candles - Array of candle data [timestamp, open, high, low, close, volume, ...]
 * @returns {number} - VWAP value
 */
function calculateVWAP(candles) {
  if (!candles || candles.length === 0) return 0;
  
  let sumTypicalPriceVolume = 0;
  let sumVolume = 0;
  
  for (const candle of candles) {
    const high = parseFloat(candle[2]);
    const low = parseFloat(candle[3]);
    const close = parseFloat(candle[4]);
    const volume = parseFloat(candle[5]);
    
    const typicalPrice = (high + low + close) / 3;
    sumTypicalPriceVolume += typicalPrice * volume;
    sumVolume += volume;
  }
  
  return sumVolume > 0 ? sumTypicalPriceVolume / sumVolume : 0;
}

/**
 * Detect volume spike
 * @param {number[]} volumes - Array of volume values
 * @param {number} threshold - Spike threshold multiplier (default 2.0)
 * @returns {boolean} - True if volume spike detected
 */
function detectVolumeSpike(volumes, threshold = 2.0) {
  if (!volumes || volumes.length < 21) return false;
  
  const latest = volumes[volumes.length - 1];
  const avgVolume = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  
  return latest > avgVolume * threshold;
}

/**
 * Extract coin symbol from market question
 * @param {string} question - Market question
 * @returns {string|null} - Coin symbol (btc, eth, sol, xrp) or null
 */
function extractCoinFromQuestion(question) {
  const lowerQuestion = question.toLowerCase();
  
  if (lowerQuestion.includes('btc') || lowerQuestion.includes('bitcoin')) return 'btc';
  if (lowerQuestion.includes('eth') || lowerQuestion.includes('ethereum')) return 'eth';
  if (lowerQuestion.includes('sol') || lowerQuestion.includes('solana')) return 'sol';
  if (lowerQuestion.includes('xrp') || lowerQuestion.includes('ripple')) return 'xrp';
  
  return null;
}

/**
 * Fetch candle data from Binance
 * @param {string} symbol - Binance symbol (e.g., 'BTCUSDT')
 * @param {string} interval - Candle interval (default '1m')
 * @param {number} limit - Number of candles (default 100)
 * @returns {Array} - Array of candle data
 */
async function fetchBinanceCandles(symbol, interval = '1m', limit = 100) {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: {
        symbol,
        interval,
        limit
      },
      timeout: 5000
    });
    
    return response.data;
  } catch (error) {
    console.error(`Error fetching Binance candles for ${symbol}:`, error.message);
    throw error;
  }
}

/**
 * Main technical analysis function
 * @param {string} coin - Coin symbol (btc, eth, sol, xrp) or market question
 * @returns {Object} - { score: number (-1 to 1), details: {...} }
 */
async function analyzeTechnical(coin) {
  try {
    // Extract coin from question if needed
    let coinSymbol = coin;
    if (!BINANCE_SYMBOLS[coin]) {
      coinSymbol = extractCoinFromQuestion(coin);
    }
    
    if (!coinSymbol || !BINANCE_SYMBOLS[coinSymbol]) {
      throw new Error(`Unsupported coin: ${coin}`);
    }
    
    const binanceSymbol = BINANCE_SYMBOLS[coinSymbol];
    
    // Fetch 100 x 1-minute candles
    const candles = await fetchBinanceCandles(binanceSymbol, '1m', 100);
    
    // Extract close prices and volumes
    const closePrices = candles.map(c => parseFloat(c[4]));
    const volumes = candles.map(c => parseFloat(c[5]));
    const currentPrice = closePrices[closePrices.length - 1];
    
    // Calculate indicators
    const ema5 = calculateEMA(closePrices, 5);
    const ema10 = calculateEMA(closePrices, 10);
    const rsi = calculateRSI(closePrices, 7);
    const macd = calculateMACD(closePrices);
    const vwap = calculateVWAP(candles);
    const volumeSpike = detectVolumeSpike(volumes);
    
    // Track previous RSI for trend detection
    const prevRSI = calculateRSI(closePrices.slice(0, -1), 7);
    const rsiRising = rsi > prevRSI;
    
    // Track previous MACD histogram for trend detection
    const prevMacd = calculateMACD(closePrices.slice(0, -1));
    const histogramIncreasing = macd.histogram > prevMacd.histogram;
    
    // Calculate score based on indicators
    let score = 0;
    const signals = [];
    
    // EMA alignment
    if (currentPrice > ema5 && ema5 > ema10) {
      score += 0.25;
      signals.push('EMA bullish alignment');
    } else if (currentPrice < ema5 && ema5 < ema10) {
      score -= 0.25;
      signals.push('EMA bearish alignment');
    }
    
    // RSI momentum
    if (rsi >= 40 && rsi <= 65 && rsiRising) {
      score += 0.25;
      signals.push('RSI bullish momentum');
    } else if (rsi >= 35 && rsi <= 60 && !rsiRising) {
      score -= 0.25;
      signals.push('RSI bearish momentum');
    }
    
    // RSI extremes (contrarian)
    if (rsi < 30) {
      score += 0.15;
      signals.push('RSI oversold');
    } else if (rsi > 70) {
      score -= 0.15;
      signals.push('RSI overbought');
    }
    
    // MACD
    if (macd.histogram > 0 && histogramIncreasing) {
      score += 0.25;
      signals.push('MACD bullish');
    } else if (macd.histogram < 0 && !histogramIncreasing) {
      score -= 0.25;
      signals.push('MACD bearish');
    }
    
    // VWAP
    if (currentPrice > vwap) {
      score += 0.15;
      signals.push('Price above VWAP');
    } else if (currentPrice < vwap) {
      score -= 0.15;
      signals.push('Price below VWAP');
    }
    
    // Volume spike
    if (volumeSpike) {
      const priceChange = closePrices[closePrices.length - 1] - closePrices[closePrices.length - 2];
      if (priceChange > 0) {
        score += 0.10;
        signals.push('Volume spike with price up');
      } else {
        score -= 0.10;
        signals.push('Volume spike with price down');
      }
    }
    
    // Clamp score to [-1, 1]
    score = Math.max(-1, Math.min(1, score));
    
    return {
      score,
      details: {
        coin: coinSymbol,
        price: currentPrice,
        ema5,
        ema10,
        rsi,
        macd: {
          line: macd.macdLine,
          signal: macd.signalLine,
          histogram: macd.histogram
        },
        vwap,
        volumeSpike,
        signals
      }
    };
  } catch (error) {
    console.error('Technical analysis error:', error.message);
    return {
      score: 0,
      error: error.message,
      details: {}
    };
  }
}

module.exports = { analyzeTechnical };
