//! Segments, heads, the roster and the conditional poll (AD-6, AD-8).
//!
//! This is the log half of the protocol: the half that moves individual changes rather than whole
//! databases. Four shapes live here, and each one exists because of a specific hazard.
//!
//! **A segment** is an immutable object holding a contiguous run of this install's `sync_log` rows,
//! keyed `log/<install>/<seq>` and written create-only. It is never modified. The `seq` and the
//! batch are both DERIVED from the stored log — the next seq is `MAX(seq) + 1` for this install and
//! the batch is the lowest unshipped ids — so a crash between the PUT and the shipping mark leaves
//! a re-cut producing the SAME seq and the SAME bytes. AD-6 then reports the 412 as success and the
//! duplicate upload costs one request instead of minting a second segment under a new number.
//!
//! **A head** (`head/<install>`) is the one mutable key this install writes, saying how far its
//! segments go. It is a single-writer key, so the compare-and-swap is against the ETag this install
//! last wrote; a lost precondition is re-read rather than overwritten.
//!
//! **The roster** is how a computer is discovered at all, without a server and without a LIST:
//! every install adds itself by compare-and-swap, merging whatever it finds, so two computers
//! racing both end up in it.
//!
//! **The poll** reads the roster and each known head with CONDITIONAL GETs. A `304` carries no body
//! but is still billed as a GET (AD-6), which is why the cadence is bounded by `SyncTuning` and why
//! LIST is used only to repair — a missing head or a gap — and never on the normal path.
//!
//! The payload encoding and the compression level below are FROZEN with the object format version
//! (Consistency Conventions). `the_segment_payload_encoding_is_frozen` pins the exact bytes.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::db::sync_segment::{self, UnshippedMessage};
use crate::error::AppError;

use super::gate::{
    CapabilitySource, DatasetLink, GateStateSource, GatedError, GatedStore, SyncGate,
};
use super::object::{hex_lower, ObjectHeader, ObjectHeaderError};
use super::store::{ConditionalGet, ETag, ImmutablePut, ObjectStore, StoreError};

/// AD-6's log namespace, relative to `acct/<identity-id>/`.
pub const LOG_KEY_PREFIX: &str = "log/";

/// AD-6's per-install head namespace: one mutable key, one writer.
pub const HEAD_KEY_PREFIX: &str = "head/";

/// AD-6's install directory at epoch 0. The only key every computer on the account writes.
///
/// Kept as the bare `roster` for the never-wiped account, so nothing about an account that has
/// never used "delete everything" changes: see `roster_key`.
pub const ROSTER_KEY: &str = "roster";

/// Which roster an epoch's computers meet in (story wipe-epoch).
///
/// Epoch 0 — an account nobody has ever wiped — is the bare `roster`, byte for byte the key every
/// existing install already writes. Every wipe moves the whole account to a FRESH list at
/// `roster/e<N>`, and that is what makes a wipe effective without a blacklist: a computer only ever
/// polls the installs named in the roster OF ITS OWN EPOCH, so every pre-wipe install is
/// structurally unreachable rather than listed somewhere as retired. It also means nothing has to
/// delete a pre-wipe head or segment for the data to stop coming back.
///
/// Inside the account prefix (AD-7) and traversal-free, so `store::validate_relative_key` accepts
/// it and the `acct/<id>/*` IAM grant already covers it — no new permission (AD-13's delete
/// statement is deliberately left scoped to `log/*` and `snap/*`).
pub fn roster_key(epoch: u64) -> String {
    if epoch == 0 {
        return ROSTER_KEY.to_string();
    }

    format!("{ROSTER_KEY}/e{epoch}")
}

/// FROZEN with the object format version, for the same reason as the snapshot's level: raising it
/// changes every byte of every segment, so it moves only together with the format version. 3 is
/// zstd's default, and a segment is mostly repetitive framing and short text where it already
/// compresses several times over.
pub const SEGMENT_COMPRESSION_LEVEL: i32 = 3;

/// The version of the payload layout INSIDE the AD-8 header.
///
/// Separate from `OBJECT_FORMAT_VERSION`, which versions the header's own fields: a later build may
/// change how messages are packed without touching the header, and an older build has to refuse
/// that payload cleanly rather than decode nonsense out of it.
pub const SEGMENT_PAYLOAD_VERSION: u16 = 1;

/// How many messages one segment may carry.
///
/// Big enough that an ordinary editing session is one object, small enough that a 5,000-message
/// backlog becomes a handful of bounded objects instead of one upload a slow link cannot finish.
pub const SEGMENT_MAX_MESSAGES: usize = 1_000;

/// AD-18's enforced segment size, applied to the UNCOMPRESSED payload.
///
/// This is where "an oversize segment candidate is split" happens: `bounded_batch` stops adding
/// messages here, so a large backlog becomes several bounded objects rather than one refusal. It
/// is measured before compression because that is the only quantity the cutter can bound without
/// encoding anything, and the encoded object is capped separately and more loosely by
/// `limits::MAX_SEGMENT_OBJECT_BYTES` at the gated-store boundary.
pub const SEGMENT_MAX_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;

/// A ceiling on what a segment READ will decompress, so a small object cannot be expanded into
/// unbounded memory. Deliberately looser than AD-18's write caps (`sync::limits`): those bound
/// what THIS computer writes, while this bounds what a peer's object may expand to on read, and
/// refusing a readable segment because a future build packs more into one would lose messages.
const MAX_READ_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;

/// The version of the `head/<install>` and `roster` documents. Plain JSON pointers like
/// `snap/LATEST`, not framed objects: they have to be readable to find anything at all.
pub const HEAD_VERSION: u32 = 1;
pub const ROSTER_VERSION: u32 = 1;

/// How many times a roster compare-and-swap re-reads and retries before giving up for this cycle.
/// Bounded because every computer on the account writes this key, and an unbounded loop would be a
/// billed spin.
const ROSTER_CAS_ATTEMPTS: usize = 5;

/// How many segments one cycle ships before yielding, so a huge backlog is drained over several
/// cycles instead of one unbounded burst.
pub const MAX_SEGMENTS_PER_CYCLE: usize = 16;

/// An install id as it appears in a key: exactly 16 lowercase hex characters (AD-4).
fn is_install_id(candidate: &str) -> bool {
    candidate.len() == super::clock::INSTALL_ID_LEN
        && candidate
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// `log/<install>/<seq>`, with the seq fixed-width so a lexical listing is also a numeric one.
///
/// Zero-padded deliberately: the repair path is a listing, and `log/x/10` sorting before `log/x/9`
/// would make a repair read the objects in an order that is not the apply order.
pub fn segment_key(install: &str, seq: i64) -> String {
    format!("{LOG_KEY_PREFIX}{install}/{seq:016}")
}

pub fn head_key(install: &str) -> String {
    format!("{HEAD_KEY_PREFIX}{install}")
}

/// The five message kinds migration 032 closes by CHECK, as a wire tag.
///
/// Numbered on the wire rather than spelled: the tag is part of the frozen format, and a renamed
/// Rust variant must not be able to change the bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageKind {
    Field,
    CounterDelta,
    BalanceSet,
    BalanceDelta,
    Tombstone,
}

