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

  async get15MinuteCryptoMarkets() {
    try {
      const events = await this.getEvents({ 
        tag: 'crypto', 
        active: true, 
        closed: false 
      });

      // Filter for 15-minute markets
      const fifteenMinMarkets = [];
      
      for (const event of events) {
        if (event.markets && Array.isArray(event.markets)) {
          for (const market of event.markets) {
            const question = market.question || '';
            // Check if market question contains "15" (for 15 minutes)
            if (question.includes('15') || question.includes('15分') || question.includes('15M')) {
              fifteenMinMarkets.push({
                event_id: event.id,
                market_id: market.condition_id || market.id,
                question: question,
                end_date: market.end_date_iso || event.end_date_iso,
                tokens: market.tokens || [],
                volume: market.volume || 0,
                liquidity: market.liquidity || 0,
                active: market.active !== false
              });
            }
          }
        }
      }

      return fifteenMinMarkets;
    } catch (error) {
      console.error('Error fetching 15-minute crypto markets:', error.message);
      return [];
    }
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
      if (!market.tokens || market.tokens.length < 2) {
        return { yes_price: 0, no_price: 0 };
      }

      // Tokens are typically [YES, NO]
      const yesToken = market.tokens[0]?.token_id;
      const noToken = market.tokens[1]?.token_id;

      if (!yesToken || !noToken) {
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
    return timeLeft > 0 && timeLeft <= windowSeconds;
  }
}

module.exports = PolymarketClient;
