//! The header every immutable sync object carries (AD-8).
//!
//! WHY a header at all, when S3 already stores a content hash as object metadata: the metadata is
//! the transport's, and a reader that trusts it trusts the transport. The header travels INSIDE the
//! bytes, so a snapshot or a blob restored from a backup, read from a mirror or handed over by any
//! future transport still says what format it is, whether it is encrypted, and what schema version
//! produced it. `enc_scheme` is the reserved byte that lets a client-side-encryption tier arrive
//! later without a format break (AD-8: v1 writes `0` and readers reject what they do not know).
//!
//! This is the blob's header because the blob is the first object kind to exist; segments and
//! snapshots (Story 8) use the same one, which is why it lives here rather than in `blob.rs`.

use std::fmt;

/// Identifies the byte stream before anything else is read. Eight bytes rather than four so a
/// truncated or mis-decompressed payload cannot plausibly collide with it.
pub const OBJECT_MAGIC: &[u8; 8] = b"NIXSOBJ\x01";

/// The header layout's own version. Bumped only when the FIELDS below change, which is a different
/// event from the dataset's `schema_version` changing.
pub const OBJECT_FORMAT_VERSION: u8 = 1;

/// No client-side encryption: the bucket's SSE-S3 default is the only encryption in v1 (AD-8).
pub const ENC_SCHEME_NONE: u8 = 0;

/// magic(8) + format_version(1) + enc_scheme(1) + schema_version(4, big endian) + sha256(32).
pub const OBJECT_HEADER_LEN: usize = 8 + 1 + 1 + 4 + 32;

/// A digest as lowercase hex, which is the form every key, metadata header and database column in
/// this feature uses.
pub(super) fn hex_lower(bytes: &[u8]) -> String {
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        hex.push(char::from_digit((byte >> 4) as u32, 16).expect("a nibble is a hex digit"));
        hex.push(char::from_digit((byte & 0x0f) as u32, 16).expect("a nibble is a hex digit"));
    }
    hex
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ObjectHeader {
    pub enc_scheme: u8,
    pub schema_version: u32,
    pub content_sha256: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectHeaderError {
    /// Fewer bytes than a header, so nothing about the object can be trusted.
    Truncated,
    NotAnObject,
    UnknownFormatVersion { found: u8 },
    /// A scheme this build cannot decrypt. Refused rather than ignored: reading the payload anyway
    /// would hand ciphertext to a caller expecting an image.
    UnknownEncScheme { found: u8 },
}

impl fmt::Display for ObjectHeaderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ObjectHeaderError::Truncated => f.write_str("object is shorter than its header"),
            ObjectHeaderError::NotAnObject => f.write_str("object does not carry the sync magic"),
            ObjectHeaderError::UnknownFormatVersion { found } => {
                write!(f, "unknown object format version {found}")
            }
            ObjectHeaderError::UnknownEncScheme { found } => {
                write!(f, "unknown object encryption scheme {found}")
            }
        }
    }
}

impl std::error::Error for ObjectHeaderError {}

impl ObjectHeader {
    pub fn new(schema_version: u32, content_sha256: [u8; 32]) -> Self {
        Self {
            enc_scheme: ENC_SCHEME_NONE,
            schema_version,
            content_sha256,
        }
    }

    /// The header followed by `payload`, which is the whole object body. One function so no writer
    /// can produce a payload that is not preceded by its own header.
    pub fn frame(&self, payload: &[u8]) -> Vec<u8> {
        let mut framed = Vec::with_capacity(OBJECT_HEADER_LEN + payload.len());
        framed.extend_from_slice(OBJECT_MAGIC);
        framed.push(OBJECT_FORMAT_VERSION);
        framed.push(self.enc_scheme);
        framed.extend_from_slice(&self.schema_version.to_be_bytes());
        framed.extend_from_slice(&self.content_sha256);
        framed.extend_from_slice(payload);
        framed
    }