impl MessageKind {
    pub fn tag(self) -> u8 {
        match self {
            MessageKind::Field => 1,
            MessageKind::CounterDelta => 2,
            MessageKind::BalanceSet => 3,
            MessageKind::BalanceDelta => 4,
            MessageKind::Tombstone => 5,
        }
    }

    fn from_tag(tag: u8) -> Option<Self> {
        match tag {
            1 => Some(MessageKind::Field),
            2 => Some(MessageKind::CounterDelta),
            3 => Some(MessageKind::BalanceSet),
            4 => Some(MessageKind::BalanceDelta),
            5 => Some(MessageKind::Tombstone),
            _ => None,
        }
    }

    /// The `sync_log.kind` spelling, which is what the apply path writes back (Story 20).
    // Story 20 is the first production caller: apply re-states the kind in `sync_pending` and
    // `sync_quarantine`, whose CHECKs use these words.
    #[allow(dead_code)]
    pub fn as_str(self) -> &'static str {
        match self {
            MessageKind::Field => "field",
            MessageKind::CounterDelta => "counter_delta",
            MessageKind::BalanceSet => "balance_set",
            MessageKind::BalanceDelta => "balance_delta",
            MessageKind::Tombstone => "tombstone",
        }
    }

    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "field" => Some(MessageKind::Field),
            "counter_delta" => Some(MessageKind::CounterDelta),
            "balance_set" => Some(MessageKind::BalanceSet),
            "balance_delta" => Some(MessageKind::BalanceDelta),
            "tombstone" => Some(MessageKind::Tombstone),
            _ => None,
        }
    }
}

/// One replication message as it travels. The same fields `sync_log` holds, minus the local row id
/// and minus `(install, seq, idx)`, which are the segment's rather than the message's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentMessage {
    /// Story 13's frozen 33-character encoding.
    pub hlc: String,
    pub kind: MessageKind,
    pub table_name: String,
    pub row_uuid: [u8; 16],
    pub column_name: Option<String>,
    pub cause_uuid: Option<[u8; 16]>,
    pub payload: Option<Vec<u8>>,
}

/// Why a segment, head or roster could not be trusted.
///
/// Every variant is a refusal to hand something on, never a panic: all of it is bytes another
/// computer wrote, and Story 20 writes the result into the user's tables.
#[derive(Debug, Clone, PartialEq)]
pub enum SegmentError {
    Header(ObjectHeaderError),
    /// A payload layout this build does not know. Refused cleanly so a newer computer's object
    /// parks instead of being half-decoded (AD-11, CAP-7).
    UnknownPayloadVersion { found: u16 },
    /// Truncated, trailing bytes, an unknown kind tag, or text that is not UTF-8.
    Malformed,
    /// The payload does not hash to what its own header claims.
    HashMismatch { expected: String, found: String },
    /// Not decompressible, or larger than the read ceiling.
    Corrupt,
    /// Written by a build with a newer dataset schema.
    SchemaTooNew { found: u32, supported: u32 },
    /// The payload names a different install or seq than the key it was fetched from, which would
    /// let one install's object be applied as another's.
    Misaddressed,
    Store(GatedError),
    /// The applier refused the batch, so the cursor must not advance past it.
    Apply,
}

impl SegmentError {
    /// The stable discriminator `SyncFault` carries (AD-16): a code, never service prose and never
    /// a row value.
    pub fn code(&self) -> &'static str {
        match self {
            SegmentError::SchemaTooNew { .. } => "update_needed",
            SegmentError::Apply => "apply_failed",
            SegmentError::Header(_)
            | SegmentError::UnknownPayloadVersion { .. }
            | SegmentError::Malformed
            | SegmentError::HashMismatch { .. }
            | SegmentError::Corrupt
            | SegmentError::Misaddressed
            | SegmentError::Store(_) => "segment_invalid",
        }
    }
}

impl From<ObjectHeaderError> for SegmentError {
    fn from(error: ObjectHeaderError) -> Self {
        SegmentError::Header(error)
    }
}

impl From<GatedError> for SegmentError {
    fn from(error: GatedError) -> Self {
        SegmentError::Store(error)
    }
}

/// One install's contiguous, ordered messages, handed to the applier as a unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentBatch {
    pub install: String,
    pub seq: i64,
    pub messages: Vec<SegmentMessage>,
}

/// Where the pull side hands decoded messages (Story 20 implements the real apply).
///
/// Per install, batches arrive in contiguous `seq` order and nothing is handed on twice. An `Err`
/// holds the cursor back: the batch stays owed, so refusing is always safe.
///
/// Object-safe and synchronous on purpose: the real implementation is SQLite work on the actor's
/// own connection — a blocking call on the actor's own thread — and an `async fn` in trait here
/// would make the whole poll future harder to compose for no gain.
pub(crate) trait Applier {
    /// How many messages were accepted. Counts only; AD-16 keeps values out of every report.
    fn apply(&mut self, batch: &SegmentBatch) -> Result<usize, AppError>;

    /// How far ahead the furthest remote stamp this applier REFUSED was, draining the mark
    /// (AD-4). `None` means every stamp since the last call was inside the drift limit.
    ///
    /// On the trait rather than in the return of `apply`, because the question the actor asks is
    /// about the CYCLE and not about one batch, and because every applier that does not fold
    /// stamps into a clock (the recorder, the counter, the closed one) answers `None` by
    /// construction.
    fn take_clock_skew(&mut self) -> Option<i64> {
        None
    }
}

/// The applier the production actor runs until Story 20 lands.
///
/// It validates and COUNTS; it writes nothing. That is the honest state of the feature at this
/// story: the segment protocol is complete, the apply path does not exist yet. Nothing is lost by
/// it, because `sync_applied_vector` is untouched and the fetch cursor lives in memory, so a
/// relaunch re-fetches everything this applier saw.
#[derive(Debug, Default)]
pub(crate) struct CountingApplier {
    pub batches: u64,
    pub messages: u64,
}

impl Applier for CountingApplier {
    fn apply(&mut self, batch: &SegmentBatch) -> Result<usize, AppError> {
        self.batches += 1;
        self.messages += batch.messages.len() as u64;

        Ok(batch.messages.len())
    }
}

