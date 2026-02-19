const axios = require('axios');

// Weighting constants for sentiment scoring
const NEWS_HEADLINE_WEIGHT = 0.7;       // Weight for news headlines
const COINGECKO_PRICE_WEIGHT = 0.5;     // Weight for CoinGecko price momentum (fallback)
const FEAR_GREED_PRIMARY_WEIGHT = 0.3;  // Weight for F&G when news is available (sums to 1.0 with NEWS_HEADLINE_WEIGHT)
const FEAR_GREED_FALLBACK_WEIGHT = 0.5; // Weight for F&G when only price data available (sums to 1.0 with COINGECKO_PRICE_WEIGHT)

// News sentiment analysis constants
const KEYWORD_NORMALIZATION = 5;        // Divisor to normalize keyword scores to -1 to +1 range
const RECENCY_DECAY = 0.5;              // Weight decay factor from newest to oldest posts

// Coin to ticker symbol mapping for news APIs
const COIN_TO_TICKER_MAP = {
  'bitcoin': 'BTC',
  'ethereum': 'ETH',
  'solana': 'SOL',
  'ripple': 'XRP'
};

// All supported CoinGecko coin IDs (for batched request)
const COINGECKO_COIN_IDS = ['bitcoin', 'ethereum', 'solana', 'ripple'];

// In-memory cache for CoinGecko responses (TTL: 60 seconds)
const COINGECKO_CACHE_TTL = 60 * 1000;
const coinGeckoCache = { data: null, timestamp: 0, promise: null };

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
 * Fetch news from CryptoCompare API
 * @param {string} coinName - Coin name to search (e.g., 'bitcoin')
 * @returns {Array|null} - Array of news articles or null if failed
 */
async function fetchCryptoNews(coinName) {
  const ticker = COIN_TO_TICKER_MAP[coinName] || 'BTC';
  
  try {
    // CryptoCompare free news API - no auth required for basic access
    const response = await axios.get('https://min-api.cryptocompare.com/data/v2/news/', {
      params: {
        categories: ticker,
        lang: 'EN',
        sortOrder: 'latest'
      },
      timeout: 5000
    });
    
    const articles = Array.isArray(response.data?.Data) ? response.data.Data : [];
    return articles.slice(0, 20);
  } catch (error) {
    console.error(`Error fetching CryptoCompare news for ${coinName}:`, error.message);
    return null;
  }
}

/**
 * Analyze crypto news sentiment using keyword analysis
 * @param {Array} articles - Array of CryptoCompare news articles
 * @returns {number} - Sentiment score (-1 to 1)
 */
function analyzeCryptoNewsSentiment(articles) {
  if (!articles || articles.length === 0) return 0;
  
  let totalScore = 0;
  let totalWeight = 0;
  
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    let articleScore = 0;
    
    // Analyze title (primary signal)
    if (article.title) {
      articleScore = analyzeSentimentText(article.title);
    }
    
    // Normalize to -1 to +1 range
    articleScore = Math.max(-1, Math.min(1, articleScore / KEYWORD_NORMALIZATION));
    
    // Weight by recency
    const weight = 1 - (i / articles.length) * RECENCY_DECAY;
    totalScore += articleScore * weight;
    totalWeight += weight;
  }
  
  const avgScore = totalWeight > 0 ? totalScore / totalWeight : 0;
  return Math.max(-1, Math.min(1, avgScore));
}

/**
 * Build CoinGecko sentiment result from raw price-change values
 * @param {string} coinName
 * @param {number} priceChange1h
 * @param {number} priceChange24h
 * @returns {Object} - { score, details }
 */
function buildCoinGeckoResult(coinName, priceChange1h, priceChange24h) {
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
}

/**
 * Fetch crypto sentiment data from CoinGecko (Layer 2 fallback)
 * Uses price change percentages as market sentiment indicator.
 * All supported coins are fetched in a single batched request and cached for 60s.
 * Concurrent callers share the same in-flight request to avoid duplicate API hits.
 * @param {string} coinName - Coin name to search (e.g., 'bitcoin')
 * @returns {Object|null} - { score, details } or null if failed
 */
async function fetchCoinGeckoSentiment(coinName) {
  const coinId = COINGECKO_COIN_IDS.includes(coinName) ? coinName : 'bitcoin';

  try {
    const now = Date.now();

    // Serve from cache if still fresh
    if (coinGeckoCache.data && (now - coinGeckoCache.timestamp) < COINGECKO_CACHE_TTL) {
      const cached = coinGeckoCache.data[coinId];
      if (!cached) return null;
      return buildCoinGeckoResult(coinName, cached.usd_1h_change || 0, cached.usd_24h_change || 0);
    }

    // Deduplicate concurrent requests: share the same in-flight promise
    if (!coinGeckoCache.promise) {
      coinGeckoCache.promise = axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: COINGECKO_COIN_IDS.join(','),
          vs_currencies: 'usd',
          include_24hr_change: true,
          include_1hr_change: true
        },
        timeout: 5000
      }).then(response => {
        coinGeckoCache.data = response.data;
        coinGeckoCache.timestamp = Date.now();
        return response.data;
      }).finally(() => {
        coinGeckoCache.promise = null;
      });
    }

    const responseData = await coinGeckoCache.promise;
    const data = responseData[coinId];
    if (!data) return null;

    return buildCoinGeckoResult(coinName, data.usd_1h_change || 0, data.usd_24h_change || 0);
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
    
    // Layer 1: Try CryptoCompare news (primary)
    const articles = await fetchCryptoNews(coinName);
    
    if (articles && articles.length > 0) {
      const newsSentiment = analyzeCryptoNewsSentiment(articles);
      // Combine: 70% news headlines, 30% Fear & Greed
      const combinedScore = newsSentiment * NEWS_HEADLINE_WEIGHT + fearGreedScore * FEAR_GREED_PRIMARY_WEIGHT;
      
      return {
        score: combinedScore,
        details: {
          coin: coinName,
          source: 'cryptocompare',
          newsCount: articles.length,
          avgSentiment: newsSentiment,
          fearGreedIndex: fearGreed.value,
          fearGreedLabel: fearGreed.classification,
          recentHeadlines: articles.slice(0, 5).map(a => a.title)
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