    /// Splits a stored object into its header and its payload, refusing anything this build cannot
    /// read. Returning the payload as a slice of the input keeps a multi-megabyte blob from being
    /// copied just to be inspected.
    pub fn parse(object: &[u8]) -> Result<(Self, &[u8]), ObjectHeaderError> {
        let (header, payload) = object
            .split_at_checked(OBJECT_HEADER_LEN)
            .ok_or(ObjectHeaderError::Truncated)?;

        if &header[..8] != OBJECT_MAGIC {
            return Err(ObjectHeaderError::NotAnObject);
        }
        if header[8] != OBJECT_FORMAT_VERSION {
            return Err(ObjectHeaderError::UnknownFormatVersion { found: header[8] });
        }
        let enc_scheme = header[9];
        if enc_scheme != ENC_SCHEME_NONE {
            return Err(ObjectHeaderError::UnknownEncScheme { found: enc_scheme });
        }

        let mut schema_version = [0u8; 4];
        schema_version.copy_from_slice(&header[10..14]);
        let mut content_sha256 = [0u8; 32];
        content_sha256.copy_from_slice(&header[14..OBJECT_HEADER_LEN]);

        Ok((
            Self {
                enc_scheme,
                schema_version: u32::from_be_bytes(schema_version),
                content_sha256,
            },
            payload,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(seed: u8) -> [u8; 32] {
        [seed; 32]
    }

    #[test]
    fn a_framed_object_round_trips_its_header_and_payload() {
        let header = ObjectHeader::new(30, digest(7));
        let framed = header.frame(b"payload bytes");

        assert_eq!(framed.len(), OBJECT_HEADER_LEN + 13);
        let (parsed, payload) = ObjectHeader::parse(&framed).expect("the header parses");
        assert_eq!(parsed, header);
        assert_eq!(parsed.enc_scheme, ENC_SCHEME_NONE);
        assert_eq!(payload, b"payload bytes");
    }

    #[test]
    fn an_empty_payload_is_still_a_readable_object() {
        let framed = ObjectHeader::new(1, digest(0)).frame(&[]);

        let (_, payload) = ObjectHeader::parse(&framed).expect("the header parses");
        assert!(payload.is_empty());
    }

    #[test]
    fn anything_this_build_cannot_read_is_refused_rather_than_guessed() {
        let framed = ObjectHeader::new(30, digest(1)).frame(b"payload");

        assert_eq!(
            ObjectHeader::parse(&framed[..OBJECT_HEADER_LEN - 1]),
            Err(ObjectHeaderError::Truncated)
        );

        let mut not_ours = framed.clone();
        not_ours[0] = b'X';
        assert_eq!(
            ObjectHeader::parse(&not_ours),
            Err(ObjectHeaderError::NotAnObject)
        );

        let mut newer_format = framed.clone();
        newer_format[8] = OBJECT_FORMAT_VERSION + 1;
        assert_eq!(
            ObjectHeader::parse(&newer_format),
            Err(ObjectHeaderError::UnknownFormatVersion {
                found: OBJECT_FORMAT_VERSION + 1
            })
        );

        let mut encrypted = framed;
        encrypted[9] = 1;
        assert_eq!(
            ObjectHeader::parse(&encrypted),
            Err(ObjectHeaderError::UnknownEncScheme { found: 1 })
        );
    }

    /// The schema version is what Story 8's apply path parks an object on when it is newer than
    /// this build (AD-11), so it has to survive the round trip exactly rather than approximately.
    #[test]
    fn the_schema_version_survives_the_round_trip_at_both_extremes() {
        for schema_version in [0, 30, u32::MAX] {
            let framed = ObjectHeader::new(schema_version, digest(2)).frame(b"x");
            let (parsed, _) = ObjectHeader::parse(&framed).expect("the header parses");
            assert_eq!(parsed.schema_version, schema_version);
        }
    }
}