// --------------------------------------------------------------------------------------------
// The frozen payload encoding
// --------------------------------------------------------------------------------------------

/// A `u16` length meaning "absent"; no column name is 65 535 bytes long.
const ABSENT_U16: u16 = u16::MAX;
/// A `u32` length meaning "absent". A payload that long is refused by the size caps first.
const ABSENT_U32: u32 = u32::MAX;

/// The smallest a message can be on the wire: the fixed part of one record, used to refuse an
/// impossible message count before anything is reserved for it.
const MIN_MESSAGE_BYTES: usize = 33 + 1 + 2 + 16 + 2 + 1 + 4;

/// The frozen layout:
///
/// ```text
/// u16be   payload version
/// 16      install id (lowercase ASCII hex)
/// i64be   seq
/// u32be   message count
/// per message, in idx order:
///   33    hlc (ASCII, Story 13's frozen encoding)
///   u8    kind tag
///   u16be table name length, then the bytes
///   16    row uuid
///   u16be column name length (0xFFFF = none), then the bytes
///   u8    cause present (0 or 1), then 16 bytes when present
///   u32be payload length (0xFFFF_FFFF = none), then the bytes
/// ```
///
/// Hand-rolled framing rather than a serde format (postcard, bincode, rmp). Three reasons, in
/// order: the per-message `payload` is ALREADY a frozen opaque byte string capture produced, so
/// there is nothing left to derive; a wire shape has to be stated exactly somewhere, and a derived
/// encoding states it as "whatever that crate version emits for these field names"; and a new
/// dependency to serialize seven fixed fields buys nothing a golden-byte test cannot do better.
/// Fixed-width big-endian throughout, so the bytes are a pure function of the values.
fn encode_payload(install: &str, seq: i64, messages: &[SegmentMessage]) -> Vec<u8> {
    let mut out = Vec::with_capacity(32 + messages.len() * 96);
    out.extend_from_slice(&SEGMENT_PAYLOAD_VERSION.to_be_bytes());
    out.extend_from_slice(install.as_bytes());
    out.extend_from_slice(&seq.to_be_bytes());
    out.extend_from_slice(&(messages.len() as u32).to_be_bytes());

    for message in messages {
        out.extend_from_slice(message.hlc.as_bytes());
        out.push(message.kind.tag());

        out.extend_from_slice(&(message.table_name.len() as u16).to_be_bytes());
        out.extend_from_slice(message.table_name.as_bytes());

        out.extend_from_slice(&message.row_uuid);

        match &message.column_name {
            Some(name) => {
                out.extend_from_slice(&(name.len() as u16).to_be_bytes());
                out.extend_from_slice(name.as_bytes());
            }
            None => out.extend_from_slice(&ABSENT_U16.to_be_bytes()),
        }

        match &message.cause_uuid {
            Some(cause) => {
                out.push(1);
                out.extend_from_slice(cause);
            }
            None => out.push(0),
        }

        match &message.payload {
            Some(payload) => {
                out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
                out.extend_from_slice(payload);
            }
            None => out.extend_from_slice(&ABSENT_U32.to_be_bytes()),
        }
    }

    out
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], SegmentError> {
        let end = self.at.checked_add(len).ok_or(SegmentError::Malformed)?;
        let slice = self.bytes.get(self.at..end).ok_or(SegmentError::Malformed)?;
        self.at = end;

        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, SegmentError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, SegmentError> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| SegmentError::Malformed)?;

        Ok(u16::from_be_bytes(bytes))
    }

    fn u32(&mut self) -> Result<u32, SegmentError> {
        let bytes: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| SegmentError::Malformed)?;

        Ok(u32::from_be_bytes(bytes))
    }

    fn i64(&mut self) -> Result<i64, SegmentError> {
        let bytes: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| SegmentError::Malformed)?;

        Ok(i64::from_be_bytes(bytes))
    }

    fn uuid(&mut self) -> Result<[u8; 16], SegmentError> {
        self.take(16)?
            .try_into()
            .map_err(|_| SegmentError::Malformed)
    }

    fn text(&mut self, len: usize) -> Result<String, SegmentError> {
        let bytes = self.take(len)?;

        std::str::from_utf8(bytes)
            .map(str::to_string)
            .map_err(|_| SegmentError::Malformed)
    }
}

/// The inverse of [`encode_payload`], checked against the key it was fetched from.
fn decode_payload(
    bytes: &[u8],
    expect_install: &str,
    expect_seq: i64,
) -> Result<Vec<SegmentMessage>, SegmentError> {
    let mut reader = Reader { bytes, at: 0 };

    let version = reader.u16()?;
    if version != SEGMENT_PAYLOAD_VERSION {
        return Err(SegmentError::UnknownPayloadVersion { found: version });
    }

    let install = reader.text(super::clock::INSTALL_ID_LEN)?;
    let seq = reader.i64()?;
    if install != expect_install || seq != expect_seq {
        return Err(SegmentError::Misaddressed);
    }

    // A count is four bytes and can claim billions. Every message costs at least
    // `MIN_MESSAGE_BYTES`, so a claim the remaining bytes could not possibly satisfy is refused
    // before a single element is reserved for it.
    let count = reader.u32()? as usize;
    if count.saturating_mul(MIN_MESSAGE_BYTES) > bytes.len() {
        return Err(SegmentError::Malformed);
    }

    let mut messages = Vec::with_capacity(count);
    for _ in 0..count {
        let hlc = reader.text(super::clock::HLC_ENCODED_LEN)?;
        let kind = MessageKind::from_tag(reader.u8()?).ok_or(SegmentError::Malformed)?;

        let table_len = reader.u16()? as usize;
        let table_name = reader.text(table_len)?;
        if table_name.is_empty() {
            return Err(SegmentError::Malformed);
        }

        let row_uuid = reader.uuid()?;

        let column_len = reader.u16()?;
        let column_name = if column_len == ABSENT_U16 {
            None
        } else {
            Some(reader.text(column_len as usize)?)
        };

        let cause_uuid = match reader.u8()? {
            0 => None,
            1 => Some(reader.uuid()?),
            _ => return Err(SegmentError::Malformed),
        };

        let payload_len = reader.u32()?;
        let payload = if payload_len == ABSENT_U32 {
            None
        } else {
            Some(reader.take(payload_len as usize)?.to_vec())
        };

        messages.push(SegmentMessage {
            hlc,
            kind,
            table_name,
            row_uuid,
            column_name,
            cause_uuid,
            payload,
        });
    }

    if reader.at != bytes.len() {
        return Err(SegmentError::Malformed);
    }

    Ok(messages)
}

// --------------------------------------------------------------------------------------------
// Cutting and shipping
// --------------------------------------------------------------------------------------------

