const { analyzeTechnical } = require('./technicalAnalysis');
const { analyzeNewsSentiment } = require('./newsSentiment');
const { analyzeOrderFlow } = require('./orderFlow');

// Default weights (configurable from frontend)
const DEFAULT_WEIGHTS = {
  technical: 0.45,    // Technical analysis weight
  news: 0.30,         // News sentiment weight
  orderFlow: 0.25     // Order flow weight
};

/**
 * Check if a strategy analysis succeeded
 * @param {Object} result - Result from Promise.allSettled
 * @returns {boolean} - True if strategy succeeded without error
 */
function isStrategySuccessful(result) {
  return result.status === 'fulfilled' && 
         result.value.score !== undefined && 
         !result.value.error;
}

/**
 * Main composite market analysis function
 * Combines technical analysis, news sentiment, and order flow analysis
 * 
 * OUTCOME MAPPING:
 * - YES = Up = bullish = token index 0 (price increases)
 * - NO = Down = bearish = token index 1 (price decreases)
 * 
 * This mapping ensures compatibility with the database CHECK constraint
 * which enforces outcome IN ('YES', 'NO'). The Polymarket API uses
 * 'Up'/'Down' for 15-minute crypto markets, but we standardize to YES/NO
 * for internal representation and settlement.
 * 
 * @param {string} coin - Coin symbol or market question
 * @param {string} yesTokenId - YES token ID for order flow (Up token)
 * @param {string} noTokenId - NO token ID for order flow (Down token)
 * @param {Object} weights - Strategy weights { technical, news, orderFlow }
 * @returns {Object} - Complete analysis with decision
 */
async function analyzeMarket(coin, yesTokenId, noTokenId, weights = DEFAULT_WEIGHTS) {
  try {
    // Run all three analyses in parallel
    const [technical, news, orderFlow] = await Promise.allSettled([
      analyzeTechnical(coin),
      analyzeNewsSentiment(coin),
      analyzeOrderFlow(yesTokenId, noTokenId)
    ]);

    // Extract scores (default to 0 if any analysis failed)
    const taScore = technical.status === 'fulfilled' ? technical.value.score : 0;
    const newsScore = news.status === 'fulfilled' ? news.value.score : 0;
    const ofScore = orderFlow.status === 'fulfilled' ? orderFlow.value.score : 0;
    const ofConfidence = orderFlow.status === 'fulfilled' ? orderFlow.value.confidence : 0;

    // Dynamic weight redistribution when strategies fail
    // Determine which strategies succeeded (no error and returned valid score)
    const successfulStrategies = [];
    if (isStrategySuccessful(technical)) {
      successfulStrategies.push({ name: 'technical', score: taScore, weight: weights.technical });
    }
    if (isStrategySuccessful(news)) {
      successfulStrategies.push({ name: 'news', score: newsScore, weight: weights.news });
    }
    if (isStrategySuccessful(orderFlow)) {
      successfulStrategies.push({ name: 'orderFlow', score: ofScore, weight: weights.orderFlow });
    }

    // Redistribute weights from failed strategies to successful ones
    let adjustedWeights = { technical: 0, news: 0, orderFlow: 0 };
    
    if (successfulStrategies.length > 0) {
      // Calculate total weight of successful strategies
      const successfulWeight = successfulStrategies.reduce((sum, s) => sum + s.weight, 0);
      
      // Redistribute weights proportionally among successful strategies
      successfulStrategies.forEach(s => {
        adjustedWeights[s.name] = s.weight / successfulWeight;
      });
    } else {
      // No strategies succeeded - use original weights (will result in 0 score)
      adjustedWeights = { ...weights };
    }

    // Calculate composite score with adjusted weights
    const compositeScore = 
      taScore * adjustedWeights.technical +
      newsScore * adjustedWeights.news +
      ofScore * adjustedWeights.orderFlow;

    // Determine confidence (0-1) based on agreement between signals
    const signals = [taScore, newsScore, ofScore];
    const allSameDirection = signals.every(s => s > 0) || signals.every(s => s < 0);
    
    let confidence;
    if (allSameDirection) {
      confidence = 0.9; // High confidence when all agree
    } else {
      // Confidence based on how many signals agree with composite direction
      const compositeDirection = Math.sign(compositeScore);
      const agreeingSignals = signals.filter(s => Math.sign(s) === compositeDirection).length;
      confidence = agreeingSignals / 3;
    }
    
    // Factor in order flow liquidity confidence
    confidence = confidence * 0.7 + ofConfidence * 0.3;

    // Trading decision
    let decision = 'HOLD'; // Default: don't trade
    let outcome = null;
    let tradeAmount = 'normal'; // 'normal', 'reduced', 'increased'

    // Minimum edge thresholds (raised for better risk management)
    const MIN_COMPOSITE_SCORE = 0.35;  // Raised from 0.3
    const MIN_CONFIDENCE = 0.50;       // Raised from 0.4

    // Strong signals with high confidence
    if (compositeScore > 0.5 && confidence > 0.65) {
      decision = 'BUY';
      outcome = 'YES'; // UP
      tradeAmount = 'increased';
    } 
    // Moderate bullish signals
    else if (compositeScore > MIN_COMPOSITE_SCORE && confidence > MIN_CONFIDENCE) {
      decision = 'BUY';
      outcome = 'YES'; // UP
      tradeAmount = 'normal';
    }
    // Strong bearish signals with high confidence
    else if (compositeScore < -0.5 && confidence > 0.65) {
      decision = 'BUY';
      outcome = 'NO'; // DOWN
      tradeAmount = 'increased';
    }
    // Moderate bearish signals
    else if (compositeScore < -MIN_COMPOSITE_SCORE && confidence > MIN_CONFIDENCE) {
      decision = 'BUY';
      outcome = 'NO'; // DOWN
      tradeAmount = 'normal';
    }

    // If spread is too wide (low liquidity), reduce or skip
    if (orderFlow.status === 'fulfilled' && orderFlow.value.confidence < 0.3) {
      if (decision === 'BUY' && tradeAmount === 'increased') {
        tradeAmount = 'normal'; // Reduce size due to low liquidity
      } else if (decision === 'BUY' && tradeAmount === 'normal') {
        decision = 'HOLD'; // Skip trade due to low liquidity
        outcome = null;
      }
    }

    return {
      compositeScore,
      confidence,
      decision,
      outcome,
      tradeAmount,
      breakdown: {
        technical: technical.status === 'fulfilled' ? technical.value : { 
          score: 0, 
          error: technical.reason?.message || 'Analysis failed',
          details: {}
        },
        news: news.status === 'fulfilled' ? news.value : { 
          score: 0, 
          error: news.reason?.message || 'Analysis failed',
          details: {}
        },
        orderFlow: orderFlow.status === 'fulfilled' ? orderFlow.value : { 
          score: 0, 
          confidence: 0,
          error: orderFlow.reason?.message || 'Analysis failed',
          details: {}
        }
      },
      weights: adjustedWeights,
      originalWeights: weights
    };
  } catch (error) {
    console.error('Composite market analysis error:', error.message);
    
    // Return safe defaults on error
    return {
      compositeScore: 0,
      confidence: 0,
      decision: 'HOLD',
      outcome: null,
      tradeAmount: 'normal',
      breakdown: {
        technical: { score: 0, error: error.message, details: {} },
        news: { score: 0, error: error.message, details: {} },
        orderFlow: { score: 0, confidence: 0, error: error.message, details: {} }
      },
      weights,
      error: error.message
    };
  }
}

module.exports = { analyzeMarket, DEFAULT_WEIGHTS };
