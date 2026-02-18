const axios = require('axios');

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
 * Fetch crypto news from Speraxos API
 * @param {string} coinName - Coin name to search (e.g., 'bitcoin')
 * @returns {Array} - Array of news articles
 */
async function fetchCryptoNews(coinName) {
  try {
    const response = await axios.get(`https://free-crypto-news.vercel.app/api/search`, {
      params: { q: coinName },
      timeout: 5000
    });
    
    return response.data?.articles || [];
  } catch (error) {
    console.error(`Error fetching news for ${coinName}:`, error.message);
    return [];
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
    
    // Fetch news and Fear & Greed Index in parallel
    const [articles, fearGreed] = await Promise.all([
      fetchCryptoNews(coinName),
      fetchFearGreedIndex()
    ]);
    
    // Analyze sentiment of each article
    let totalSentiment = 0;
    let articleCount = 0;
    
    // Weight more recent articles higher
    const now = Date.now();
    const maxArticles = Math.min(articles.length, 20); // Limit to 20 most recent
    
    for (let i = 0; i < maxArticles; i++) {
      const article = articles[i];
      const title = article.title || '';
      const description = article.description || '';
      const text = `${title} ${description}`;
      
      const sentiment = analyzeSentimentText(text);
      
      // Weight based on recency (newer = higher weight)
      const weight = 1 - (i / maxArticles) * 0.5; // 1.0 to 0.5
      totalSentiment += sentiment * weight;
      articleCount++;
    }
    
    // Calculate average news sentiment
    const avgNewsSentiment = articleCount > 0 ? totalSentiment / articleCount : 0;
    
    // Normalize news sentiment to -1 to 1 range
    // Typical sentiment scores range from -5 to +5 based on keyword matching
    // We divide by 5 to normalize to the [-1, 1] scale used by other strategies
    const normalizedNewsSentiment = Math.max(-1, Math.min(1, avgNewsSentiment / 5));
    
    // Convert Fear & Greed to score
    const fearGreedScore = fearGreedToScore(fearGreed.value);
    
    // Combine: 70% news, 30% Fear & Greed
    const combinedScore = normalizedNewsSentiment * 0.7 + fearGreedScore * 0.3;
    
    return {
      score: combinedScore,
      details: {
        coin: coinName,
        newsCount: articleCount,
        avgSentiment: normalizedNewsSentiment,
        fearGreedIndex: fearGreed.value,
        fearGreedLabel: fearGreed.classification,
        recentHeadlines: articles.slice(0, 5).map(a => a.title)
      }
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