/// A segment built from the log and ready to upload, plus the log rows it covers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CutSegment {
    pub install: String,
    pub seq: i64,
    /// The `sync_log` ids this segment covers, in idx order. Local-only: the wire carries positions.
    pub message_ids: Vec<i64>,
    pub payload_bytes: usize,
    pub object: Vec<u8>,
}

impl CutSegment {
    pub fn key(&self) -> String {
        segment_key(&self.install, self.seq)
    }

}

/// Builds the next segment of `install` from the unshipped tail, or `None` when there is nothing to
/// ship.
///
/// READ-ONLY, and that is the crash-recovery design: everything it returns is a pure function of
/// the stored rows, so re-running it after a crash between the PUT and the shipping mark produces
/// the same `seq`, the same messages and therefore the same bytes. The create-only PUT then reports
/// `AlreadyStored` and the mark completes what the crash interrupted.
pub fn cut(
    conn: &Connection,
    install: &str,
    schema_version: u32,
) -> Result<Option<CutSegment>, AppError> {
    let tail = sync_segment::unshipped(conn, install, SEGMENT_MAX_MESSAGES)?;
    if tail.is_empty() {
        return Ok(None);
    }

    let seq = sync_segment::next_seq(conn, install)?;
    let (message_ids, messages) = bounded_batch(tail)?;
    let payload = encode_payload(install, seq, &messages);
    let digest: [u8; 32] = Sha256::digest(&payload).into();

    let compressed =
        zstd::encode_all(payload.as_slice(), SEGMENT_COMPRESSION_LEVEL).map_err(|error| {
            AppError::Database {
                message: format!("a sync segment could not be compressed: {error}"),
            }
        })?;

    Ok(Some(CutSegment {
        install: install.to_string(),
        seq,
        message_ids,
        payload_bytes: payload.len(),
        // The hash is over the UNCOMPRESSED payload, like the snapshot's: verification then proves
        // the MESSAGES rather than the particular compression this build produced.
        object: ObjectHeader::new(schema_version, digest).frame(&compressed),
    }))
}

/// Trims the tail to the byte cap and converts it to wire messages, keeping at least one message so
/// a single oversized message cannot wedge the queue forever.
fn bounded_batch(tail: Vec<UnshippedMessage>) -> Result<(Vec<i64>, Vec<SegmentMessage>), AppError> {
    let mut ids = Vec::with_capacity(tail.len());
    let mut messages = Vec::with_capacity(tail.len());
    let mut bytes = 0usize;

    for row in tail {
        let size = MIN_MESSAGE_BYTES
            + row.table_name.len()
            + row.column_name.as_ref().map_or(0, String::len)
            + row.payload.as_ref().map_or(0, Vec::len);
        if !messages.is_empty() && bytes + size > SEGMENT_MAX_PAYLOAD_BYTES {
            break;
        }
        bytes += size;

        ids.push(row.id);
        messages.push(wire_message(row)?);
    }

    Ok((ids, messages))
}

pub(crate) fn wire_message(row: UnshippedMessage) -> Result<SegmentMessage, AppError> {
    let malformed = |what: &str| AppError::Database {
        message: format!("a sync_log row holds a {what} the segment writer cannot encode"),
    };

    Ok(SegmentMessage {
        kind: MessageKind::parse(&row.kind).ok_or_else(|| malformed("kind"))?,
        row_uuid: row.row_uuid.try_into().map_err(|_| malformed("row uuid"))?,
        cause_uuid: match row.cause_uuid {
            Some(cause) => Some(cause.try_into().map_err(|_| malformed("cause uuid"))?),
            None => None,
        },
        hlc: row.hlc,
        table_name: row.table_name,
        column_name: row.column_name,
        payload: row.payload,
    })
}

/// Uploads a cut segment create-only (AD-6). `true` means these bytes were written by this call.
///
/// An existing key holding the same content is success, which is what makes a re-cut after a crash
/// idempotent; a differing content hash is `StoreError::ContentHashMismatch`, which AD-6 defines as
/// an install-id collision and the port already raises.
pub async fn ship<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    cut: &CutSegment,
) -> Result<bool, SegmentError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    match store.put_immutable(&cut.key(), cut.object.clone()).await? {
        ImmutablePut::Created { .. } => Ok(true),
        ImmutablePut::AlreadyStored { .. } => Ok(false),
    }
}

/// Records that the segment's rows are shipped. Only ever called after the PUT returned `Ok`.
pub fn mark_shipped(conn: &Connection, cut: &CutSegment) -> Result<usize, AppError> {
    let assignments: Vec<(i64, i64)> = cut
        .message_ids
        .iter()
        .enumerate()
        .map(|(idx, id)| (*id, idx as i64))
        .collect();

    sync_segment::mark_shipped(conn, cut.seq, &assignments)
}

/// A segment object whose header, hash, schema version and addressing have all been checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedSegment {
    pub schema_version: u32,
    pub messages: Vec<SegmentMessage>,
}

/// Checks a stored segment and returns the messages it carries, in idx order.
///
/// `#[cfg(test)]`: production always states the ceiling its HOST reports, so that version skew is
/// one decision in one place (AD-11). A test that is not about skew wants today's build.
#[cfg(test)]
pub fn read_segment(
    object: &[u8],
    install: &str,
    seq: i64,
) -> Result<VerifiedSegment, SegmentError> {
    let supported = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);

    read_segment_for(object, install, seq, supported)
}

/// The same check against a stated schema ceiling.
///
/// Separate so the actor can pass the ceiling its HOST reports (AD-11): "this build is older than
/// the sender" is the whole of version skew, and a test cannot otherwise stand an old computer up
/// next to a new one without two builds.
pub fn read_segment_for(
    object: &[u8],
    install: &str,
    seq: i64,
    supported: u32,
) -> Result<VerifiedSegment, SegmentError> {
    let (header, compressed) = ObjectHeader::parse(object)?;

    // Before decompressing: an object this build cannot apply should cost nothing to refuse.
    if header.schema_version > supported {
        return Err(SegmentError::SchemaTooNew {
            found: header.schema_version,
            supported,
        });
    }

    let payload = decode_bounded(compressed)?;
    let digest: [u8; 32] = Sha256::digest(&payload).into();
    if digest != header.content_sha256 {
        return Err(SegmentError::HashMismatch {
            expected: hex_lower(&header.content_sha256),
            found: hex_lower(&digest),
        });
    }

    Ok(VerifiedSegment {
        schema_version: header.schema_version,
        messages: decode_payload(&payload, install, seq)?,
    })
}

