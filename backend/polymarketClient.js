const axios = require('axios');

class PolymarketClient {
  constructor(gammaApiUrl, clobApiUrl) {
    this.gammaApiUrl = gammaApiUrl || 'https://gamma-api.polymarket.com';
    this.clobApiUrl = clobApiUrl || 'https://clob.polymarket.com';
  }

  // Gamma API Methods
  async getEvents(params = {}) {
    try {
      const response = await axios.get(`${this.gammaApiUrl}/events`, { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching events:', error.message);
      throw error;
    }
  }

  // Calculate current 15-minute window timestamp
  getCurrentWindowTimestamp() {
    const now = Math.floor(Date.now() / 1000);
    return now - (now % 900); // Round down to nearest 15 min (900 seconds)
  }

  // Fetch market by slug
  async getMarketBySlug(slug) {
    try {
      const response = await axios.get(`${this.gammaApiUrl}/markets/slug/${slug}`);
      return response.data;
    } catch (error) {
      // 404 is expected when market doesn't exist yet
      if (error.response && error.response.status === 404) {
        return null;
      }
      console.error(`Error fetching market for slug ${slug}:`, error.message);
      return null;
    }
  }

  async get15MinuteCryptoMarkets() {
    try {
      const coins = ['btc', 'eth', 'sol', 'xrp'];
      const currentTs = this.getCurrentWindowTimestamp();
      const nextTs = currentTs + 900;
      
      const markets = [];
      
      for (const coin of coins) {
        // Try current window
        const currentSlug = `${coin}-updown-15m-${currentTs}`;
        const currentMarket = await this.getMarketBySlug(currentSlug);
        
        if (currentMarket) {
          const endDateMs = (currentTs + 900) * 1000; // Convert to milliseconds
          markets.push(this.formatMarket(currentMarket, coin.toUpperCase(), currentSlug, endDateMs));
        }
        
        // Try next window
        const nextSlug = `${coin}-updown-15m-${nextTs}`;
        const nextMarket = await this.getMarketBySlug(nextSlug);
        
        if (nextMarket) {
          const endDateMs = (nextTs + 900) * 1000; // Convert to milliseconds
          markets.push(this.formatMarket(nextMarket, coin.toUpperCase(), nextSlug, endDateMs));
        }
      }

      return markets;
    } catch (error) {
      console.error('Error fetching 15-minute crypto markets:', error.message);
      return [];
    }
  }

  // Format market data into consistent structure
  formatMarket(marketData, coin, slug, endDateMs) {
    // Handle both single object and array response formats
    const market = Array.isArray(marketData) ? marketData[0] : marketData;
    
    // Extract token IDs
    let yesTokenId = null;
    let noTokenId = null;
    
    if (market.clobTokenIds && Array.isArray(market.clobTokenIds)) {
      yesTokenId = market.clobTokenIds[0] || null;
      noTokenId = market.clobTokenIds[1] || null;
    }
    
    return {
      market_id: market.conditionId || market.id || market.market_id,
      question: market.question || '',
      coin: coin,
      slug: slug,
      end_date: endDateMs,
      yes_token_id: yesTokenId,
      no_token_id: noTokenId,
      active: market.active !== false,
      volume: parseFloat(market.volume || 0)
    };
  }

  // CLOB API Methods
  async getOrderBook(tokenId) {
    try {
      const response = await axios.get(`${this.clobApiUrl}/book`, {
        params: { token_id: tokenId }
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching order book for ${tokenId}:`, error.message);
      throw error;
    }
  }

  async getPrice(tokenId, side = 'BUY') {
    try {
      const response = await axios.get(`${this.clobApiUrl}/price`, {
        params: { token_id: tokenId, side }
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching price for ${tokenId}:`, error.message);
      throw error;
    }
  }

  async getMidpoint(tokenId) {
    try {
      const response = await axios.get(`${this.clobApiUrl}/midpoint`, {
        params: { token_id: tokenId }
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching midpoint for ${tokenId}:`, error.message);
      throw error;
    }
  }

  // Get market prices (YES and NO)
  async getMarketPrices(market) {
    try {
      // Check for new format (yes_token_id, no_token_id)
      const yesToken = market.yes_token_id;
      const noToken = market.no_token_id;

      if (!yesToken || !noToken) {
        // Fallback to old format if needed
        if (market.tokens && market.tokens.length >= 2) {
          const yesTokenOld = market.tokens[0]?.token_id;
          const noTokenOld = market.tokens[1]?.token_id;
          
          if (yesTokenOld && noTokenOld) {
            const [yesMidpoint, noMidpoint] = await Promise.all([
              this.getMidpoint(yesTokenOld).catch(() => ({ mid: '0' })),
              this.getMidpoint(noTokenOld).catch(() => ({ mid: '0' }))
            ]);

            return {
              yes_price: parseFloat(yesMidpoint.mid || 0),
              no_price: parseFloat(noMidpoint.mid || 0),
              yes_token: yesTokenOld,
              no_token: noTokenOld
            };
          }
        }
        return { yes_price: 0, no_price: 0 };
      }

      const [yesMidpoint, noMidpoint] = await Promise.all([
        this.getMidpoint(yesToken).catch(() => ({ mid: '0' })),
        this.getMidpoint(noToken).catch(() => ({ mid: '0' }))
      ]);

      return {
        yes_price: parseFloat(yesMidpoint.mid || 0),
        no_price: parseFloat(noMidpoint.mid || 0),
        yes_token: yesToken,
        no_token: noToken
      };
    } catch (error) {
      console.error('Error fetching market prices:', error.message);
      return { yes_price: 0, no_price: 0 };
    }
  }

  // Calculate time until market expiration
  getTimeUntilExpiration(endDate) {
    const now = new Date();
    const end = new Date(endDate);
    return Math.max(0, Math.floor((end - now) / 1000)); // seconds
  }

  // Check if market is within trading window
  isInTradingWindow(endDate, windowSeconds) {
    const timeLeft = this.getTimeUntilExpiration(endDate);
    // Must be at least 5 seconds before end AND within window
    return timeLeft > 5 && timeLeft <= windowSeconds;
  }
}

module.exports = PolymarketClient;
