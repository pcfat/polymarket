    def evaluate_coin(self, coin: str, market_up: float = None, market_down: float = None) -> TradeSignal:
        symbol = self.get_symbol(coin)
        prices = self.feed.get_prices_array(coin)

        if len(prices) < self.min_data_seconds:
            return TradeSignal(
                Signal.NO_TRADE, "waiting", 0,
                f"Need {self.min_data_seconds}s, have {len(prices)}s",
                datetime.now(), symbol, 0.5, 0
            )

        our_prob_up, scores, explanation = self.estimate_up_probability(coin)
        our_prob_down = 1 - our_prob_up
        up_count, down_count, neutral = self.count_signal_agreement(scores)

        if market_up is None or market_down is None:
            return TradeSignal(Signal.NO_TRADE, "no_mkt", 0,
                f"No market data | {explanation}",
                datetime.now(), symbol, our_prob_up, 0)

        # ===== v6: FOLLOW THE MARKET, BUY CHEAP SIDE =====
        # Data proves: market direction is usually correct
        # Strategy: buy the cheap side ONLY when market agrees with our signals
        # This means: if market says DOWN (DOWN is expensive, UP is cheap)
        #   → we want to buy DOWN (the EXPENSIVE side? NO!)
        #   → actually: if DOWN is winning, DOWN token = expensive
        #   → the CHEAP side = UP token (the losing side)
        #   → but buying the losing side = losing money!
        #
        # CORRECTION from data:
        #   BUY_NO @3¢ wins = market says UP (UP expensive), DOWN is cheap, we buy DOWN, it wins
        #   That means market was WRONG about UP, and DOWN actually won
        #
        # WAIT - let me re-read the data:
        #   ETH BUY_NO buy@0.030 = DOWN token costs 3¢ = market thinks 97% UP
        #   Result: WIN = DOWN actually happened = market was WRONG
        #
        # So the winning strategy is:
        #   When market is VERY confident one direction (>70%),
        #   buy the OPPOSITE cheap side with our signal confirmation
        #   = contrarian at extremes!

        market_favors_up = market_up > market_down
        market_confidence = max(market_up, market_down)

        # Only trade when market is confident (one side > 60%)
        # and we buy the CHEAP opposite side
        if market_confidence < 0.55:
            return TradeSignal(Signal.NO_TRADE, "mkt_unsure", 0,
                f"Market too close to 50/50 (↑{market_up:.0%}↓{market_down:.0%}) | {explanation}",
                datetime.now(), symbol, our_prob_up, 0)

        cheap_price = min(market_up, market_down)
        cheap_is_up = market_up < market_down  # UP is cheap when market favors DOWN

        # === BUY cheap DOWN (market favors UP, DOWN is cheap) ===
        if not cheap_is_up:  # market favors UP, DOWN is cheap
            buy_price = market_down

            if buy_price >= 0.48:
                return TradeSignal(Signal.NO_TRADE, "dn_not_cheap", 0,
                    f"DOWN@{buy_price:.0%} not cheap enough | {explanation}",
                    datetime.now(), symbol, our_prob_up, 0)

            # Need our signals to also lean DOWN
            if our_prob_down > 0.55 and down_count >= 3:
                edge = our_prob_down - market_down
                ev = our_prob_down * (1 - buy_price) / buy_price - our_prob_up if buy_price > 0 else -1
                potential = 10 * (1 - buy_price) / buy_price

                if edge > self.min_edge_no and ev > 0:
                    return TradeSignal(Signal.BUY_NO, f"value_dn({explanation})",
                        min(edge, 1.0),
                        f"Mkt↑{market_up:.0%} but DN cheap@{buy_price:.0%} "
                        f"P(dn)={our_prob_down:.1%} [↓{down_count}sig] | "
                        f"Edge={edge:+.1%} Win:+${potential:.0f}",
                        datetime.now(), symbol, our_prob_up, edge)

            # Even without strong DOWN signals, if DOWN is very cheap (<20%) buy it
            if buy_price <= 0.20 and down_count >= 2:
                potential = 10 * (1 - buy_price) / buy_price
                edge = 0.50 - buy_price  # assume at least 50% real chance
                return TradeSignal(Signal.BUY_NO, f"deep_dn({explanation})",
                    min(edge, 1.0),
                    f"DN super cheap@{buy_price:.0%} [↓{down_count}sig] | Win:+${potential:.0f}",
                    datetime.now(), symbol, our_prob_up, edge)

        # === BUY cheap UP (market favors DOWN, UP is cheap) ===
        if cheap_is_up:  # market favors DOWN, UP is cheap
            buy_price = market_up

            if buy_price >= 0.48:
                return TradeSignal(Signal.NO_TRADE, "up_not_cheap", 0,
                    f"UP@{buy_price:.0%} not cheap enough | {explanation}",
                    datetime.now(), symbol, our_prob_up, 0)

            # Need our signals to also lean UP
            if our_prob_up > 0.55 and up_count >= 3:
                edge = our_prob_up - market_up
                ev = our_prob_up * (1 - buy_price) / buy_price - our_prob_down if buy_price > 0 else -1
                potential = 10 * (1 - buy_price) / buy_price

                if edge > self.min_edge_yes and ev > 0:
                    return TradeSignal(Signal.BUY_YES, f"value_up({explanation})",
                        min(edge, 1.0),
                        f"Mkt↓{market_down:.0%} but UP cheap@{buy_price:.0%} "
                        f"P(up)={our_prob_up:.1%} [↑{up_count}sig] | "
                        f"Edge={edge:+.1%} Win:+${potential:.0f}",
                        datetime.now(), symbol, our_prob_up, edge)

            # Very cheap UP (<20%)
            if buy_price <= 0.20 and up_count >= 2:
                potential = 10 * (1 - buy_price) / buy_price
                edge = 0.50 - buy_price
                return TradeSignal(Signal.BUY_YES, f"deep_up({explanation})",
                    min(edge, 1.0),
                    f"UP super cheap@{buy_price:.0%} [↑{up_count}sig] | Win:+${potential:.0f}",
                    datetime.now(), symbol, our_prob_up, edge)

        # No trade
        return TradeSignal(Signal.NO_TRADE, "no_edge", 0,
            f"P(up)={our_prob_up:.1%} [↑{up_count}/↓{down_count}] "
            f"Mkt:↑{market_up:.0%}↓{market_down:.0%} | {explanation}",
            datetime.now(), symbol, our_prob_up, 0)