fn decode_bounded(compressed: &[u8]) -> Result<Vec<u8>, SegmentError> {
    use std::io::Read;

    let mut decoder =
        zstd::stream::read::Decoder::new(compressed).map_err(|_| SegmentError::Corrupt)?;
    let mut payload = Vec::new();
    let read = decoder
        .by_ref()
        .take(MAX_READ_PAYLOAD_BYTES as u64 + 1)
        .read_to_end(&mut payload)
        .map_err(|_| SegmentError::Corrupt)?;

    if read > MAX_READ_PAYLOAD_BYTES {
        return Err(SegmentError::Corrupt);
    }

    Ok(payload)
}

// --------------------------------------------------------------------------------------------
// Heads
// --------------------------------------------------------------------------------------------

/// What `head/<install>` holds: how far that install's segments go.
///
/// The SEGMENT KEY is DERIVED from the two fields rather than stored beside them — a deliberate
/// deviation from the story's wording, and the same decision `LatestSnapshot::snapshot_key` made: a
/// key read out of a document another computer wrote is untrusted input that would be concatenated
/// into a request, while `(install, seq)` is validated here and the key is a pure function of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    pub install: String,
    pub seq: i64,
}

impl Head {
    /// Compact JSON with sorted keys, hand-written for the same reason as `snap/LATEST`: the exact
    /// spelling is a wire contract between app versions, and a derived `Serialize` would let a
    /// field rename silently change the bytes.
    pub fn body(&self) -> Vec<u8> {
        format!(
            "{{\"install\":\"{}\",\"seq\":{},\"v\":{HEAD_VERSION}}}",
            self.install, self.seq
        )
        .into_bytes()
    }

    pub fn parse(bytes: &[u8]) -> Result<Self, SegmentError> {
        let document: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| SegmentError::Malformed)?;

        let version = document.get("v").and_then(serde_json::Value::as_u64);
        if version != Some(u64::from(HEAD_VERSION)) {
            return Err(SegmentError::UnknownPayloadVersion {
                found: u16::try_from(version.unwrap_or(0)).unwrap_or(u16::MAX),
            });
        }

        let install = document
            .get("install")
            .and_then(serde_json::Value::as_str)
            .ok_or(SegmentError::Malformed)?;
        if !is_install_id(install) {
            return Err(SegmentError::Malformed);
        }

        let seq = document
            .get("seq")
            .and_then(serde_json::Value::as_i64)
            .filter(|seq| *seq >= 0)
            .ok_or(SegmentError::Malformed)?;

        Ok(Self {
            install: install.to_string(),
            seq,
        })
    }

    // Story 23's retention reads a head to find the watermark it may delete up to.
    #[allow(dead_code)]
    pub fn segment_key(&self) -> String {
        segment_key(&self.install, self.seq)
    }
}

/// Publishes this install's head, which is a single-writer mutable key (AD-6).
///
/// `known` is the ETag this install last wrote; `None` is the first publish, which is create-only.
/// A lost precondition is re-read and retried ONCE rather than overwritten: this install is the
/// only legitimate writer, so a 412 means the object is not what this computer believes, and
/// adopting the current ETag is the only way to make the next write a compare-and-swap again.
pub async fn publish_head<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    head: &Head,
    known: Option<&ETag>,
) -> Result<ETag, SegmentError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    let key = head_key(&head.install);

    let first = match known {
        Some(expected) => store.put_if_match(&key, expected, head.body()).await,
        None => store.put_if_absent(&key, head.body()).await,
    };

    match first {
        Ok(etag) => Ok(etag),
        Err(GatedError::Store(
            StoreError::PreconditionFailed | StoreError::ConditionalConflict | StoreError::NotFound,
        )) => {
            let current = store.head(&key).await?;

            Ok(store.put_if_match(&key, &current.etag, head.body()).await?)
        }
        Err(error) => Err(SegmentError::Store(error)),
    }
}

// --------------------------------------------------------------------------------------------
// Roster
// --------------------------------------------------------------------------------------------

/// Which installs exist on this account (AD-6). Sorted and de-duplicated, so the same membership
/// always produces the same bytes and a merge is order-independent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Roster {
    pub installs: Vec<String>,
}

impl Roster {
    /// The roster that holds exactly `installs`, sorted and de-duplicated. Used by AD-13's prune,
    /// which is the only caller that makes a roster SMALLER.
    pub fn of(installs: impl IntoIterator<Item = String>) -> Self {
        Self::normalized(installs)
    }

    fn normalized(installs: impl IntoIterator<Item = String>) -> Self {
        let unique: BTreeSet<String> = installs.into_iter().filter(|id| is_install_id(id)).collect();

        Self {
            installs: unique.into_iter().collect(),
        }
    }

    pub fn body(&self) -> Vec<u8> {
        let list = self
            .installs
            .iter()
            .map(|install| format!("\"{install}\""))
            .collect::<Vec<_>>()
            .join(",");

        format!("{{\"installs\":[{list}],\"v\":{ROSTER_VERSION}}}").into_bytes()
    }

    /// An entry that is not an install id is DROPPED rather than refused: the roster is written by
    /// every computer, and one malformed member must not make the account undiscoverable for all of
    /// them.
    pub fn parse(bytes: &[u8]) -> Result<Self, SegmentError> {
        let document: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| SegmentError::Malformed)?;

        if document.get("v").and_then(serde_json::Value::as_u64) != Some(u64::from(ROSTER_VERSION)) {
            return Err(SegmentError::Malformed);
        }

        let installs = document
            .get("installs")
            .and_then(serde_json::Value::as_array)
            .ok_or(SegmentError::Malformed)?
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_string);

        Ok(Roster::normalized(installs))
    }

    pub fn contains(&self, install: &str) -> bool {
        self.installs.iter().any(|known| known == install)
    }

    fn with(&self, install: &str) -> Self {
        Roster::normalized(
            self.installs
                .iter()
                .cloned()
                .chain(std::iter::once(install.to_string())),
        )
    }
}

/// Adds `install` to the roster of `epoch` by compare-and-swap, merging whatever it finds (AD-6).
///
/// The merge is a UNION, which is what makes a race benign: the loser of a 412 re-reads, sees the
/// winner's list, adds itself to THAT and writes again, so both end up in the roster rather than
/// one replacing the other.
pub async fn join_roster<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    install: &str,
    epoch: u64,
) -> Result<Roster, SegmentError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    let key = roster_key(epoch);

    for _ in 0..ROSTER_CAS_ATTEMPTS {
        let current = match store.get(&key).await {
            Ok(stored) => Some((Roster::parse(&stored.bytes)?, stored.meta.etag)),
            Err(GatedError::Store(StoreError::NotFound)) => None,
            Err(error) => return Err(SegmentError::Store(error)),
        };

        let written = match &current {
            Some((roster, _)) if roster.contains(install) => return Ok(roster.clone()),
            Some((roster, etag)) => {
                let merged = roster.with(install);
                store
                    .put_if_match(&key, etag, merged.body())
                    .await
                    .map(|_| merged)
            }
            None => {
                let mine = Roster::normalized([install.to_string()]);
                store
                    .put_if_absent(&key, mine.body())
                    .await
                    .map(|_| mine)
            }
        };

        match written {
            Ok(roster) => return Ok(roster),
            // Someone else wrote it between the read and the write. Re-read and merge again; that
            // is the whole compare-and-swap, and it is why nobody's membership is lost.
            Err(GatedError::Store(
                StoreError::PreconditionFailed
                | StoreError::ConditionalConflict
                | StoreError::NotFound,
            )) => continue,
            Err(error) => return Err(SegmentError::Store(error)),
        }
    }

    Err(SegmentError::Store(GatedError::Store(
        StoreError::ConditionalConflict,
    )))
}

