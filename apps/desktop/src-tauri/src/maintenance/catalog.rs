use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const CATALOG_TTL_DAYS: i64 = 180;
pub const NHTSA_BASE: &str = "https://vpic.nhtsa.dot.gov/api/vehicles/";
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogMeta {
    pub cached_at: String,
    pub ttl_days: i64,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleMake {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleModel {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedMakes {
    pub makes: Vec<VehicleMake>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedModels {
    pub make: String,
    pub year: i32,
    pub models: Vec<VehicleModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VehicleCatalogStatus {
    pub available: bool,
    pub cached_at: Option<String>,
    pub stale: bool,
}

#[derive(Debug, Deserialize)]
struct NhtsaMakesResponse {
    #[serde(default, rename = "Results")]
    results: Vec<NhtsaMakeResult>,
}

#[derive(Debug, Deserialize)]
struct NhtsaMakeResult {
    #[serde(rename = "MakeName")]
    make_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NhtsaModelsResponse {
    #[serde(default, rename = "Results")]
    results: Vec<NhtsaModelResult>,
}

#[derive(Debug, Deserialize)]
struct NhtsaModelResult {
    #[serde(rename = "Model_Name")]
    model_name: Option<String>,
}

pub fn catalog_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("vehicle_catalog")
}

pub fn make_slug(make: &str) -> String {
    let mut slug = String::new();
    let mut last_was_sep = false;

    for ch in make.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_was_sep = false;
        } else if !last_was_sep {
            slug.push('_');
            last_was_sep = true;
        }
    }

    let trimmed = slug.trim_matches('_');
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

fn meta_path(dir: &Path) -> PathBuf {
    dir.join("meta.json")
}

fn makes_path(dir: &Path) -> PathBuf {
    dir.join("makes.json")
}

fn models_path(dir: &Path, make: &str, year: i32) -> PathBuf {
    dir.join("models")
        .join(format!("{}_{}.json", make_slug(make), year))
}

fn read_meta(dir: &Path) -> Option<CatalogMeta> {
    let path = meta_path(dir);
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_meta(dir: &Path, meta: &CatalogMeta) -> Result<(), AppError> {
    std::fs::create_dir_all(dir).map_err(|e| AppError::File {
        message: format!("Failed to create catalog dir: {}", e),
    })?;
    write_json_atomic(&meta_path(dir), meta)
}

fn read_makes(dir: &Path) -> Option<CachedMakes> {
    let data = std::fs::read_to_string(makes_path(dir)).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_makes(dir: &Path, makes: &CachedMakes) -> Result<(), AppError> {
    std::fs::create_dir_all(dir).map_err(|e| AppError::File {
        message: format!("Failed to create catalog dir: {}", e),
    })?;
    write_json_atomic(&makes_path(dir), makes)
}

fn read_models(dir: &Path, make: &str, year: i32) -> Option<CachedModels> {
    let data = std::fs::read_to_string(models_path(dir, make, year)).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_models(dir: &Path, cached: &CachedModels) -> Result<(), AppError> {
    let models_dir = dir.join("models");
    std::fs::create_dir_all(&models_dir).map_err(|e| AppError::File {
        message: format!("Failed to create models dir: {}", e),
    })?;
    write_json_atomic(&models_path(dir, &cached.make, cached.year), cached)
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| AppError::File {
        message: "Invalid catalog file path".to_string(),
    })?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::File {
        message: format!("Failed to create parent dir: {}", e),
    })?;

    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(value).map_err(|e| AppError::File {
        message: format!("Failed to serialize catalog data: {}", e),
    })?;
    std::fs::write(&tmp_path, json).map_err(|e| AppError::File {
        message: format!("Failed to write catalog temp file: {}", e),
    })?;
    std::fs::rename(&tmp_path, path).map_err(|e| AppError::File {
        message: format!("Failed to finalize catalog file: {}", e),
    })?;
    Ok(())
}

pub fn is_cache_stale(meta: &CatalogMeta) -> bool {
    let cached_at = match DateTime::parse_from_rfc3339(&meta.cached_at) {
        Ok(dt) => dt.with_timezone(&Utc),
        Err(_) => return true,
    };
    let ttl = Duration::days(meta.ttl_days);
    Utc::now() > cached_at + ttl
}

pub fn get_catalog_status(app_data_dir: &Path) -> VehicleCatalogStatus {
    let dir = catalog_dir(app_data_dir);
    let meta = read_meta(&dir);
    let makes = read_makes(&dir);
    let available = makes
        .as_ref()
        .map(|m| !m.makes.is_empty())
        .unwrap_or(false);

    let stale = match &meta {
        Some(m) => is_cache_stale(m),
        None => true,
    };

    VehicleCatalogStatus {
        available,
        cached_at: meta.map(|m| m.cached_at),
        stale,
    }
}

pub fn get_cached_makes(app_data_dir: &Path) -> Vec<VehicleMake> {
    let dir = catalog_dir(app_data_dir);
    read_makes(&dir)
        .map(|m| m.makes)
        .unwrap_or_default()
}

pub async fn fetch_makes_from_nhtsa() -> Result<Vec<VehicleMake>, AppError> {
    let url = format!("{NHTSA_BASE}GetMakesForVehicleType/car?format=json");
    let client = reqwest::Client::new();
    let response = client.get(&url).send().await.map_err(|e| {
        tracing::error!("NHTSA makes fetch failed: {}", e);
        AppError::Unavailable
    })?;

    if !response.status().is_success() {
        tracing::error!("NHTSA makes fetch returned status {}", response.status());
        return Err(AppError::Unavailable);
    }

    let body: NhtsaMakesResponse = response.json().await.map_err(|e| {
        tracing::error!("NHTSA makes response parse failed: {}", e);
        AppError::Unavailable
    })?;

    let mut makes: Vec<VehicleMake> = body
        .results
        .into_iter()
        .filter_map(|r| {
            let name = r.make_name?.trim().to_string();
            if name.is_empty() {
                None
            } else {
                Some(VehicleMake { name })
            }
        })
        .collect();

    makes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    makes.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));

    Ok(makes)
}

pub async fn fetch_models_from_nhtsa(make: &str, year: i32) -> Result<Vec<VehicleModel>, AppError> {
    let encoded_make = urlencoding::encode(make.trim());
    let url = format!(
        "{NHTSA_BASE}GetModelsForMakeYear/make/{encoded_make}/modelyear/{year}?format=json"
    );
    let client = reqwest::Client::new();
    let response = client.get(&url).send().await.map_err(|e| {
        tracing::error!("NHTSA models fetch failed for {make} {year}: {}", e);
        AppError::Unavailable
    })?;

    if !response.status().is_success() {
        tracing::error!(
            "NHTSA models fetch returned status {} for {make} {year}",
            response.status()
        );
        return Err(AppError::Unavailable);
    }

    let body: NhtsaModelsResponse = response.json().await.map_err(|e| {
        tracing::error!("NHTSA models response parse failed: {}", e);
        AppError::Unavailable
    })?;

    let mut models: Vec<VehicleModel> = body
        .results
        .into_iter()
        .filter_map(|r| {
            let name = r.model_name?.trim().to_string();
            if name.is_empty() {
                None
            } else {
                Some(VehicleModel { name })
            }
        })
        .collect();

    models.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    models.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));

    Ok(models)
}

pub async fn refresh_makes_cache(app_data_dir: &Path) -> Result<(), AppError> {
    let makes = fetch_makes_from_nhtsa().await?;
    if makes.is_empty() {
        tracing::warn!("NHTSA returned no makes; keeping existing cache");
        return Ok(());
    }

    let dir = catalog_dir(app_data_dir);
    write_makes(&dir, &CachedMakes { makes })?;
    write_meta(
        &dir,
        &CatalogMeta {
            cached_at: Utc::now().to_rfc3339(),
            ttl_days: CATALOG_TTL_DAYS,
            schema_version: SCHEMA_VERSION,
        },
    )?;
    Ok(())
}

pub async fn get_or_fetch_models(
    app_data_dir: &Path,
    make: &str,
    year: i32,
) -> Result<Vec<VehicleModel>, AppError> {
    let dir = catalog_dir(app_data_dir);
    if let Some(cached) = read_models(&dir, make, year) {
        return Ok(cached.models);
    }

    match fetch_models_from_nhtsa(make, year).await {
        Ok(models) => {
            if !models.is_empty() {
                let cached = CachedModels {
                    make: make.trim().to_string(),
                    year,
                    models: models.clone(),
                };
                if let Err(e) = write_models(&dir, &cached) {
                    tracing::error!("Failed to write models cache: {}", e);
                }
            }
            Ok(models)
        }
        Err(e) => {
            tracing::error!("Models fetch failed for {make} {year}: {}", e);
            Ok(vec![])
        }
    }
}

pub async fn run_background_catalog_refresh(app_data_dir: PathBuf) {
    let dir = catalog_dir(&app_data_dir);
    let meta = read_meta(&dir);
    let needs_refresh = meta.as_ref().is_none_or(is_cache_stale);

    if !needs_refresh {
        tracing::info!("Vehicle catalog cache is fresh; skipping background refresh");
        return;
    }

    tracing::info!("Starting background vehicle catalog refresh");
    match refresh_makes_cache(&app_data_dir).await {
        Ok(()) => tracing::info!("Vehicle catalog makes cache refreshed"),
        Err(e) => tracing::error!("Vehicle catalog refresh failed: {}", e),
    }
}

pub fn spawn_background_catalog_refresh(app_data_dir: PathBuf) {
    tauri::async_runtime::spawn(run_background_catalog_refresh(app_data_dir));
}

pub fn validate_catalog_year(year: i32) -> Result<(), AppError> {
    if !(1900..=2100).contains(&year) {
        return Err(AppError::Validation {
            message: "Year must be between 1900 and 2100".to_string(),
            field: Some("year".to_string()),
        });
    }
    Ok(())
}

pub fn validate_catalog_make(make: &str) -> Result<(), AppError> {
    if make.trim().is_empty() {
        return Err(AppError::Validation {
            message: "Make is required".to_string(),
            field: Some("make".to_string()),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use tempfile::TempDir;

    #[test]
    fn make_slug_normalizes_hyphens_and_spaces() {
        assert_eq!(make_slug("Mercedes-Benz"), "mercedes_benz");
        assert_eq!(make_slug("  Honda  "), "honda");
        assert_eq!(make_slug("A--B"), "a_b");
    }

    #[test]
    fn is_cache_stale_respects_ttl_boundary() {
        let fresh = CatalogMeta {
            cached_at: (Utc::now() - Duration::days(179)).to_rfc3339(),
            ttl_days: 180,
            schema_version: 1,
        };
        assert!(!is_cache_stale(&fresh));

        let stale = CatalogMeta {
            cached_at: (Utc::now() - Duration::days(181)).to_rfc3339(),
            ttl_days: 180,
            schema_version: 1,
        };
        assert!(is_cache_stale(&stale));
    }

    #[test]
    fn get_catalog_status_without_files_is_unavailable() {
        let tmp = TempDir::new().unwrap();
        let status = get_catalog_status(tmp.path());
        assert!(!status.available);
        assert!(status.stale);
        assert!(status.cached_at.is_none());
    }

    #[test]
    fn get_catalog_status_with_makes_is_available() {
        let tmp = TempDir::new().unwrap();
        let dir = catalog_dir(tmp.path());
        std::fs::create_dir_all(&dir).unwrap();
        write_makes(
            &dir,
            &CachedMakes {
                makes: vec![VehicleMake {
                    name: "Honda".to_string(),
                }],
            },
        )
        .unwrap();
        write_meta(
            &dir,
            &CatalogMeta {
                cached_at: Utc.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).unwrap().to_rfc3339(),
                ttl_days: 180,
                schema_version: 1,
            },
        )
        .unwrap();

        let status = get_catalog_status(tmp.path());
        assert!(status.available);
        assert!(status.stale);
        assert!(status.cached_at.is_some());
    }

    #[test]
    fn parses_nhtsa_makes_response_results_array() {
        let json = r#"{
            "Count": 2,
            "Message": "Response returned successfully",
            "Results": [
                { "MakeId": 448, "MakeName": "TOYOTA" },
                { "MakeId": 474, "MakeName": "HONDA" }
            ]
        }"#;
        let body: NhtsaMakesResponse = serde_json::from_str(json).unwrap();
        assert_eq!(body.results.len(), 2);
        assert_eq!(body.results[0].make_name.as_deref(), Some("TOYOTA"));
    }
}
