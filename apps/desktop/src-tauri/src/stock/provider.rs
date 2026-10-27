//! The market-data boundary: what a price provider must answer, in the units the database stores.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use crate::error::AppError;
use crate::models::StockSearchResult;

/// Below this, a search is noise rather than a query, and Yahoo answers it with thousands of hits.
pub const MIN_SEARCH_CHARS: usize = 2;

const MICROS_PER_UNIT: i64 = 1_000_000;
const MICROS_PER_CENT: i64 = 10_000;

/// One quote, in the one scaled-integer representation that serves both a share price and an FX
/// rate — which is what lets `{CCY}{BASE}=X` be fetched through the same call as `AAPL`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quote {
    pub price_micros: i64,
    pub currency: String,
}

impl Quote {
    /// The provider's own number, rounded ONCE into the minor units the column holds.
    ///
    /// Rounding here rather than at the value derivation is deliberate: `last_price_cents` is what
    /// the UI shows as "the price", so the number on screen has to be the number that was stored.
    pub fn price_cents(&self) -> i64 {
        round_div(self.price_micros, MICROS_PER_CENT)
    }

    /// Builds a quote from a provider's raw decimal, normalising a minor-unit quote currency.
    ///
    /// `f64` is the wire type — Yahoo sends a JSON number — and it is converted to scaled integers
    /// here, at the boundary, so no float ever reaches a column.
    ///
    /// A price of ZERO is refused along with a negative or non-finite one. Yahoo reports 0 for a
    /// halted ticker and for some malformed payloads, and accepting it would overwrite a good
    /// cached price with "this holding is worth nothing" — strictly worse than reporting the symbol
    /// as failed and leaving the cached triple alone. The schema's `>= 0` stays as a floor for a
    /// price that was never set.
    pub fn from_parts(currency: &str, price: f64) -> Option<Self> {
        let (currency, price) = normalize_currency(currency, price);
        if !price.is_finite() || price <= 0.0 {
            return None;
        }

        let scaled = (price * MICROS_PER_UNIT as f64).round();
        if scaled > i64::MAX as f64 || scaled < 1.0 {
            return None;
        }

        Some(Quote {
            price_micros: scaled as i64,
            currency,
        })
    }
}

/// `GBp`/`GBX` are pence, not pounds: Yahoo quotes London equities in them and distinguishes them
/// from `GBP` by CASE alone, which is why this compares before upper-casing anything.
pub fn normalize_currency(currency: &str, price: f64) -> (String, f64) {
    if currency == "GBp" || currency.eq_ignore_ascii_case("GBX") {
        return ("GBP".to_string(), price / 100.0);
    }

    (currency.trim().to_ascii_uppercase(), price)
}

/// Yahoo's FX instrument for "one `from` costs how many `to`".
pub fn fx_symbol(from: &str, to: &str) -> String {
    format!("{}{}=X", from.to_ascii_uppercase(), to.to_ascii_uppercase())
}

fn round_div(numerator: i64, denominator: i64) -> i64 {
    if numerator >= 0 {
        (numerator + denominator / 2) / denominator
    } else {
        (numerator - denominator / 2) / denominator
    }
}

/// `async fn` in a trait is not object-safe, and `refresh_holdings` takes `&dyn PriceProvider` so a
/// test can inject a fake without a network. Boxing the future by hand is what buys that, without
/// adding an `async-trait` dependency.
pub type ProviderFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, AppError>> + Send + 'a>>;

/// A symbol that could not be priced is ABSENT from the map rather than an `Err`: one dead symbol
/// must not fail the other two (the partial-refresh row of the matrix).
pub trait PriceProvider: Send + Sync {
    fn search<'a>(&'a self, query: &'a str) -> ProviderFuture<'a, Vec<StockSearchResult>>;

    fn quote<'a>(&'a self, symbols: &'a [String]) -> ProviderFuture<'a, HashMap<String, Quote>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quote_is_scaled_to_micros_and_rounded_once_into_cents() {
        let quote = Quote::from_parts("CAD", 123.456789).expect("a finite price");

        assert_eq!(quote.price_micros, 123_456_789);
        assert_eq!(quote.price_cents(), 12_346);
        assert_eq!(quote.currency, "CAD");
    }

    /// Edge-case matrix: "Pence quote -> normalised to GBP, price / 100".
    #[test]
    fn a_pence_quote_becomes_pounds_and_is_told_apart_from_pounds_by_case() {
        let pence = Quote::from_parts("GBp", 7250.0).expect("a pence price");
        assert_eq!(pence.currency, "GBP");
        assert_eq!(pence.price_cents(), 7_250);

        let gbx = Quote::from_parts("GBX", 7250.0).expect("a pence price");
        assert_eq!((gbx.currency.as_str(), gbx.price_cents()), ("GBP", 7_250));

        let pounds = Quote::from_parts("GBP", 72.50).expect("a pound price");
        assert_eq!((pounds.currency.as_str(), pounds.price_cents()), ("GBP", 7_250));
    }

    #[test]
    fn a_lowercase_currency_is_uppercased_and_a_nonsense_price_is_refused() {
        assert_eq!(
            Quote::from_parts("usd", 1.0).expect("a price").currency,
            "USD"
        );
        assert!(Quote::from_parts("USD", f64::NAN).is_none());
        assert!(Quote::from_parts("USD", -1.0).is_none());
        assert!(Quote::from_parts("USD", f64::INFINITY).is_none());
    }

    /// A halted ticker quotes at 0. Accepting it would replace a good cached price with zero, so it
    /// is not a quote at all — the symbol fails and the cached values survive.
    #[test]
    fn a_zero_price_is_not_a_quote() {
        assert!(Quote::from_parts("USD", 0.0).is_none());
        assert!(Quote::from_parts("USD", -0.0).is_none());
        // Below half a micro, which would round to zero micros and value the holding at nothing.
        assert!(Quote::from_parts("USD", 0.0000004).is_none());
        // And the smallest price that IS representable still works.
        assert_eq!(
            Quote::from_parts("USD", 0.000001)
                .expect("one micro is a price")
                .price_micros,
            1
        );
    }

    /// Pence normalisation divides before the check, so a 0-pence quote must still be refused.
    #[test]
    fn a_zero_pence_quote_is_refused_after_normalisation() {
        assert!(Quote::from_parts("GBp", 0.0).is_none());
    }

    #[test]
    fn an_fx_pair_is_named_the_way_yahoo_names_it() {
        assert_eq!(fx_symbol("USD", "CAD"), "USDCAD=X");
        assert_eq!(fx_symbol("usd", "cad"), "USDCAD=X");
    }

    #[test]
    fn rounding_is_half_away_from_zero_in_both_directions() {
        assert_eq!(round_div(5_000, MICROS_PER_CENT), 1);
        assert_eq!(round_div(4_999, MICROS_PER_CENT), 0);
        assert_eq!(round_div(-5_000, MICROS_PER_CENT), -1);
    }
}