// --------------------------------------------------------------------------------------------
// Polling
// --------------------------------------------------------------------------------------------

/// Where one remote install's fetch stands.
#[derive(Debug, Default)]
struct InstallCursor {
    /// The ETag of the head this computer last read, so the next read is a conditional GET.
    head_etag: Option<ETag>,
    /// The highest seq that head claimed.
    head_seq: Option<i64>,
    /// The next seq this computer owes the applier.
    next_seq: i64,
    /// Fetched but not yet handed on, because a lower seq is still missing. Ordered, so releasing
    /// the contiguous prefix is a walk from `next_seq`.
    buffered: BTreeMap<i64, Vec<SegmentMessage>>,
    /// Gaps already probed, so a persistent gap costs one repair probe and not one per poll.
    probed: BTreeSet<i64>,
    /// Segments PARKED for version skew (AD-11), each with the schema version it needs.
    ///
    /// Parking is "kept, not applied, not dropped, not quarantined": the segment object is
    /// immutable in the account (AD-6), so the cloud copy IS the durable park and nothing has to
    /// be written locally. `next_seq` deliberately does not move past a parked seq — every later
    /// segment of a newer build carries the same newer version, and AD-11 applies an install's
    /// segments in contiguous order — so this install's stream resumes exactly where it stopped
    /// once the app has been updated. Re-requesting is suppressed until the ceiling reaches the
    /// version the segment needs, which is why a stale build costs no extra GET per poll.
    parked: BTreeMap<i64, u32>,
}

/// Everything the pull side remembers between polls: the roster ETag, the roster itself, and one
/// cursor per remote install.
///
/// IN MEMORY and not a table, recorded as a decision: the durable record of progress is
/// `sync_applied_vector`, which only Story 20's apply advances, in the same transaction as the
/// data. A second durable record of "fetched but not applied" could disagree with it after a crash,
/// and re-fetching a segment is one GET of an immutable object.
#[derive(Debug, Default)]
pub(crate) struct PullCursor {
    roster_etag: Option<ETag>,
    roster: Roster,
    installs: HashMap<String, InstallCursor>,
}

/// What one poll cost and what it moved. Counts only (AD-16).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct PollReport {
    pub conditional_gets: u64,
    pub segments_fetched: u64,
    pub batches_applied: u64,
    pub messages_applied: u64,
    /// Segments the head claims and the store does not have yet, holding later ones back.
    pub gaps: u64,
    /// Every `(install, seq)` a GET answered `NotFound` for. The pull side cannot tell "not
    /// visible yet" from "reclaimed by AD-13" on its own — the manager decides, by comparing the
    /// seq with the current snapshot's watermark.
    pub unfillable_gaps: Vec<(String, i64)>,
    /// Repair-path probes. Zero on every normal poll; a test asserts that.
    pub repairs: u64,
}

impl PullCursor {
    pub fn knows(&self, install: &str) -> bool {
        self.installs.contains_key(install)
    }

    /// Starts tracking an install at the seq it owes next, which is one past whatever the apply
    /// path has already written for it.
    pub fn start(&mut self, install: &str, next_seq: i64) {
        self.installs.insert(
            install.to_string(),
            InstallCursor {
                next_seq,
                ..InstallCursor::default()
            },
        );
    }

    #[cfg(test)]
    pub fn next_seq(&self, install: &str) -> Option<i64> {
        self.installs.get(install).map(|cursor| cursor.next_seq)
    }

    /// Every parked segment this cursor is holding, oldest install-then-seq first, so the unpark
    /// pass applies them in exactly the order AD-11 requires.
    pub fn parked(&self) -> Vec<(String, i64, u32)> {
        let mut parked: Vec<(String, i64, u32)> = self
            .installs
            .iter()
            .flat_map(|(install, cursor)| {
                cursor
                    .parked
                    .iter()
                    .map(move |(seq, version)| (install.clone(), *seq, *version))
            })
            .collect();
        parked.sort();

        parked
    }

    /// How many segments are parked for version skew. Counts only (AD-16).
    pub fn parked_count(&self) -> u64 {
        self.installs
            .values()
            .map(|cursor| cursor.parked.len() as u64)
            .sum()
    }

    #[cfg(test)]
    pub fn buffered(&self, install: &str) -> usize {
        self.installs
            .get(install)
            .map_or(0, |cursor| cursor.buffered.len())
    }

    /// Forgets every head ETag, which makes the next poll re-read the heads in full. The one state
    /// a test cannot otherwise arrange: a head re-delivered after it has already been consumed.
    #[cfg(test)]
    pub fn forget_head_etags(&mut self) {
        for cursor in self.installs.values_mut() {
            cursor.head_etag = None;
        }
    }
}

/// Reads the roster with a conditional GET and answers with the remote installs it names.
///
/// `304` is the steady-state answer and costs one billed GET with no body, which is the whole
/// reason the cadence is bounded by `SyncTuning`.
pub(crate) async fn poll_roster<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    cursor: &mut PullCursor,
    self_install: &str,
    epoch: u64,
    report: &mut PollReport,
) -> Result<Vec<String>, SegmentError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    report.conditional_gets += 1;
    let key = roster_key(epoch);

    let fetched = match &cursor.roster_etag {
        Some(etag) => match store.get_if_none_match(&key, etag).await {
            Ok(ConditionalGet::NotModified) => None,
            Ok(ConditionalGet::Modified(stored)) => Some(stored),
            // The roster this computer knew is gone: forget the ETag so the next poll reads it in
            // full rather than conditionally against a token nothing holds.
            Err(GatedError::Store(StoreError::NotFound)) => {
                cursor.roster_etag = None;
                cursor.roster = Roster::default();
                None
            }
            Err(error) => return Err(SegmentError::Store(error)),
        },
        None => match store.get(&key).await {
            Ok(stored) => Some(stored),
            // No computer has published a roster yet, which is the ordinary state of a brand-new
            // account: not a fault, and not worth a repair probe.
            Err(GatedError::Store(StoreError::NotFound)) => None,
            Err(error) => return Err(SegmentError::Store(error)),
        },
    };

    if let Some(stored) = fetched {
        cursor.roster = Roster::parse(&stored.bytes)?;
        cursor.roster_etag = Some(stored.meta.etag);
    }

    Ok(cursor
        .roster
        .installs
        .iter()
        .filter(|install| *install != self_install)
        .cloned()
        .collect())
}

