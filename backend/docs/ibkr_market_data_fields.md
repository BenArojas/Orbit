# IBKR Client Portal — Market Data Fields Reference

Source: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/#market-data-fields

Endpoint: `GET /iserver/marketdata/snapshot?conids=...&fields=...`

All return values are STRINGS. Parse to float/int at the caller with `_safe_float` or similar.

> **Important finding (2026-04-23):** the field code `7289` we had been using for market cap
> does **not** appear on the official fields list below. That is why our snapshot poll timed
> out waiting for it — IBKR never sends it via this endpoint. Market cap is not available
> through `/iserver/marketdata/snapshot`. Use a different endpoint (e.g. `/trsrv/secdef`,
> `/fundamental/summary/{conid}`) or drop the column entirely. See the Phase 5C screener
> change that removed market cap from the scan pipeline.

---

## Fields

| Field | Type | Name | Description |
|------:|------|------|-------------|
| 31 | string | Last Price | The last price at which the contract traded. May contain one of the following prefixes: C – Previous day's closing price. H – Trading has halted. |
| 55 | string | Symbol | |
| 58 | string | Text | |
| 70 | string | High | Current day high price |
| 71 | string | Low | Current day low price |
| 73 | string | Market Value | Current market value of your position in the security. Calculated with real time market data (even when not subscribed). |
| 74 | string | Avg Price | The average price of the position. |
| 75 | string | Unrealized PnL | Unrealized profit or loss. |
| 76 | string | Formatted position | |
| 77 | string | Formatted Unrealized PnL | |
| 78 | string | Daily PnL | Profit/loss of the day since prior close. |
| 79 | string | Realized PnL | |
| 80 | string | Unrealized PnL % | |
| 82 | string | Change | Difference between last price and prior close. |
| 83 | string | Change % | Difference between last price and prior close, in percentage. |
| 84 | string | Bid Price | Highest-priced bid on the contract. |
| 85 | string | Ask Size | Number of contracts/shares offered at the ask price. |
| 86 | string | Ask Price | Lowest-priced offer on the contract. |
| 87 | string | Volume | Volume for the day, formatted with 'K'/'M'. For higher precision refer to field 7762. |
| 88 | string | Bid Size | Number of contracts/shares bid for at the bid price. |
| 201 | string | Right | P for Put, C for Call. |
| 6004 | string | Exchange | |
| 6008 | integer | Conid | Contract identifier from IBKR's database. |
| 6070 | string | SecType | Asset class of the instrument. |
| 6072 | string | Months | |
| 6073 | string | Regular Expiry | |
| 6119 | string | Marker for market data delivery method (similar to request id). | |
| 6457 | integer | Underlying Conid | Use `/trsrv/secdef` for more info. |
| 6508 | string | Service Params | |
| 6509 | string | Market Data Availability | 3-char code. 1st: R=RealTime, D=Delayed, Z=Frozen, Y=FrozenDelayed, N=NotSubscribed, i=incomplete, v=VDR Exempt. 2nd: P=Snapshot, p=Consolidated. 3rd: B=Book. |
| 7051 | string | Company name | |
| 7057 | string | Ask Exch | Exchange offering SMART price. A=AMEX, C=CBOE, I=ISE, X=PHLX, N=PSE, B=BOX, Q=NASDAQOM, Z=BATS, W=CBOE2, T=NASDAQBX, M=MIAX, H=GEMINI, E=EDGX, J=MERCURY |
| 7058 | string | Last Exch | Same code map as 7057. |
| 7059 | string | Last Size | Units traded at the last price. |
| 7068 | string | Bid Exch | Same code map as 7057. |
| 7084 | string | Implied Vol./Hist. Vol % | Ratio of implied vol over historical vol, in percent. |
| 7085 | string | Put/Call Interest | Put OI / call OI for the trading day. Underlyings only. |
| 7086 | string | Put/Call Volume | Put volume / call volume for the trading day. |
| 7087 | string | Hist. Vol. % | 30-day real-time historical volatility. |
| 7088 | string | Hist. Vol. Close % | Based on previous close price. |
| 7089 | string | Opt. Volume | Option volume. |
| 7094 | string | Conid + Exchange | |
| 7184 | string | canBeTraded | 1/0. |
| 7219 | string | Contract Description | |
| 7220 | string | Contract Description | |
| 7221 | string | Listing Exchange | |
| 7280 | string | Industry | |
| 7281 | string | Category | More detailed than Industry. |
| 7282 | string | Average Volume | 90-day average daily trading volume. |
| 7283 | string | Option Implied Vol. % | At-the-money 30-day forward, from 2 consecutive expiries. For specific strikes see 7633. |
| 7284 | string | Historical volatility % | Deprecated — see 7087. |
| 7285 | string | Put/Call Ratio | |
| 7292 | string | Cost Basis | Position × avg price × multiplier. |
| 7293 | string | 52 Week High | |
| 7294 | string | 52 Week Low | |
| 7295 | string | Open | Today's opening price. |
| 7296 | string | Close | Today's closing price. |
| 7308 | string | Delta | |
| 7309 | string | Gamma | |
| 7310 | string | Theta | |
| 7311 | string | Vega | |
| 7607 | string | Opt. Volume Change % | Today's option volume as a % of average. |
| 7633 | string | Implied Vol. % | For specific option strike. From underlying use 7283. |
| 7635 | string | Mark | Ask if ask<last, bid if bid>last, else last. |
| 7636 | string | Shortable Shares | |
| 7637 | string | Fee Rate | Interest on borrowed shares. |
| 7638 | string | Option Open Interest | Underlyings and C&P options. |
| 7639 | string | % of Mark Value | Contract market value / total account market value. |
| 7644 | string | Shortable | Difficulty level. |
| 7671 | string | Dividends | Expected total of next 12 months per share. |
| 7672 | string | Dividends TTM | Total of last 12 months per share. |
| 7674 | string | EMA(200) | |
| 7675 | string | EMA(100) | |
| 7676 | string | EMA(50) | |
| 7677 | string | EMA(20) | |
| 7678 | string | Price/EMA(200) | (ratio - 1), in percent. |
| 7679 | string | Price/EMA(100) | |
| 7724 | string | Price/EMA(50) | |
| 7681 | string | Price/EMA(20) | |
| 7682 | string | Change Since Open | |
| 7683 | string | Upcoming Event | Wall Street Horizon sub required. |
| 7684 | string | Upcoming Event Date | WSH sub. |
| 7685 | string | Upcoming Analyst Meeting | WSH sub. |
| 7686 | string | Upcoming Earnings | WSH sub. |
| 7687 | string | Upcoming Misc Event | WSH sub. |
| 7688 | string | Recent Analyst Meeting | WSH sub. |
| 7689 | string | Recent Earnings | WSH sub. |
| 7690 | string | Recent Misc Event | WSH sub. |
| 7694 | string | Probability of Max Return | Customer implied. |
| 7695 | string | Break Even | |
| 7696 | string | SPX Delta | Beta-weighted delta. |
| 7697 | string | Futures Open Interest | |
| 7698 | string | Last Yield | Bond yield to worst using last price. |
| 7699 | string | Bid Yield | Bond yield to worst using bid. |
| 7700 | string | Probability of Max Return | |
| 7702 | string | Probability of Max Loss | |
| 7703 | string | Profit Probability | |
| 7704 | string | Organization Type | |
| 7705 | string | Debt Class | |
| 7706 | string | Ratings | Bond ratings. |
| 7707 | string | Bond State Code | |
| 7708 | string | Bond Type | |
| 7714 | string | Last Trading Date | |
| 7715 | string | Issue Date | |
| 7720 | string | Ask Yield | |
| 7741 | string | Prior Close | Yesterday's close. |
| 7762 | string | Volume Long | High-precision volume. Unformatted version of 87. |
| 7768 | string | hasTradingPermissions | 1/0. |
| 7920 | string | Daily PnL Raw | |
| 7921 | string | Cost Basis Raw | |

---

## Field groups we actually use in Parallax

### Screener snapshot (Phase 5C)
- `31` last price
- `55` symbol
- `83` change %
- `7762` volume (high precision)
- `7051` company name (optional)

### Chart / analysis view
- `31`, `55`, `70` high, `71` low, `7295` open, `7741` prior close, `7293`/`7294` 52w hi/lo
- `7674–7677` EMA series for indicator overlays
