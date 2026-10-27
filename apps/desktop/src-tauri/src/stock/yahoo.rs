//! The one `PriceProvider` implementation: Yahoo Finance's unofficial endpoints.
//!
//! Two endpoints only, both verified to need NO cookie and NO crumb (architecture, Yahoo Probe
//! Findings 2026-10-26): `/v8/finance/chart/{symbol}` for a price and `/v1/finance/search` for a
//! lookup. `/v7/finance/quote` is deliberately not used — it is the one that needs a crumb.
//!
//! Yahoo throttles by TLS fingerprint rather than by IP: plain `curl` gets HTTP 429 where the app's
//! own rustls stack with a browser User-Agent gets 200. That is why the User-Agent below is not
//! cosmetic, and why `live_yahoo_smoke` exists to detect the day it stops being enough.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use serde::Deserialize;

use crate::error::AppError;
use crate::models::StockSearchResult;
use crate::stock::provider::{PriceProvider, ProviderFuture, Quote, MIN_SEARCH_CHARS};

const BASE: &str = "https://query1.finance.yahoo.com";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const ATTEMPTS: u32 = 2;

/// Waited once before the single retry. Retrying instantly re-uses the same dead socket or hits the
/// same mid-deploy 502, so the pause is the only thing that makes a second attempt different.
const RETRY_BACKOFF: Duration = Duration::from_millis(500);

/// ONE client for the process, so every refresh shares one connection pool and one TLS session
/// cache. A client per call re-handshakes per symbol, which is both slower and a louder, more
/// distinctive pattern to the thing that rate-limits by client fingerprint.
static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

fn shared_client() -> Result<reqwest::Client, AppError> {
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .timeout(REQUEST_TIMEOUT)
                .build()
                .map_err(|error| error.to_string())
        })
        .clone()
        .map_err(|message| AppError::MarketData {
            message: format!("Could not start the price client: {message}"),
        })
}

/// Yahoo answers a non-browser TLS/User-Agent pair with HTTP 429, so this is load-bearing.
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/// The security kinds a personal portfolio can hold. Anything else Yahoo returns — an index, a
/// futures contract, a currency pair — is not something `create_stock_asset` can price.
const SEARCHABLE_QUOTE_TYPES: &[&str] = &["EQUITY", "ETF", "MUTUALFUND"];

#[derive(Debug, Deserialize)]
struct ChartResponse {
    chart: ChartEnvelope,
}

#[derive(Debug, Deserialize)]
struct ChartEnvelope {
    #[serde(default)]
    result: Vec<ChartResult>,
}

#[derive(Debug, Deserialize)]
struct ChartResult {
    meta: ChartMeta,
}

#[derive(Debug, Deserialize)]
struct ChartMeta {
    #[serde(default, rename = "regularMarketPrice")]
    regular_market_price: Option<f64>,
    #[serde(default)]
    currency: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    quotes: Vec<SearchQuote>,
}

#[derive(Debug, Deserialize)]
struct SearchQuote {
    #[serde(default)]
    symbol: Option<String>,
    #[serde(default)]
    shortname: Option<String>,
    #[serde(default)]
    longname: Option<String>,
    #[serde(default, rename = "exchDisp")]
    exchange_display: Option<String>,
    #[serde(default)]
    exchange: Option<String>,
    #[serde(default, rename = "quoteType")]
    quote_type: Option<String>,
}

pub struct YahooProvider {
    client: reqwest::Client,
}

