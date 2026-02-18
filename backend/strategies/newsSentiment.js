const axios = require('axios');

// Price change thresholds for sentiment calculation
const PRICE_CHANGE_1H_THRESHOLD = 2;   // ±2% 1-hour change = ±1 sentiment score
const PRICE_CHANGE_24H_THRESHOLD = 10; // ±10% 24-hour change = ±1 sentiment score

// Positive keywords for sentiment analysis
const POSITIVE_WORDS = [
  'surge', 'rally', 'bullish', 'pump', 'soar', 'breakout', 'moon', 'ath',
  'all-time high', 'gain', 'jump', 'spike', 'rise', 'climbed', 'record',
  'positive', 'growth', 'adoption', 'approval', 'etf approved', 'upgrade',
  'partnership', 'institutional', 'buy', 'accumulate', 'strong', 'boom',
  '漲', '暴漲', '突破', '利好', '牛市', '新高', '上升'
];

// Negative keywords for sentiment analysis
const NEGATIVE_WORDS = [
  'crash', 'dump', 'bearish', 'plunge', 'drop', 'fall', 'decline', 'sell-off',
  'hack', 'exploit', 'vulnerability', 'sec', 'lawsuit', 'ban', 'regulation',
  'fear', 'panic', 'liquidation', 'bankruptcy', 'fraud', 'scam', 'rug pull',
  'warning', 'risk', 'concern', 'trouble', 'loss', 'collapse', 'correction',
  '跌', '暴跌', '崩盤', '利空', '熊市', '監管', '下跌'
];

/**
 * Analyze sentiment of text using keyword matching
 * @param {string} text - Text to analyze
 * @returns {number} - Sentiment score (positive or negative)
 */
function analyzeSentimentText(text) {
  if (!text) return 0;
  
  const lower = text.toLowerCase();
  let score = 0;
  
  POSITIVE_WORDS.forEach(word => {
    if (lower.includes(word)) score += 1;
  });
  
  NEGATIVE_WORDS.forEach(word => {
    if (lower.includes(word)) score -= 1;
  });
  
  return score;
}

/**
 * Extract coin name for API query
 * @param {string} coin - Coin symbol (btc, eth, sol, xrp) or market question
 * @returns {string} - Coin name for news search
 */
function getCoinNameForSearch(coin) {
  const coinMap = {
    'btc': 'bitcoin',
    'eth': 'ethereum',
    'sol': 'solana',
    'xrp': 'ripple'
  };
  
  const lowerCoin = coin.toLowerCase();
  
  // Direct mapping
  if (coinMap[lowerCoin]) {
    return coinMap[lowerCoin];
  }
  
  // Extract from question
  if (lowerCoin.includes('btc') || lowerCoin.includes('bitcoin')) return 'bitcoin';
  if (lowerCoin.includes('eth') || lowerCoin.includes('ethereum')) return 'ethereum';
  if (lowerCoin.includes('sol') || lowerCoin.includes('solana')) return 'solana';
  if (lowerCoin.includes('xrp') || lowerCoin.includes('ripple')) return 'ripple';
  
  return 'bitcoin'; // Default fallback
}

/**
 * Fetch crypto sentiment data from CoinGecko as proxy for news sentiment
 * Uses price change percentages as market sentiment indicator
 * @param {string} coinName - Coin name to search (e.g., 'bitcoin')
 * @returns {Object|null} - { score, details } or null if failed
 */
