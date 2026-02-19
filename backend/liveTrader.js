'use strict';

/**
 * liveTrader.js — Live trading module for Polymarket CLOB API integration.
 *
 * Wraps @polymarket/clob-client to submit Fill-Or-Kill market orders.
 * Safety guards:
 *  - MAX_LIVE_TRADE_AMOUNT cap (env: MAX_LIVE_TRADE_AMOUNT, default $50)
 *  - First-trade warning logged to console
 *  - All errors caught and returned as structured results; never throws
 */

const { ClobClient, Side, OrderType } = require('@polymarket/clob-client');
const { Wallet } = require('ethers');

const DEFAULT_MAX_LIVE_TRADE_AMOUNT = 50;

class LiveTrader {
  constructor() {
    this.clobClient = null;
    this.initialized = false;
    this.initError = null;
    this.firstTrade = true;
    this.maxTradeAmount = parseFloat(process.env.MAX_LIVE_TRADE_AMOUNT) || DEFAULT_MAX_LIVE_TRADE_AMOUNT;
  }

  /**
   * Lazy-initialize the ClobClient and derive API credentials.
   * Returns true on success, false on failure.
   */
  async initialize() {
    if (this.initialized) return true;
    if (this.initError) return false;

    try {
      const privateKey = process.env.WALLET_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('WALLET_PRIVATE_KEY environment variable is not set');
      }

      const chainId = parseInt(process.env.CHAIN_ID) || 137;
      const clobApiUrl = process.env.CLOB_API_URL || 'https://clob.polymarket.com';
      const signatureType = parseInt(process.env.SIGNATURE_TYPE) || 0;
      const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS || undefined;

      const wallet = new Wallet(privateKey);

      // Create a temporary client without creds to derive/create API key
      const tempClient = new ClobClient(
        clobApiUrl,
        chainId,
        wallet,
        undefined,
        signatureType,
        funderAddress
      );

      const creds = await tempClient.createOrDeriveApiKey();

      // Create the final client with credentials
      this.clobClient = new ClobClient(
        clobApiUrl,
        chainId,
        wallet,
        creds,
        signatureType,
        funderAddress
      );

      this.initialized = true;
      console.log('✅ LiveTrader: CLOB client initialized successfully');
      return true;
    } catch (error) {
      this.initError = error.message;
      console.error('❌ LiveTrader: Failed to initialize CLOB client:', error.message);
      return false;
    }
  }

  /**
   * Place a Fill-Or-Kill buy order on the CLOB.
   *
   * @param {Object} params
   * @param {string} params.tokenId  - CLOB token ID for the outcome
   * @param {number} params.price    - Current market price for the outcome (0–1)
   * @param {number} params.size     - Number of shares (tradeAmount / price)
   * @param {string} params.side     - 'BUY' (currently only BUY is supported)
   * @returns {Promise<{success: boolean, orderID?: string, errorMsg?: string}>}
   */
  async placeOrder({ tokenId, price, size, side }) {
    try {
      // Safety guard: cap trade size in dollar terms (size * price = dollars spent)
      const dollarAmount = size * price;
      if (dollarAmount > this.maxTradeAmount) {
        return {
          success: false,
          errorMsg: `Trade amount $${dollarAmount.toFixed(2)} exceeds MAX_LIVE_TRADE_AMOUNT $${this.maxTradeAmount}`
        };
      }

      // Warn on first live trade
      if (this.firstTrade) {
        console.warn('⚠️  LiveTrader: REAL MONEY IS AT RISK. Submitting first live order to Polymarket CLOB.');
        this.firstTrade = false;
      }

      // Lazy-initialize
      const ready = await this.initialize();
      if (!ready) {
        return {
          success: false,
          errorMsg: `LiveTrader initialization failed: ${this.initError}`
        };
      }

      const clobSide = Side.BUY;
      if (side !== 'BUY') {
        return { success: false, errorMsg: `Unsupported order side: ${side}. Only BUY is supported.` };
      }

      const response = await this.clobClient.createAndPostOrder(
        {
          tokenID: tokenId,
          price,
          side: clobSide,
          size
        },
        { tickSize: '0.01', negRisk: false },
        OrderType.FOK
      );

      if (response && response.success) {
        console.log(`✅ LiveTrader: Order placed successfully. orderID=${response.orderID}`);
        return { success: true, orderID: response.orderID };
      }

      const errMsg = (response && response.errorMsg) ? response.errorMsg : 'Unknown CLOB error';
      console.error('❌ LiveTrader: Order failed:', errMsg);
      return { success: false, errorMsg: errMsg };
    } catch (error) {
      console.error('❌ LiveTrader: Exception placing order:', error.message);
      return { success: false, errorMsg: error.message };
    }
  }
}

module.exports = new LiveTrader();
