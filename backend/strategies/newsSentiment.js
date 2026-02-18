const axios = require('axios');

// Weighting constants for sentiment scoring
const CRYPTOPANIC_NEWS_WEIGHT = 0.7;    // Weight for CryptoPanic news headlines
const COINGECKO_PRICE_WEIGHT = 0.5;     // Weight for CoinGecko price momentum (fallback)
const FEAR_GREED_PRIMARY_WEIGHT = 0.3;  // Weight for F&G when news is available
const FEAR_GREED_FALLBACK_WEIGHT = 0.5; // Weight for F&G when only price data available

// CryptoPanic sentiment analysis constants
const VOTE_WEIGHT = 0.6;                // Weight for community votes in CryptoPanic posts
const KEYWORD_WEIGHT = 0.4;             // Weight for keyword analysis in CryptoPanic posts
const KEYWORD_NORMALIZATION = 5;        // Divisor to normalize keyword scores to -1 to +1 range
const RECENCY_DECAY = 0.5;              // Weight decay factor from newest to oldest posts

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
 * @returns {number} - Sentiment score (unbounded, typically -5 to +5 range based on keyword matches)
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
 * Fetch news from CryptoPanic free API
 * @param {string} coinName - Coin name to search (e.g., 'bitcoin')
 * @returns {Array|null} - Array of news posts or null if failed
 */
async function fetchCryptoPanicNews(coinName) {
  const currencyMap = {
    'bitcoin': 'BTC',
    'ethereum': 'ETH',
    'solana': 'SOL',
    'ripple': 'XRP'
  };
  const currency = currencyMap[coinName] || 'BTC';
  
  try {
    // CryptoPanic free API - no auth token required for public posts
    const response = await axios.get('https://cryptopanic.com/api/free/v1/posts/', {
      params: {
        currencies: currency,
        kind: 'news',
        public: true  // Access public posts without authentication
      },
      timeout: 5000
    });
    
    const posts = response.data?.results || [];
    return posts.slice(0, 20); // Limit to 20 most recent
  } catch (error) {
    console.error(`Error fetching CryptoPanic news for ${coinName}:`, error.message);
    return null; // null means "failed, try fallback"
  }
}

/**
 * Analyze CryptoPanic posts sentiment using their vote data
 * @param {Array} posts - Array of CryptoPanic posts
 * @returns {number} - Sentiment score (-1 to 1)
 */
function analyzeCryptoPanicSentiment(posts) {
  if (!posts || posts.length === 0) return 0;
  
  let totalScore = 0;
  let totalWeight = 0;
  
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    let postScore = 0;
    
    // Use CryptoPanic's community votes if available
    if (post.votes) {
      const positive = (post.votes.positive || 0) + (post.votes.liked || 0);
      const negative = (post.votes.negative || 0) + (post.votes.disliked || 0);
      const total = positive + negative;
      if (total > 0) {
        postScore = (positive - negative) / total; // -1 to +1
      }
    }
    
    // Also apply keyword analysis on title as supplementary signal
    if (post.title) {
      const keywordScore = analyzeSentimentText(post.title);
      // Combine: 60% votes, 40% keywords (or 100% keywords if no votes)
      if (post.votes && (post.votes.positive || post.votes.negative || post.votes.liked || post.votes.disliked)) {
        postScore = postScore * VOTE_WEIGHT + (keywordScore / KEYWORD_NORMALIZATION) * KEYWORD_WEIGHT;
      } else {
        postScore = keywordScore / KEYWORD_NORMALIZATION; // Normalize keyword score to -1 to +1 range
      }
      // Clamp to ensure postScore stays within valid range
      postScore = Math.max(-1, Math.min(1, postScore));
    }
    
    // Weight by recency (newer posts = higher weight, 50% decay from newest to oldest)
    const weight = 1 - (i / posts.length) * RECENCY_DECAY;
    totalScore += postScore * weight;
    totalWeight += weight;
  }
  
  // Calculate weighted average
  const avgScore = totalWeight > 0 ? totalScore / totalWeight : 0;
  return Math.max(-1, Math.min(1, avgScore));
}

/**
 * Fetch crypto sentiment data from CoinGecko (Layer 2 fallback)
 * Uses price change percentages as market sentiment indicator
 * @param {string} coinName - Coin name to search (e.g., 'bitcoin')
 * @returns {Object|null} - { score, details } or null if failed
 */
async function fetchCoinGeckoSentiment(coinName) {
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
    score += Math.max(-2, Math.min(2, priceChange1h / 2)); // 1h: ±2% = ±1 score
    score += Math.max(-1, Math.min(1, priceChange24h / 10)); // 24h: ±10% = ±1 score
    
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
 * Main news sentiment analysis function with 3-layer fallback
 * @param {string} coin - Coin symbol (btc, eth, sol, xrp) or market question
 * @returns {Object} - { score: number (-1 to 1), details: {...} }
 */
async function analyzeNewsSentiment(coin) {
  try {
    const coinName = getCoinNameForSearch(coin);
    
    // Fetch Fear & Greed Index (always, used in all paths)
    const fearGreed = await fetchFearGreedIndex();
    const fearGreedScore = fearGreedToScore(fearGreed.value);
    
    // Layer 1: Try CryptoPanic news (primary)
    const posts = await fetchCryptoPanicNews(coinName);
    
    if (posts && posts.length > 0) {
      const newsSentiment = analyzeCryptoPanicSentiment(posts);
      // Combine: 70% news headlines, 30% Fear & Greed
      const combinedScore = newsSentiment * CRYPTOPANIC_NEWS_WEIGHT + fearGreedScore * FEAR_GREED_PRIMARY_WEIGHT;
      
      return {
        score: combinedScore,
        details: {
          coin: coinName,
          source: 'cryptopanic',
          newsCount: posts.length,
          avgSentiment: newsSentiment,
          fearGreedIndex: fearGreed.value,
          fearGreedLabel: fearGreed.classification,
          recentHeadlines: posts.slice(0, 5).map(p => p.title)
        }
      };
    }
    
    // Layer 2: Try CoinGecko price momentum (secondary fallback)
    const coingeckoSentiment = await fetchCoinGeckoSentiment(coinName);
    
    if (coingeckoSentiment !== null) {
      // Combine: 50% price momentum, 50% Fear & Greed (less confident without real news)
      const combinedScore = coingeckoSentiment.score * COINGECKO_PRICE_WEIGHT + fearGreedScore * FEAR_GREED_FALLBACK_WEIGHT;
      
      return {
        score: combinedScore,
        details: {
          coin: coinName,
          source: 'coingecko_fallback',
          ...coingeckoSentiment.details,
          fearGreedIndex: fearGreed.value,
          fearGreedLabel: fearGreed.classification
        }
      };
    }
    
    // Layer 3: Fear & Greed only (final fallback)
    return {
      score: fearGreedScore,
      details: {
        coin: coinName,
        source: 'fear_greed_only',
        fearGreedIndex: fearGreed.value,
        fearGreedLabel: fearGreed.classification
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
