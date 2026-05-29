use keyring_core::{Entry, Error};

const KEYRING_SERVICE: &str = "nkbaz-finance";

pub fn store_aws_credentials(
    access_key: &str,
    secret_key: &str,
    region: &str,
) -> Result<(), Error> {
    Entry::new(KEYRING_SERVICE, "aws_access_key_id")?.set_password(access_key)?;
    Entry::new(KEYRING_SERVICE, "aws_secret_access_key")?.set_password(secret_key)?;
    Entry::new(KEYRING_SERVICE, "aws_region")?.set_password(region)?;
    Ok(())
}

pub fn load_aws_credentials() -> Option<(String, String, String)> {
    let access_key = Entry::new(KEYRING_SERVICE, "aws_access_key_id")
        .ok()?
        .get_password()
        .ok()?;
    let secret_key = Entry::new(KEYRING_SERVICE, "aws_secret_access_key")
        .ok()?
        .get_password()
        .ok()?;
    let region = Entry::new(KEYRING_SERVICE, "aws_region")
        .ok()?
        .get_password()
        .ok()?;
    Some((access_key, secret_key, region))
}

pub fn store_openai_key(api_key: &str) -> Result<(), Error> {
    Entry::new(KEYRING_SERVICE, "openai_api_key")?.set_password(api_key)?;
    Ok(())
}

pub fn load_openai_key() -> Option<String> {
    Entry::new(KEYRING_SERVICE, "openai_api_key")
        .ok()?
        .get_password()
        .ok()
}

pub fn clear_credentials() {
    let names = [
        "aws_access_key_id",
        "aws_secret_access_key",
        "aws_region",
        "openai_api_key",
    ];
    for name in &names {
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, name) {
            let _ = entry.delete_credential();
        }
    }
}