impl YahooProvider {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self {
            client: shared_client()?,
        })
    }

    /// One retry and no more, and NONE on 429.
    ///
    /// The failures worth retrying are a dropped connection and a transient 5xx, both of which
    /// clear on the second try or not at all. 429 is the opposite: Yahoo has just said it is
    /// serving too many requests from this client, and retrying is how a throttle becomes a ban.
    async fn fetch(&self, url: &str) -> Result<String, AppError> {
        let mut last = String::new();

        for attempt in 1..=ATTEMPTS {
            match self.client.get(url).send().await {
                Ok(response) if response.status().is_success() => {
                    return response.text().await.map_err(|error| AppError::MarketData {
                        message: format!("Price response could not be read: {error}"),
                    })
                }
                Ok(response) => {
                    let status = response.status();
                    last = format!("HTTP {status}");
                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        tracing::warn!("Yahoo is throttling this client; not retrying ({last})");
                        break;
                    }
                }
                Err(error) => last = error.to_string(),
            }

            tracing::warn!("Yahoo request attempt {attempt}/{ATTEMPTS} failed: {last}");

            if attempt < ATTEMPTS {
                tokio::time::sleep(RETRY_BACKOFF).await;
            }
        }

        Err(AppError::MarketData {
            message: format!("The price service could not be reached ({last})"),
        })
    }

    /// `range`/`interval` are sent explicitly: without them Yahoo picks a default window and
    /// returns a far larger candle series than `meta` needs, for every symbol of every refresh.
    async fn chart(&self, symbol: &str) -> Result<Option<Quote>, AppError> {
        let url = format!(
            "{BASE}/v8/finance/chart/{}?range=1d&interval=1d",
            urlencoding::encode(symbol)
        );
        let body = self.fetch(&url).await?;

        Ok(parse_chart(&body))
    }

    async fn search_symbols(&self, query: &str) -> Result<Vec<StockSearchResult>, AppError> {
        let url = format!("{BASE}/v1/finance/search?q={}", urlencoding::encode(query));
        let body = self.fetch(&url).await?;

        Ok(parse_search(&body))
    }
}

/// `None` when the payload is well-formed but holds no usable price — a delisted symbol, or one
/// Yahoo answers with an empty `result` array.
fn parse_chart(body: &str) -> Option<Quote> {
    let response: ChartResponse = serde_json::from_str(body).ok()?;
    let meta = response.chart.result.into_iter().next()?.meta;

    Quote::from_parts(meta.currency.as_deref()?, meta.regular_market_price?)
}

fn parse_search(body: &str) -> Vec<StockSearchResult> {
    let Ok(response) = serde_json::from_str::<SearchResponse>(body) else {
        return Vec::new();
    };

    response
        .quotes
        .into_iter()
        .filter_map(|quote| {
            let quote_type = quote.quote_type.unwrap_or_default();
            if !SEARCHABLE_QUOTE_TYPES.contains(&quote_type.to_ascii_uppercase().as_str()) {
                return None;
            }

            let symbol = quote.symbol?.trim().to_ascii_uppercase();
            if symbol.is_empty() {
                return None;
            }

            let name = quote
                .shortname
                .or(quote.longname)
                .unwrap_or_else(|| symbol.clone());

            Some(StockSearchResult {
                exchange: quote
                    .exchange_display
                    .or(quote.exchange)
                    .unwrap_or_default(),
                symbol,
                name,
            })
        })
        .collect()
}

impl PriceProvider for YahooProvider {
    fn search<'a>(&'a self, query: &'a str) -> ProviderFuture<'a, Vec<StockSearchResult>> {
        Box::pin(async move {
            if query.trim().chars().count() < MIN_SEARCH_CHARS {
                return Ok(Vec::new());
            }

            self.search_symbols(query.trim()).await
        })
    }

