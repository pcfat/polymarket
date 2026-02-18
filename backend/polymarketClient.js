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
      const prevTs = currentTs - 900;  // Also try previous window
      
      const markets = [];
      
      for (const coin of coins) {
        // Try previous, current, and next windows
        for (const ts of [prevTs, currentTs, nextTs]) {
          const slug = `${coin}-updown-15m-${ts}`;
          const market = await this.getMarketBySlug(slug);
          
          if (market) {
            const endDateMs = (ts + 900) * 1000;
            // Only include if not expired (endDate > now)
            if (endDateMs > Date.now()) {
              // Log debug info
              const marketData = Array.isArray(market) ? market[0] : market;
              console.log(`[DEBUG] Market found: ${slug}`);
              console.log(`[DEBUG] clobTokenIds: ${JSON.stringify(marketData.clobTokenIds || 'N/A')}`);
              console.log(`[DEBUG] outcomePrices: ${JSON.stringify(marketData.outcomePrices || 'N/A')}`);
              
              const formatted = this.formatMarket(market, coin.toUpperCase(), slug, endDateMs);
              // Avoid duplicates
              if (!markets.find(m => m.slug === slug)) {
                markets.push(formatted);
              }
            }
          }
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
    
    // Extract token IDs with multiple fallback paths
    let yesTokenId = null;
    let noTokenId = null;
    
    // Try clobTokenIds (could be array or JSON string)
    let tokenIds = market.clobTokenIds;
    if (typeof tokenIds === 'string') {
      try {
        tokenIds = JSON.parse(tokenIds);
      } catch(e) {
        tokenIds = null;
      }
    }
    
    if (Array.isArray(tokenIds) && tokenIds.length >= 2) {
      yesTokenId = tokenIds[0] || null;
      noTokenId = tokenIds[1] || null;
    }
    
    // Fallback: try tokens array
    if (!yesTokenId && market.tokens && Array.isArray(market.tokens) && market.tokens.length >= 2) {
      yesTokenId = market.tokens[0]?.token_id || null;
      noTokenId = market.tokens[1]?.token_id || null;
    }

    // Fallback: try side_a / side_b
    if (!yesTokenId && market.side_a && market.side_b) {
      yesTokenId = market.side_a.id || null;
      noTokenId = market.side_b.id || null;
    }
    
    // Extract outcome prices as fallback for when CLOB API fails
    let outcomePrices = market.outcomePrices;
    if (typeof outcomePrices === 'string') {
      try {
        outcomePrices = JSON.parse(outcomePrices);
      } catch(e) {
        outcomePrices = null;
      }
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
      volume: parseFloat(market.volume || 0),
      // Include fallback prices from Gamma API
      fallback_yes_price: Array.isArray(outcomePrices) && outcomePrices.length >= 1 ? parseFloat(outcomePrices[0]) : null,
      fallback_no_price: Array.isArray(outcomePrices) && outcomePrices.length >= 2 ? parseFloat(outcomePrices[1]) : null
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
      const yesToken = market.yes_token_id;
      const noToken = market.no_token_id;

      if (yesToken && noToken) {
        const [yesMidpoint, noMidpoint] = await Promise.all([
          this.getMidpoint(yesToken).catch(() => ({ mid: '0' })),
          this.getMidpoint(noToken).catch(() => ({ mid: '0' }))
        ]);

        const yesPrice = parseFloat(yesMidpoint.mid || 0);
        const noPrice = parseFloat(noMidpoint.mid || 0);

        // If CLOB prices are valid (non-zero), use them
        if (yesPrice > 0 || noPrice > 0) {
          return {
            yes_price: yesPrice,
            no_price: noPrice,
            yes_token: yesToken,
            no_token: noToken
          };
        }
      }

      // Fallback: use prices from Gamma API (outcomePrices)
      if (market.fallback_yes_price !== null && market.fallback_yes_price !== undefined) {
        return {
          yes_price: market.fallback_yes_price || 0,
          no_price: market.fallback_no_price || 0,
          yes_token: yesToken,
          no_token: noToken
        };
      }

      return { yes_price: 0, no_price: 0, yes_token: yesToken, no_token: noToken };
    } catch (error) {
      console.error('Error fetching market prices:', error.message);
      // Final fallback
      return {
        yes_price: market.fallback_yes_price || 0,
        no_price: market.fallback_no_price || 0,
        yes_token: market.yes_token_id,
        no_token: market.no_token_id
      };
    }
  }

  // Calculate time until market expiration
  getTimeUntilExpiration(endDate) {
    const now = new Date();
    const end = new Date(endDate);
    return Math.max(0, Math.floor((end - now) / 1000)); // seconds
  }

  // Check if market is within trading window
  // Minimum 5-second buffer to avoid race conditions with market expiration
  isInTradingWindow(endDate, windowSeconds) {
    const MIN_TRADING_BUFFER_SECONDS = 5;
    const timeLeft = this.getTimeUntilExpiration(endDate);
    // Must be at least MIN_TRADING_BUFFER_SECONDS before end AND within window
    return timeLeft > MIN_TRADING_BUFFER_SECONDS && timeLeft <= windowSeconds;
  }
}

module.exports = PolymarketClient;
