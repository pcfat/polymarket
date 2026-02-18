const axios = require('axios');

/**
 * Fetch orderbook from Polymarket CLOB API
 * @param {string} tokenId - Token ID
 * @returns {Object} - { bids: [], asks: [] }
 */
async function fetchOrderBook(tokenId) {
  try {
    const response = await axios.get('https://clob.polymarket.com/book', {
      params: { token_id: tokenId },
      timeout: 5000
    });
    
    return response.data || { bids: [], asks: [] };
  } catch (error) {
    console.error(`Error fetching orderbook for token ${tokenId}:`, error.message);
    throw error;
  }
}

/**
 * Calculate bid/ask imbalance
 * @param {Object} orderbook - { bids: [{price, size}], asks: [{price, size}] }
 * @returns {number} - Imbalance (-1 to 1)
 */
function calculateImbalance(orderbook) {
  if (!orderbook.bids || !orderbook.asks) return 0;
  
  const totalBids = orderbook.bids.reduce((sum, b) => sum + parseFloat(b.size || 0), 0);
  const totalAsks = orderbook.asks.reduce((sum, a) => sum + parseFloat(a.size || 0), 0);
  
  const total = totalBids + totalAsks;
  if (total === 0) return 0;
  
  const imbalance = (totalBids - totalAsks) / total;
  return imbalance;
}

/**
 * Detect large orders (whale detection)
 * @param {Object} orderbook - { bids: [{price, size}], asks: [{price, size}] }
 * @param {number} threshold - Size threshold multiplier (default 3)
 * @returns {Object} - { largeBuyOrders: number, largeSellOrders: number, score: number }
 */
function detectLargeOrders(orderbook, threshold = 3) {
  if (!orderbook.bids || !orderbook.asks) {
    return { largeBuyOrders: 0, largeSellOrders: 0, score: 0 };
  }
  
  const allOrders = [
    ...orderbook.bids.map(b => parseFloat(b.size || 0)),
    ...orderbook.asks.map(a => parseFloat(a.size || 0))
  ];
  
  if (allOrders.length === 0) {
    return { largeBuyOrders: 0, largeSellOrders: 0, score: 0 };
  }
  
  const avgSize = allOrders.reduce((a, b) => a + b, 0) / allOrders.length;
  const largeThreshold = avgSize * threshold;
  
  let largeBuyOrders = 0;
  let largeSellOrders = 0;
  
  orderbook.bids.forEach(bid => {
    if (parseFloat(bid.size || 0) > largeThreshold) {
      largeBuyOrders++;
    }
  });
  
  orderbook.asks.forEach(ask => {
    if (parseFloat(ask.size || 0) > largeThreshold) {
      largeSellOrders++;
    }
  });
  
  // Score: positive for more large buy orders, negative for more large sell orders
  // +1 in denominator prevents division by zero when no large orders exist
  const score = (largeBuyOrders - largeSellOrders) / (largeBuyOrders + largeSellOrders + 1);
  
  return { largeBuyOrders, largeSellOrders, score };
}

/**
 * Analyze spread
 * @param {Object} orderbook - { bids: [{price, size}], asks: [{price, size}] }
 * @returns {Object} - { spread, spreadPct, isLiquid }
 */
function analyzeSpread(orderbook) {
  if (!orderbook.bids || !orderbook.asks || 
      orderbook.bids.length === 0 || orderbook.asks.length === 0) {
    return { spread: 0, spreadPct: 1, isLiquid: false };
  }
  
  const bestBid = parseFloat(orderbook.bids[0]?.price || 0);
  const bestAsk = parseFloat(orderbook.asks[0]?.price || 0);
  
  if (bestBid === 0 || bestAsk === 0) {
    return { spread: 0, spreadPct: 1, isLiquid: false };
  }
  
  const spread = bestAsk - bestBid;
  const midPrice = (bestBid + bestAsk) / 2;
  const spreadPct = midPrice > 0 ? spread / midPrice : 1;
  
  // Tight spread = high liquidity
  const isLiquid = spreadPct < 0.05; // Less than 5% spread
  
  return { spread, spreadPct, isLiquid };
}