    /// One request per symbol, because the batched `/v7/finance/quote` is the endpoint that needs a
    /// crumb. A failed symbol is logged and omitted so the others still price.
    fn quote<'a>(&'a self, symbols: &'a [String]) -> ProviderFuture<'a, HashMap<String, Quote>> {
        Box::pin(async move {
            let mut quotes = HashMap::new();

            for symbol in symbols {
                match self.chart(symbol).await {
                    Ok(Some(quote)) => {
                        quotes.insert(symbol.clone(), quote);
                    }
                    Ok(None) => tracing::warn!("Yahoo returned no usable price for {symbol}"),
                    Err(error) => tracing::warn!("Yahoo price fetch failed for {symbol}: {error}"),
                }
            }

            Ok(quotes)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHART_BODY: &str = r#"{
        "chart": {
            "result": [
                {
                    "meta": {
                        "currency": "CAD",
                        "symbol": "SHOP.TO",
                        "exchangeName": "TOR",
                        "regularMarketPrice": 123.45
                    }
                }
            ],
            "error": null
        }
    }"#;

    const SEARCH_BODY: &str = r#"{
        "explains": [],
        "count": 3,
        "quotes": [
            {
                "exchange": "TOR",
                "shortname": "Shopify Inc.",
                "quoteType": "EQUITY",
                "symbol": "SHOP.TO",
                "longname": "Shopify Inc.",
                "exchDisp": "Toronto"
            },
            {
                "exchange": "NYQ",
                "shortname": "SPDR S&P 500",
                "quoteType": "ETF",
                "symbol": "spy",
                "exchDisp": "NYSEArca"
            },
            {
                "exchange": "CCY",
                "shortname": "USD/CAD",
                "quoteType": "CURRENCY",
                "symbol": "USDCAD=X"
            }
        ]
    }"#;

    #[test]
    fn a_chart_payload_yields_the_regular_market_price_and_its_currency() {
        let quote = parse_chart(CHART_BODY).expect("a usable quote");

        assert_eq!(quote.currency, "CAD");
        assert_eq!(quote.price_cents(), 12_345);
    }

    #[test]
    fn a_pence_chart_payload_is_normalised_to_pounds() {
        let body = CHART_BODY
            .replace("\"CAD\"", "\"GBp\"")
            .replace("123.45", "7250.0");

        let quote = parse_chart(&body).expect("a usable quote");

        assert_eq!((quote.currency.as_str(), quote.price_cents()), ("GBP", 7_250));
    }

    #[test]
    fn a_chart_payload_with_no_price_no_currency_or_no_result_yields_nothing() {
        assert!(parse_chart(r#"{"chart":{"result":[],"error":null}}"#).is_none());
        assert!(parse_chart(r#"{"chart":{"result":[{"meta":{"currency":"CAD"}}]}}"#).is_none());
        assert!(
            parse_chart(r#"{"chart":{"result":[{"meta":{"regularMarketPrice":1.0}}]}}"#).is_none()
        );
        assert!(parse_chart("not json at all").is_none());
    }

    #[test]
    fn a_search_payload_keeps_tradable_kinds_uppercases_symbols_and_drops_currency_pairs() {
        let results = parse_search(SEARCH_BODY);

        assert_eq!(
            results
                .iter()
                .map(|result| result.symbol.as_str())
                .collect::<Vec<_>>(),
            vec!["SHOP.TO", "SPY"],
            "a CURRENCY row is not something a portfolio holds"
        );
        assert_eq!(results[0].name, "Shopify Inc.");
        assert_eq!(results[0].exchange, "Toronto");
    }

    #[test]
    fn a_malformed_search_payload_is_an_empty_list_rather_than_a_failure() {
        assert!(parse_search("}{").is_empty());
        assert!(parse_search(r#"{"quotes":[]}"#).is_empty());
    }

    #[tokio::test]
    async fn a_search_under_two_characters_never_reaches_the_network() {
        let provider = YahooProvider::new().expect("a client builds");

        assert!(provider.search("a").await.expect("no request is made").is_empty());
        assert!(provider.search("  ").await.expect("no request is made").is_empty());
    }

    /// The canary for the whole provider: Yahoo is unofficial, and the day its fingerprinting
    /// changes this is what says so. Ignored by default because it needs the network.
    ///
    /// `cargo test stock -- --ignored`
    #[tokio::test]
    #[ignore = "hits the live Yahoo API"]
    async fn live_yahoo_smoke_prices_a_canadian_and_an_american_symbol() {
        let provider = YahooProvider::new().expect("a client builds");
        let symbols = vec!["SHOP.TO".to_string(), "AAPL".to_string()];

        let quotes = provider.quote(&symbols).await.expect("the call completes");

        for symbol in &symbols {
            let quote = quotes
                .get(symbol)
                .unwrap_or_else(|| panic!("Yahoo returned no price for {symbol}"));
            assert!(quote.price_cents() > 0, "{symbol} priced at zero");
            assert_eq!(quote.currency.len(), 3, "{symbol} has no ISO currency");
        }

        let fx = crate::stock::provider::fx_symbol("USD", "CAD");
        let rates = provider.quote(std::slice::from_ref(&fx)).await.expect("the FX call completes");
        assert!(
            rates.get(&fx).is_some_and(|rate| rate.price_micros > 0),
            "the USDCAD=X pair must price through the same endpoint"
        );
    }
}