async function fetchCryptoSentimentData(coinName) {
  const coinIdMap = { 
    'bitcoin': 'bitcoin', 
    'ethereum': 'ethereum', 
    'solana': 'solana', 
    'ripple': 'ripple' 
  };
  const coinId = coinIdMap[coinName] || 'bitcoin';
  
  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}`, {
      params: { 
        localization: false, 
        tickers: false, 
        community_data: false, 
        developer_data: false 
      },
      timeout: 5000
    });
    
    const data = response.data;
    const priceChange24h = data.market_data?.price_change_percentage_24h || 0;
    const priceChange1h = data.market_data?.price_change_percentage_1h_in_currency?.usd || 0;
    
    // Convert price changes to sentiment score
    // 1h change is more relevant for 15-minute markets
    let score = 0;
    score += Math.max(-2, Math.min(2, priceChange1h / PRICE_CHANGE_1H_THRESHOLD)); // 1h: ±2% = ±1 score
    score += Math.max(-1, Math.min(1, priceChange24h / PRICE_CHANGE_24H_THRESHOLD)); // 24h: ±10% = ±1 score
    
    return {
      score: Math.max(-1, Math.min(1, score / 3)),
      details: {
        coin: coinName,
        priceChange1h,
        priceChange24h,
        source: 'coingecko'
      }
    };
  } catch (error) {
    console.error(`Error fetching CoinGecko data for ${coinName}:`, error.message);
    return null; // Will fall back to Fear & Greed only
  }
}

/**
 * Fetch Fear & Greed Index from Alternative.me
 * @returns {Object} - { value: number, classification: string }
 */
async function fetchFearGreedIndex() {
  try {
    const response = await axios.get('https://api.alternative.me/fng/', {
      timeout: 5000
    });
    
    const data = response.data?.data?.[0];
    if (!data) {
      return { value: 50, classification: 'Neutral' };
    }
    
    return {
      value: parseInt(data.value) || 50,
      classification: data.value_classification || 'Neutral'
    };
  } catch (error) {
    console.error('Error fetching Fear & Greed Index:', error.message);
    return { value: 50, classification: 'Neutral' };
  }
}

/**
 * Convert Fear & Greed Index to sentiment score
 * @param {number} fgValue - Fear & Greed Index value (0-100)
 * @returns {number} - Sentiment score (-1 to 1)
 */
function fearGreedToScore(fgValue) {
  if (fgValue <= 25) return -1;      // Extreme Fear
  if (fgValue <= 45) return -0.5;    // Fear
  if (fgValue <= 55) return 0;       // Neutral
  if (fgValue <= 75) return 0.5;     // Greed
  return 1;                          // Extreme Greed
}

/**
 * Main news sentiment analysis function
 * @param {string} coin - Coin symbol (btc, eth, sol, xrp) or market question
 * @returns {Object} - { score: number (-1 to 1), details: {...} }
 */
async function analyzeNewsSentiment(coin) {
  try {
    const coinName = getCoinNameForSearch(coin);
    
    // Fetch CoinGecko sentiment data and Fear & Greed Index in parallel
    const [sentimentData, fearGreed] = await Promise.all([
      fetchCryptoSentimentData(coinName),
      fetchFearGreedIndex()
    ]);
    
    // Convert Fear & Greed to score
    const fearGreedScore = fearGreedToScore(fearGreed.value);
    
    let combinedScore;
    let details;
    
    if (sentimentData) {
      // Combine: 70% market sentiment (from CoinGecko), 30% Fear & Greed
      combinedScore = sentimentData.score * 0.7 + fearGreedScore * 0.3;
      
      details = {
        coin: coinName,
        marketSentiment: sentimentData.score,
        priceChange1h: sentimentData.details.priceChange1h,
        priceChange24h: sentimentData.details.priceChange24h,
        fearGreedIndex: fearGreed.value,
        fearGreedLabel: fearGreed.classification,
        source: 'coingecko+feargreed'
      };
    } else {
      // Fallback: use Fear & Greed Index alone if CoinGecko fails
      combinedScore = fearGreedScore;
      
      details = {
        coin: coinName,
        fearGreedIndex: fearGreed.value,
        fearGreedLabel: fearGreed.classification,
        source: 'feargreed_only',
        note: 'CoinGecko data unavailable, using Fear & Greed Index only'
      };
    }
    
    return {
      score: combinedScore,
      details
    };
  } catch (error) {
    console.error('News sentiment analysis error:', error.message);
    return {
      score: 0,
      error: error.message,
      details: {}
    };
  }
}

module.exports = { analyzeNewsSentiment };