/**
 * Analyze order book depth
 * @param {Object} orderbook - { bids: [{price, size}], asks: [{price, size}] }
 * @returns {Object} - { bidDepth, askDepth, depthRatio }
 */
function analyzeDepth(orderbook) {
  if (!orderbook.bids || !orderbook.asks) {
    return { bidDepth: 0, askDepth: 0, depthRatio: 0 };
  }
  
  // Calculate depth in top 5 levels
  const bidDepth = orderbook.bids.slice(0, 5).reduce((sum, b) => sum + parseFloat(b.size || 0), 0);
  const askDepth = orderbook.asks.slice(0, 5).reduce((sum, a) => sum + parseFloat(a.size || 0), 0);
  
  const totalDepth = bidDepth + askDepth;
  if (totalDepth === 0) return { bidDepth: 0, askDepth: 0, depthRatio: 0 };
  
  // Ratio: positive if more bid depth (support), negative if more ask depth (resistance)
  const depthRatio = (bidDepth - askDepth) / totalDepth;
  
  return { bidDepth, askDepth, depthRatio };
}

/**
 * Main order flow analysis function
 * @param {string} yesTokenId - YES token ID
 * @param {string} noTokenId - NO token ID
 * @returns {Object} - { score: number (-1 to 1), confidence: number (0 to 1), details: {...} }
 */
async function analyzeOrderFlow(yesTokenId, noTokenId) {
  try {
    if (!yesTokenId || !noTokenId) {
      throw new Error('Missing token IDs for order flow analysis');
    }
    
    // Fetch orderbooks for both YES and NO tokens in parallel
    const [yesBook, noBook] = await Promise.all([
      fetchOrderBook(yesTokenId),
      fetchOrderBook(noTokenId)
    ]);
    
    // Analyze YES token orderbook
    const yesImbalance = calculateImbalance(yesBook);
    const yesLargeOrders = detectLargeOrders(yesBook);
    const yesSpread = analyzeSpread(yesBook);
    const yesDepth = analyzeDepth(yesBook);
    
    // Analyze NO token orderbook
    const noImbalance = calculateImbalance(noBook);
    const noLargeOrders = detectLargeOrders(noBook);
    const noSpread = analyzeSpread(noBook);
    const noDepth = analyzeDepth(noBook);
    
    // Combined analysis
    // Positive imbalance on YES or negative on NO = bullish
    // Negative imbalance on YES or positive on NO = bearish
    const imbalanceScore = (yesImbalance - noImbalance) / 2;
    
    // Large orders analysis
    const largeOrderScore = (yesLargeOrders.score - noLargeOrders.score) / 2;
    
    // Depth analysis
    const depthScore = (yesDepth.depthRatio - noDepth.depthRatio) / 2;
    
    // Calculate composite score
    // Weights: imbalance 40%, large orders 35%, depth 25%
    const compositeScore = 
      imbalanceScore * 0.4 +
      largeOrderScore * 0.35 +
      depthScore * 0.25;
    
    // Calculate confidence based on liquidity
    // Both YES and NO should have liquid markets for high confidence
    const avgSpreadPct = (yesSpread.spreadPct + noSpread.spreadPct) / 2;
    let confidence = 0;
    
    if (avgSpreadPct < 0.02) {
      confidence = 1.0; // Very liquid
    } else if (avgSpreadPct < 0.05) {
      confidence = 0.7; // Liquid
    } else if (avgSpreadPct < 0.10) {
      confidence = 0.4; // Moderate
    } else {
      confidence = 0.2; // Low liquidity
    }
    
    return {
      score: Math.max(-1, Math.min(1, compositeScore)),
      confidence,
      details: {
        yes: {
          imbalance: yesImbalance,
          largeOrders: yesLargeOrders,
          spread: yesSpread,
          depth: yesDepth
        },
        no: {
          imbalance: noImbalance,
          largeOrders: noLargeOrders,
          spread: noSpread,
          depth: noDepth
        },
        avgSpreadPct,
        isLiquid: yesSpread.isLiquid && noSpread.isLiquid
      }
    };
  } catch (error) {
    console.error('Order flow analysis error:', error.message);
    return {
      score: 0,
      confidence: 0,
      error: error.message,
      details: {}
    };
  }
}

module.exports = { analyzeOrderFlow };