/// Reads each known head conditionally, fetches whatever its install advanced to, and hands the
/// contiguous prefix of each install to the applier.
///
/// Three rules, each a hazard the simulator already names. A gap HOLDS BACK every later segment:
/// they are fetched and buffered so they are ready the moment the missing one arrives, but nothing
/// above a gap is handed on. A segment at or below `next_seq` is never requested, which is how a
/// re-delivered head is idempotent. And an applier `Err` leaves `next_seq` where it was, so a
/// refused batch stays owed.
pub(crate) async fn poll_heads<S, L, C, T>(
    store: &GatedStore<S, SyncGate<L, C, T>>,
    cursor: &mut PullCursor,
    installs: &[String],
    applier: &mut dyn Applier,
    supported_schema: u32,
    report: &mut PollReport,
) -> Result<(), SegmentError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    for install in installs {
        let Some(state) = cursor.installs.get_mut(install) else {
            continue;
        };

        report.conditional_gets += 1;
        let key = head_key(install);

        let fetched = match &state.head_etag {
            Some(etag) => match store.get_if_none_match(&key, etag).await {
                Ok(ConditionalGet::NotModified) => None,
                Ok(ConditionalGet::Modified(stored)) => Some(stored),
                Err(GatedError::Store(StoreError::NotFound)) => {
                    state.head_etag = None;
                    report.repairs += 1;
                    // AD-6's repair path, used exactly here: the roster names this install and its
                    // head is gone, which is the one case where "absent" has to be told from
                    // "denied" before anything is concluded about it.
                    store.exists(&key).await?;
                    None
                }
                Err(error) => return Err(SegmentError::Store(error)),
            },
            None => match store.get(&key).await {
                Ok(stored) => Some(stored),
                Err(GatedError::Store(StoreError::NotFound)) => {
                    report.repairs += 1;
                    store.exists(&key).await?;
                    None
                }
                Err(error) => return Err(SegmentError::Store(error)),
            },
        };

        if let Some(stored) = fetched {
            let head = Head::parse(&stored.bytes)?;
            if head.install != *install {
                return Err(SegmentError::Misaddressed);
            }
            state.head_seq = Some(head.seq);
            state.head_etag = Some(stored.meta.etag);
        }

        // A parked segment whose version this build has since caught up with stops being parked:
        // the next fetch below picks it up again and applies it (AD-11's "after the app updates").
        state
            .parked
            .retain(|_, required| *required > supported_schema);

        if let Some(target) = state.head_seq {
            for seq in state.next_seq..=target {
                if state.buffered.contains_key(&seq) {
                    continue;
                }
                // Still beyond this build: not requested again, and nothing above it either —
                // every later segment of a newer build carries the same newer version.
                // The cursor is the one record of what is parked (the manager reads it for the
                // `update_needed` state), so the report deliberately does not carry a second copy.
                if state.parked.contains_key(&seq) {
                    break;
                }

                match store.get(&segment_key(install, seq)).await {
                    Ok(stored) => {
                        match read_segment_for(&stored.bytes, install, seq, supported_schema) {
                            Ok(verified) => {
                                state.buffered.insert(seq, verified.messages);
                                report.segments_fetched += 1;
                            }
                            // AD-11: PARKED, not dropped and not quarantined. The object stays in
                            // the account, this install's stream stops here, and every OTHER
                            // install keeps syncing — which is what "the rest of sync this build
                            // understands keeps working" has to mean.
                            Err(SegmentError::SchemaTooNew { found, .. }) => {
                                state.parked.insert(seq, found);
                                break;
                            }
                            Err(error) => return Err(error),
                        }
                    }
                    // A gap, not a failure: the head moved before the object became visible, or an
                    // earlier segment is still in flight. Later ones keep being fetched so they are
                    // already held when the missing one lands.
                    Err(GatedError::Store(StoreError::NotFound)) => {
                        report.gaps += 1;
                        report.unfillable_gaps.push((install.clone(), seq));
                        if state.probed.insert(seq) {
                            report.repairs += 1;
                            store.exists(&segment_key(install, seq)).await?;
                        }
                    }
                    Err(error) => return Err(SegmentError::Store(error)),
                }
            }
        }

        while let Some(messages) = state.buffered.remove(&state.next_seq) {
            let batch = SegmentBatch {
                install: install.clone(),
                seq: state.next_seq,
                messages,
            };

            let applied = applier.apply(&batch).map_err(|_| SegmentError::Apply)?;

            state.probed.remove(&state.next_seq);
            state.next_seq += 1;
            report.batches_applied += 1;
            report.messages_applied += applied as u64;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const INSTALL: &str = "0123456789abcdef";

    fn message(counter: u8) -> SegmentMessage {
        SegmentMessage {
            hlc: format!("{:016x}-{INSTALL}", u64::from(counter)),
            kind: MessageKind::Field,
            table_name: "accounts".to_string(),
            row_uuid: [counter; 16],
            column_name: Some("*".to_string()),
            cause_uuid: None,
            payload: Some(vec![1, 2, 3, counter]),
        }
    }

    #[test]
    fn a_payload_round_trips_every_kind_and_every_optional_field() {
        let messages = vec![
            message(1),
            SegmentMessage {
                hlc: format!("{:016x}-{INSTALL}", 2u64),
                kind: MessageKind::Tombstone,
                table_name: "income_entries".to_string(),
                row_uuid: [2; 16],
                column_name: None,
                cause_uuid: None,
                payload: None,
            },
            SegmentMessage {
                hlc: format!("{:016x}-{INSTALL}", 3u64),
                kind: MessageKind::BalanceDelta,
                table_name: "accounts".to_string(),
                row_uuid: [3; 16],
                column_name: None,
                cause_uuid: Some([9; 16]),
                payload: Some(vec![1, 0, 0, 0, 0, 0, 0, 0, 100]),
            },
            SegmentMessage {
                hlc: format!("{:016x}-{INSTALL}", 4u64),
                kind: MessageKind::CounterDelta,
                table_name: "merchant_category_hints".to_string(),
                row_uuid: [4; 16],
                column_name: Some("usage_count".to_string()),
                cause_uuid: None,
                payload: Some(Vec::new()),
            },
        ];

        let encoded = encode_payload(INSTALL, 7, &messages);

        assert_eq!(
            decode_payload(&encoded, INSTALL, 7).expect("it decodes"),
            messages
        );
    }

    /// The golden test. A change to the layout, the tag numbers, the field order, the endianness or
    /// the padding breaks this literal instead of silently splitting two builds' segments apart.
    #[test]
    fn the_segment_payload_encoding_is_frozen() {
        let encoded = encode_payload(INSTALL, 1, &[message(5)]);

        assert_eq!(
            hex_lower(&encoded),
            concat!(
                // payload version 1
                "0001",
                // install "0123456789abcdef"
                "30313233343536373839616263646566",
                // seq 1
                "0000000000000001",
                // one message
                "00000001",
                // hlc "0000000000000005-0123456789abcdef"
                "30303030303030303030303030303035",
                "2d",
                "30313233343536373839616263646566",
                // kind tag 1 (field)
                "01",
                // table name "accounts"
                "0008",
                "6163636f756e7473",
                // row uuid
                "05050505050505050505050505050505",
                // column name "*"
                "0001",
                "2a",
                // no cause
                "00",
                // payload [1, 2, 3, 5]
                "00000004",
                "01020305",
            ),
            "the payload encoding is frozen with the object format version"
        );
        assert_eq!(SEGMENT_PAYLOAD_VERSION, 1);
        assert_eq!(SEGMENT_COMPRESSION_LEVEL, 3);
    }

    #[test]
    fn a_payload_version_this_build_does_not_know_is_refused_cleanly() {
        let mut encoded = encode_payload(INSTALL, 0, &[message(1)]);
        encoded[1] = 2;

        assert_eq!(
            decode_payload(&encoded, INSTALL, 0),
            Err(SegmentError::UnknownPayloadVersion { found: 2 })
        );
    }

    #[test]
    fn a_payload_that_names_another_install_or_seq_is_refused() {
        let encoded = encode_payload(INSTALL, 3, &[message(1)]);

        assert_eq!(
            decode_payload(&encoded, "fedcba9876543210", 3),
            Err(SegmentError::Misaddressed)
        );
        assert_eq!(
            decode_payload(&encoded, INSTALL, 4),
            Err(SegmentError::Misaddressed)
        );
    }

    /// Every cut of the bytes has to be an error rather than a panic: this is another computer's
    /// object, and Story 20 writes what comes out of it into the user's tables.
    #[test]
    fn every_truncation_of_a_payload_is_refused_rather_than_panicked_on() {
        let encoded = encode_payload(INSTALL, 0, &[message(1), message(2)]);

        for cut in 0..encoded.len() {
            assert!(
                decode_payload(&encoded[..cut], INSTALL, 0).is_err(),
                "a payload cut at {cut} bytes must be refused"
            );
        }

        let mut trailing = encoded.clone();
        trailing.push(0);
        assert_eq!(
            decode_payload(&trailing, INSTALL, 0),
            Err(SegmentError::Malformed)
        );

        let mut bad_kind = encoded;
        // The kind tag sits right after the 33-byte hlc of the first message.
        bad_kind[2 + 16 + 8 + 4 + 33] = 99;
        assert_eq!(
            decode_payload(&bad_kind, INSTALL, 0),
            Err(SegmentError::Malformed)
        );
    }

    #[test]
    fn a_count_no_payload_could_satisfy_is_refused_before_anything_is_reserved() {
        let mut encoded = encode_payload(INSTALL, 0, &[message(1)]);
        encoded[2 + 16 + 8..2 + 16 + 8 + 4].copy_from_slice(&u32::MAX.to_be_bytes());

        assert_eq!(
            decode_payload(&encoded, INSTALL, 0),
            Err(SegmentError::Malformed)
        );
    }

    #[test]
    fn a_segment_key_is_fixed_width_so_a_listing_orders_like_the_sequence() {
        let mut keys = [
            segment_key(INSTALL, 10),
            segment_key(INSTALL, 9),
            segment_key(INSTALL, 0),
        ];
        keys.sort();

        assert_eq!(
            keys,
            [
                segment_key(INSTALL, 0),
                segment_key(INSTALL, 9),
                segment_key(INSTALL, 10)
            ]
        );
        assert_eq!(
            segment_key(INSTALL, 9),
            "log/0123456789abcdef/0000000000000009"
        );
        assert_eq!(head_key(INSTALL), "head/0123456789abcdef");
    }

    #[test]
    fn a_head_round_trips_and_refuses_anything_it_cannot_trust() {
        let head = Head {
            install: INSTALL.to_string(),
            seq: 12,
        };

        assert_eq!(
            head.body(),
            br#"{"install":"0123456789abcdef","seq":12,"v":1}"#.to_vec()
        );
        assert_eq!(Head::parse(&head.body()).expect("it parses"), head);
        assert_eq!(head.segment_key(), "log/0123456789abcdef/0000000000000012");

        for refused in [
            &br#"{"install":"0123456789abcdef","seq":-1,"v":1}"#[..],
            &br#"{"install":"../other","seq":1,"v":1}"#[..],
            &br#"{"install":"0123456789abcdef","v":1}"#[..],
            &b"not json"[..],
        ] {
            assert!(
                Head::parse(refused).is_err(),
                "a head this computer cannot trust must be refused"
            );
        }

        assert_eq!(
            Head::parse(br#"{"install":"0123456789abcdef","seq":1,"v":2}"#),
            Err(SegmentError::UnknownPayloadVersion { found: 2 })
        );
    }

    #[test]
    fn a_roster_is_sorted_de_duplicated_and_merges_by_union() {
        let roster = Roster::normalized([
            "fedcba9876543210".to_string(),
            INSTALL.to_string(),
            INSTALL.to_string(),
            "not-an-install".to_string(),
        ]);

        assert_eq!(
            roster.installs,
            vec![
                "0123456789abcdef".to_string(),
                "fedcba9876543210".to_string()
            ]
        );
        assert_eq!(
            roster.body(),
            br#"{"installs":["0123456789abcdef","fedcba9876543210"],"v":1}"#.to_vec()
        );
        assert_eq!(Roster::parse(&roster.body()).expect("it parses"), roster);

        let merged = roster.with("aaaaaaaaaaaaaaaa");
        assert_eq!(merged.installs.len(), 3);
        assert!(merged.contains(INSTALL), "a merge never drops a member");
        assert_eq!(
            merged.with(INSTALL),
            merged,
            "adding a member twice is a no-op"
        );

        assert!(
            Roster::parse(br#"{"installs":[],"v":9}"#).is_err(),
            "a roster version this build does not know is refused"
        );
    }
}
