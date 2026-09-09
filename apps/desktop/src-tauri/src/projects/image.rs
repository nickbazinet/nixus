//! Validation for the single image a project card displays, and the downscaled derivative
//! the project list renders.
//!
//! Validation is deliberately stricter than `ai::attachment`, and deliberately independent
//! of it: that boundary accepts documents and trusts the extension alone, while a project
//! image must be provably a PNG or a JPEG whose declared pixel count the webview can
//! actually decode. The validation half parses only the container header, by hand, so a
//! file is accepted or refused without any pixel data being decoded.
//!
//! `thumbnail` is the one place that does decode pixels, because a real PNG or JPEG cannot
//! be resampled by hand safely.

use std::fs::File;
use std::io::{Cursor, Read};
use std::path::Path;

use image::imageops::FilterType;
use image::{load_from_memory_with_format, DynamicImage, ImageFormat};

use crate::error::AppError;

/// The stored blob lives in SQLite alongside the rest of the dataset and is copied whole
/// by backup export and dataset migration, so the ceiling is a storage decision as much
/// as a memory one.
pub const MAX_PROJECT_IMAGE_BYTES: u64 = 4 * 1024 * 1024;

/// 12 MP is roughly a 4000x3000 phone photo. The card renders the image in a 160-192px
/// band, so a larger source buys nothing while costing about 4 bytes of decoded RGBA per
/// pixel in the webview — and a highly compressible 20000x20000 PNG can sit well under
/// the byte ceiling while still taking the renderer down in a way an `<img> onError`
/// handler cannot catch.
pub const MAX_PROJECT_IMAGE_PIXELS: u64 = 12_000_000;

/// The ceiling on one stored thumbnail. This is what makes a single batch read for the whole
/// project list bounded: ten rows cost at most 640 KiB of blob, against up to 4 MiB *per row*
/// for the full-size payload only an expanded card ever fetches.
pub const MAX_PROJECT_THUMBNAIL_BYTES: u64 = 64 * 1024;

/// The longest edge a thumbnail may have. The list renders it in a 56px tile, so 256 still has
/// headroom on a 4x display while costing a fraction of the source.
pub const THUMBNAIL_EDGE: u32 = 256;

/// The single fallback edge, reached only when re-encoding at `THUMBNAIL_EDGE` still exceeds
/// the ceiling. Halving the edge quarters the pixel count, which is the largest reduction
/// available before the tile looks soft at 2x.
const THUMBNAIL_FALLBACK_EDGE: u32 = 128;

/// The reason an image was refused, as the `field` of the returned
/// `AppError::Validation`. The frontend maps it to localized copy, so these strings are a
/// closed contract with `projectImageMessageKey` in `src/lib/appError.ts`.
const UNSUPPORTED_TYPE: &str = "project_image_unsupported_type";
const EMPTY: &str = "project_image_empty";
const TOO_LARGE: &str = "project_image_too_large";
const UNREADABLE: &str = "project_image_unreadable";
const CONTENT_MISMATCH: &str = "project_image_content_mismatch";
const DIMENSIONS: &str = "project_image_dimensions";

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const PNG_IHDR: &[u8] = b"IHDR";
const JPEG_SIGNATURE: &[u8] = b"\xFF\xD8\xFF";

/// Every JPEG marker is introduced by one or more of these.
const JPEG_FILL: u8 = 0xFF;

/// A start-of-frame segment is `length(2) + precision(1) + height(2) + width(2) +
/// component count(1)` at minimum; anything shorter cannot carry dimensions.
const JPEG_MIN_SOF_LENGTH: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectImageFormat {
    Png,
    Jpeg,
}

impl ProjectImageFormat {
    pub fn mime_type(self) -> &'static str {
        match self {
            ProjectImageFormat::Png => "image/png",
            ProjectImageFormat::Jpeg => "image/jpeg",
        }
    }

    /// The inverse of `mime_type`, so a stored row can be turned back into the format that
    /// wrote it. `None` for anything else: `project_images_mime_allowed` admits only these
    /// two, so an unknown value cannot come from this application.
    pub fn from_mime_type(mime_type: &str) -> Option<Self> {
        match mime_type {
            "image/png" => Some(ProjectImageFormat::Png),
            "image/jpeg" => Some(ProjectImageFormat::Jpeg),
            _ => None,
        }
    }
}

fn rejected(field: &str, message: &str) -> AppError {
    AppError::Validation {
        message: message.to_string(),
        field: Some(field.to_string()),
    }
}

/// One fixed message for every structural refusal. A truncated header, a wrong chunk
/// type and an undeterminable frame size are all "this is not usable image data" to the
/// user, and none of them may echo the path (AD-11).
fn content_mismatch() -> AppError {
    rejected(
        CONTENT_MISMATCH,
        "That file's contents are not a usable PNG or JPEG image.",
    )
}

fn format_for_extension(extension: &str) -> Option<ProjectImageFormat> {
    match extension.trim().trim_start_matches('.').to_lowercase().as_str() {
        "png" => Some(ProjectImageFormat::Png),
        "jpg" | "jpeg" => Some(ProjectImageFormat::Jpeg),
        _ => None,
    }
}

fn format_for_path(path: &Path) -> Result<ProjectImageFormat, AppError> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(format_for_extension)
        .ok_or_else(|| {
            rejected(
                UNSUPPORTED_TYPE,
                "That file type cannot be used as a project image.",
            )
        })
}

/// Validates the selected path without reading its contents, returning the basename the
/// picker displays.
///
/// The basename crosses IPC into volatile React state only; it is never persisted from
/// here, and no directory component ever leaves this function (AD-11).
pub fn inspect(file_path: &str) -> Result<String, AppError> {
    let path = Path::new(file_path);
    format_for_path(path)?;

    let metadata = std::fs::metadata(path)
        .map_err(|_| rejected(UNREADABLE, "That file could not be read."))?;

    if !metadata.is_file() {
        return Err(rejected(UNREADABLE, "That file could not be read."));
    }

    let size = metadata.len();
    if size == 0 {
        return Err(rejected(EMPTY, "That file is empty."));
    }
    if size > MAX_PROJECT_IMAGE_BYTES {
        return Err(rejected(TOO_LARGE, "That image is larger than 4 MB."));
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .ok_or_else(|| rejected(UNREADABLE, "That file could not be read."))
}

/// Re-validates, reads, and proves the bytes really are the format the extension claims.
///
/// The metadata pass runs first so an enormous file is refused without being
/// materialized, and the read itself is bounded to one byte past the ceiling so a file
/// that grew between `inspect` and here is never fully buffered — that extra byte is
/// what makes the length check able to see the growth.
pub fn read(file_path: &str) -> Result<(ProjectImageFormat, Vec<u8>), AppError> {
    let format = format_for_path(Path::new(file_path))?;
    inspect(file_path)?;

    let file =
        File::open(file_path).map_err(|_| rejected(UNREADABLE, "That file could not be read."))?;
    let mut bytes = Vec::new();
    file.take(MAX_PROJECT_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| rejected(UNREADABLE, "That file could not be read."))?;

    if bytes.is_empty() {
        return Err(rejected(EMPTY, "That file is empty."));
    }
    if bytes.len() as u64 > MAX_PROJECT_IMAGE_BYTES {
        return Err(rejected(TOO_LARGE, "That image is larger than 4 MB."));
    }

    let signature = match format {
        ProjectImageFormat::Png => PNG_SIGNATURE,
        ProjectImageFormat::Jpeg => JPEG_SIGNATURE,
    };
    if bytes.get(..signature.len()) != Some(signature) {
        return Err(content_mismatch());
    }

    let (width, height) = match format {
        ProjectImageFormat::Png => png_dimensions(&bytes)?,
        ProjectImageFormat::Jpeg => jpeg_dimensions(&bytes)?,
    };
    if width == 0 || height == 0 {
        return Err(rejected(DIMENSIONS, "That image reports no pixel size."));
    }
    // Widened before multiplying: legal PNG dimensions such as 65536x65536 wrap a `u32`
    // product to 0, which would pass the cap in release and panic in debug.
    if u64::from(width) * u64::from(height) > MAX_PROJECT_IMAGE_PIXELS {
        return Err(rejected(
            DIMENSIONS,
            "That image is larger than 12 megapixels.",
        ));
    }

    Ok((format, bytes))
}

fn be_u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
    let raw: [u8; 2] = bytes.get(offset..offset.checked_add(2)?)?.try_into().ok()?;
    Some(u16::from_be_bytes(raw))
}

fn be_u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    let raw: [u8; 4] = bytes.get(offset..offset.checked_add(4)?)?.try_into().ok()?;
    Some(u32::from_be_bytes(raw))
}

/// IHDR is required by the spec to be the first chunk, so its type is confirmed before
/// the two big-endian `u32`s at 16..24 are trusted as dimensions.
fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), AppError> {
    if bytes.get(12..16) != Some(PNG_IHDR) {
        return Err(content_mismatch());
    }
    let width = be_u32_at(bytes, 16).ok_or_else(content_mismatch)?;
    let height = be_u32_at(bytes, 20).ok_or_else(content_mismatch)?;
    Ok((width, height))
}

/// Baseline, extended-sequential, progressive and lossless frames all declare their size
/// the same way. `0xC4` (DHT), `0xC8` (JPG) and `0xCC` (DAC) sit inside the same numeric
/// range but are not frames.
fn is_start_of_frame(marker: u8) -> bool {
    matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF)
}

/// Walks the marker segments ahead of the scan, honoring each declared length.
///
/// Fails closed: a truncated segment, a lost marker boundary, or a scan reached before
/// any frame header all refuse the file rather than falling through to acceptance. Every
/// read goes through `get`, because these run on the main thread inside a synchronous
/// Tauri command where a panic would take the window with it.
fn jpeg_dimensions(bytes: &[u8]) -> Result<(u32, u32), AppError> {
    // Past the SOI. `cursor` only ever advances, so the walk always terminates.
    let mut cursor: usize = 2;

    loop {
        // JPEG permits an arbitrary run of fill bytes before a marker; a real camera file
        // uses them, and consuming only one would mis-seek the walk into a false refusal.
        let mut marker_start = cursor;
        while bytes.get(marker_start) == Some(&JPEG_FILL) {
            marker_start = marker_start.checked_add(1).ok_or_else(content_mismatch)?;
        }
        if marker_start == cursor {
            return Err(content_mismatch());
        }
        let marker = *bytes.get(marker_start).ok_or_else(content_mismatch)?;
        cursor = marker_start.checked_add(1).ok_or_else(content_mismatch)?;

        match marker {
            // TEM and RST0-RST7 are standalone: they carry no length field at all.
            0x01 | 0xD0..=0xD7 => continue,
            // SOS ends the walk, because entropy-coded scan data contains byte pairs that
            // look like markers. EOI and a stuffed zero mean no frame header will follow.
            0xDA | 0xD9 | 0x00 => return Err(content_mismatch()),
            _ => {}
        }

        let length = usize::from(be_u16_at(bytes, cursor).ok_or_else(content_mismatch)?);
        let segment_end = cursor.checked_add(length).ok_or_else(content_mismatch)?;
        if length < 2 || segment_end > bytes.len() {
            return Err(content_mismatch());
        }

        if is_start_of_frame(marker) {
            if length < JPEG_MIN_SOF_LENGTH {
                return Err(content_mismatch());
            }
            let height = be_u16_at(bytes, cursor + 3).ok_or_else(content_mismatch)?;
            let width = be_u16_at(bytes, cursor + 5).ok_or_else(content_mismatch)?;
            return Ok((u32::from(width), u32::from(height)));
        }

        cursor = segment_end;
    }
}

fn image_format(format: ProjectImageFormat) -> ImageFormat {
    match format {
        ProjectImageFormat::Png => ImageFormat::Png,
        ProjectImageFormat::Jpeg => ImageFormat::Jpeg,
    }
}

/// Scales down only, preserving the aspect ratio. The guard is load-bearing:
/// `DynamicImage::resize` also scales *up*, so a picture already smaller than the tile would be
/// blown into a file larger than the original it was meant to shrink.
fn downscaled(decoded: &DynamicImage, edge: u32) -> DynamicImage {
    if decoded.width() <= edge && decoded.height() <= edge {
        return decoded.clone();
    }

    decoded.resize(edge, edge, FilterType::Triangle)
}

fn encoded(decoded: &DynamicImage, format: ProjectImageFormat) -> Option<Vec<u8>> {
    let mut buffer = Cursor::new(Vec::new());

    match format {
        // JPEG carries no alpha channel and its encoder refuses an RGBA buffer outright rather
        // than flattening it, so dropping this conversion makes the whole JPEG half of the
        // ladder below unreachable for any transparent PNG.
        ProjectImageFormat::Jpeg => DynamicImage::ImageRgb8(decoded.to_rgb8())
            .write_to(&mut buffer, ImageFormat::Jpeg)
            .ok()?,
        ProjectImageFormat::Png => decoded.write_to(&mut buffer, ImageFormat::Png).ok()?,
    }

    Some(buffer.into_inner())
}

/// The downscaled derivative the project list renders, with its own mime type, or `None` when
/// one could not be produced.
///
/// `None` is a valid outcome and never an error. The picture has already been validated and is
/// about to be stored, so refusing the upload because a derivative could not be made would
/// lose a file the user can see perfectly well in the expanded card; the row shows a
/// placeholder tile instead. The returned mime type is NOT always the source's — see the
/// ladder in `thumbnail_within`.
pub fn thumbnail(bytes: &[u8], format: ProjectImageFormat) -> Option<(Vec<u8>, &'static str)> {
    thumbnail_within(bytes, format, MAX_PROJECT_THUMBNAIL_BYTES)
}

/// Walks the ladder: keep the source format at full thumbnail size, then trade the source
/// format for JPEG's far smaller output, then trade resolution. Each rung must be encoded to be
/// measured, because the previous rung's size is the only thing that says it was needed.
///
/// The ceiling is a parameter purely so every rung is reachable from a test: under the
/// production 64 KiB value the last two rungs would need a fixture whose encoded size lands in
/// a narrow band no realistic image is guaranteed to hit, leaving them untested.
fn thumbnail_within(
    bytes: &[u8],
    format: ProjectImageFormat,
    ceiling: u64,
) -> Option<(Vec<u8>, &'static str)> {
    let decoded = load_from_memory_with_format(bytes, image_format(format)).ok()?;

    let mut attempted: Option<(ProjectImageFormat, u32)> = None;
    for rung in [
        (format, THUMBNAIL_EDGE),
        (ProjectImageFormat::Jpeg, THUMBNAIL_EDGE),
        (ProjectImageFormat::Jpeg, THUMBNAIL_FALLBACK_EDGE),
    ] {
        // A JPEG source makes the first two rungs the same encode.
        if attempted == Some(rung) {
            continue;
        }
        attempted = Some(rung);

        let (target, edge) = rung;
        // `continue`, not `return`: a colour type PNG refuses is exactly what the JPEG rung
        // below exists to recover from.
        let Some(candidate) = encoded(&downscaled(&decoded, edge), target) else {
            continue;
        };
        if u64::try_from(candidate.len()).is_ok_and(|size| size <= ceiling) {
            return Some((candidate, target.mime_type()));
        }
    }

    None
}

/// Shared test fixture: a genuinely decodable image, unlike the header stubs the validator tests
/// build. It lives outside `mod tests` because the command layer proves the batch read and the
/// lazy backfill against real pixel data and must use the same fixture rather than its own.
///
/// `noise` fills every pixel from a cheap deterministic hash of its coordinates, which is what
/// forces a large encoded size — a flat colour compresses to almost nothing in both formats and
/// could never reach the ceiling.
#[cfg(test)]
pub(crate) fn rendered_test_image(
    width: u32,
    height: u32,
    noise: bool,
    format: ProjectImageFormat,
) -> Vec<u8> {
    let pixels = image::RgbImage::from_fn(width, height, |x, y| {
        if !noise {
            return image::Rgb([16, 32, 48]);
        }
        let mixed = (x.wrapping_mul(2_654_435_761) ^ y.wrapping_mul(40_503)).to_le_bytes();
        image::Rgb([mixed[0], mixed[1], mixed[2]])
    });

    encoded(&DynamicImage::ImageRgb8(pixels), format).expect("the fixture encodes")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn field_of(error: &AppError) -> Option<&str> {
        match error {
            AppError::Validation { field, .. } => field.as_deref(),
            _ => None,
        }
    }

    fn temp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nixus-project-image-{}-{}",
            std::process::id(),
            name
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(bytes).unwrap();
        path
    }

    fn refusal_field(name: &str, bytes: &[u8]) -> Option<String> {
        let path = temp_file(name, bytes);
        let error = read(path.to_str().unwrap()).unwrap_err();
        field_of(&error).map(|field| field.to_string())
    }

    /// A 13-byte IHDR carrying the declared size, then the fixed colour-type tail. Nothing
    /// past the header is parsed, so no pixel data or CRC is needed.
    fn png_declaring(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(PNG_IHDR);
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    /// SOI, an optional prelude injected verbatim, then a three-component start-of-frame
    /// under `marker`, then SOS.
    fn jpeg_declaring(marker: u8, prelude: &[u8], width: u16, height: u16) -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8];
        bytes.extend_from_slice(prelude);
        bytes.extend_from_slice(&[0xFF, marker]);
        bytes.extend_from_slice(&17u16.to_be_bytes());
        bytes.push(8);
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&[3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
        bytes.extend_from_slice(&[0xFF, 0xDA]);
        bytes
    }

    /// A complete JFIF APP0 segment, the commonest thing to precede a real frame header.
    fn jfif_app0() -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xE0];
        bytes.extend_from_slice(&16u16.to_be_bytes());
        bytes.extend_from_slice(b"JFIF\0");
        bytes.extend_from_slice(&[1, 2, 0, 0, 1, 0, 1, 0, 0]);
        bytes
    }

    /// The extensions the native picker offers, as the enforcement-side copy: dropping one
    /// here while the picker still offers it fails the build.
    #[test]
    fn every_advertised_extension_maps_to_a_format() {
        assert_eq!(format_for_extension("png"), Some(ProjectImageFormat::Png));
        assert_eq!(format_for_extension("PNG"), Some(ProjectImageFormat::Png));
        assert_eq!(format_for_extension(".jpg"), Some(ProjectImageFormat::Jpeg));
        assert_eq!(format_for_extension("JPEG"), Some(ProjectImageFormat::Jpeg));
    }

    /// The picker filter is not a security boundary — a path can be supplied directly — so
    /// every other type the app handles elsewhere must still be refused here.
    #[test]
    fn a_format_outside_the_image_set_is_refused() {
        for extension in ["pdf", "csv", "txt", "xls", "xlsx", "gif", "webp", "svg", ""] {
            assert_eq!(format_for_extension(extension), None, "{extension}");
        }
    }

    /// Pinned as literals because the other half of this contract lives in
    /// `src/lib/appError.ts`: renaming one here would otherwise compile, ship, and
    /// silently degrade every refusal to the generic fallback wording.
    #[test]
    fn the_emitted_rejection_fields_are_the_contracted_literals() {
        assert_eq!(UNSUPPORTED_TYPE, "project_image_unsupported_type");
        assert_eq!(EMPTY, "project_image_empty");
        assert_eq!(TOO_LARGE, "project_image_too_large");
        assert_eq!(UNREADABLE, "project_image_unreadable");
        assert_eq!(CONTENT_MISMATCH, "project_image_content_mismatch");
        assert_eq!(DIMENSIONS, "project_image_dimensions");
    }

    /// Each refusal must be distinguishable, or two different problems map to one message.
    #[test]
    fn every_rejection_field_is_distinct() {
        let fields = [
            UNSUPPORTED_TYPE,
            EMPTY,
            TOO_LARGE,
            UNREADABLE,
            CONTENT_MISMATCH,
            DIMENSIONS,
        ];
        let unique: std::collections::BTreeSet<&str> = fields.iter().copied().collect();

        assert_eq!(unique.len(), fields.len());
    }

    #[test]
    fn inspect_returns_the_basename_with_no_directory_component() {
        let path = temp_file("cover.png", &png_declaring(64, 64));

        let name = inspect(path.to_str().unwrap()).expect("accepted");

        assert_eq!(name, "cover.png");
        assert!(!name.contains('/'));
        assert!(!name.contains('\\'));
    }

    /// The refusal matrix. Every case names the exact `field` the frontend switches on,
    /// so a cause silently collapsing into a neighbour's message fails here.
    #[test]
    fn the_refusal_matrix_reports_the_contracted_field_for_each_cause() {
        let stub_after_signature = [PNG_SIGNATURE, b"\x00"].concat();
        let truncated_frame_header = [&[0xFF, 0xD8, 0xFF, 0xC0][..], &17u16.to_be_bytes()].concat();
        let cases: Vec<(&str, Vec<u8>, &str)> = vec![
            ("empty.png", Vec::new(), EMPTY),
            (
                "oversized.png",
                vec![b'x'; (MAX_PROJECT_IMAGE_BYTES + 1) as usize],
                TOO_LARGE,
            ),
            ("notes.txt", b"plain text".to_vec(), UNSUPPORTED_TYPE),
            ("extensionless", b"plain text".to_vec(), UNSUPPORTED_TYPE),
            (
                "prose.png",
                b"this is plain text, not an image".to_vec(),
                CONTENT_MISMATCH,
            ),
            ("liar.jpg", png_declaring(8, 8), CONTENT_MISMATCH),
            // Nine bytes: a valid signature and nothing else. A refusal, not a panic.
            ("stub.png", stub_after_signature, CONTENT_MISMATCH),
            ("scan-only.jpg", jpeg_no_frame_header(), CONTENT_MISMATCH),
            ("cut.jpg", truncated_frame_header, CONTENT_MISMATCH),
            ("huge.png", png_declaring(5000, 5000), DIMENSIONS),
            ("flat.png", png_declaring(0, 256), DIMENSIONS),
            (
                "huge.jpg",
                jpeg_declaring(0xC0, &[], 5000, 5000),
                DIMENSIONS,
            ),
        ];

        for (name, bytes, expected) in cases {
            assert_eq!(
                refusal_field(name, &bytes).as_deref(),
                Some(expected),
                "{name}"
            );
        }
    }

    fn jpeg_no_frame_header() -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8];
        bytes.extend_from_slice(&jfif_app0());
        bytes.extend_from_slice(&[0xFF, 0xDA]);
        bytes
    }

    #[test]
    fn a_missing_file_is_unreadable_to_both_entry_points() {
        assert_eq!(
            field_of(&inspect("/nixus/definitely/not/here.png").unwrap_err()),
            Some(UNREADABLE)
        );
        assert_eq!(
            field_of(&read("/nixus/definitely/not/here.png").unwrap_err()),
            Some(UNREADABLE)
        );
    }

    /// 65536x65536 is a legal PNG header whose pixel product is exactly 2^32, so a `u32`
    /// multiply yields 0 and slips under the cap. This is the test that discriminates the
    /// widening in `read`.
    #[test]
    fn a_png_whose_pixel_product_overflows_thirty_two_bits_is_refused() {
        let field = refusal_field("overflow.png", &png_declaring(65536, 65536));

        assert_eq!(field.as_deref(), Some(DIMENSIONS));
    }

    /// The byte boundary itself, so an off-by-one cannot refuse a legal image.
    #[test]
    fn a_png_exactly_at_the_byte_ceiling_is_accepted() {
        let mut bytes = png_declaring(32, 32);
        bytes.resize(MAX_PROJECT_IMAGE_BYTES as usize, 0);
        let path = temp_file("exact.png", &bytes);

        let (format, stored) = read(path.to_str().unwrap()).expect("accepted");

        assert_eq!(format, ProjectImageFormat::Png);
        assert_eq!(stored.len() as u64, MAX_PROJECT_IMAGE_BYTES);
    }

    #[test]
    fn a_small_png_is_accepted_with_its_mime_type() {
        let bytes = png_declaring(320, 200);
        let path = temp_file("small.png", &bytes);

        let (format, stored) = read(path.to_str().unwrap()).expect("accepted");

        assert_eq!(format.mime_type(), "image/png");
        assert_eq!(stored, bytes);
    }

    #[test]
    fn a_small_jpeg_is_accepted_with_its_mime_type() {
        let bytes = jpeg_declaring(0xC0, &jfif_app0(), 320, 200);
        let path = temp_file("small.jpg", &bytes);

        let (format, stored) = read(path.to_str().unwrap()).expect("accepted");

        assert_eq!(format.mime_type(), "image/jpeg");
        assert_eq!(stored, bytes);
    }

    /// Fill padding ahead of a marker is legal and real cameras emit it. Consuming only
    /// one `0xFF` mis-seeks the walk, and because the parser fails closed the result would
    /// be a refused photograph rather than a visible crash.
    #[test]
    fn a_jpeg_with_fill_bytes_before_the_frame_header_is_accepted() {
        let mut prelude = jfif_app0();
        prelude.extend_from_slice(&[JPEG_FILL, JPEG_FILL, JPEG_FILL]);
        let path = temp_file("filled.jpg", &jpeg_declaring(0xC0, &prelude, 320, 200));

        assert!(read(path.to_str().unwrap()).is_ok());
    }

    /// TEM and RSTn carry no length field. Reading the following two bytes as a length
    /// would seek into the middle of the next segment.
    #[test]
    fn a_jpeg_with_standalone_markers_before_the_frame_header_is_accepted() {
        let mut prelude = vec![0xFF, 0x01, 0xFF, 0xD0, 0xFF, 0xD7];
        prelude.extend_from_slice(&jfif_app0());
        let path = temp_file("standalone.jpg", &jpeg_declaring(0xC0, &prelude, 320, 200));

        assert!(read(path.to_str().unwrap()).is_ok());
    }

    /// Every frame marker must be a dimension source, and the three lookalikes inside the
    /// same numeric range must not be — a DHT read as a frame yields nonsense dimensions.
    #[test]
    fn only_the_declared_start_of_frame_markers_are_dimension_sources() {
        for marker in [
            0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
        ] {
            let name = format!("sof-{marker:02x}.jpg");
            let path = temp_file(&name, &jpeg_declaring(marker, &[], 5000, 5000));
            assert_eq!(
                field_of(&read(path.to_str().unwrap()).unwrap_err()),
                Some(DIMENSIONS),
                "{name}"
            );
        }

        for marker in [0xC4u8, 0xC8, 0xCC] {
            let name = format!("not-sof-{marker:02x}.jpg");
            let path = temp_file(&name, &jpeg_declaring(marker, &[], 5000, 5000));
            assert_eq!(
                field_of(&read(path.to_str().unwrap()).unwrap_err()),
                Some(CONTENT_MISMATCH),
                "{name}"
            );
        }
    }

    /// The path is the one piece of state that must never reach a user-visible or logged
    /// string, and every refusal here is built from a fixed message (AD-11).
    #[test]
    fn no_refusal_message_contains_the_path() {
        let marker = "nixus-image-privacy-marker";
        let dir = std::env::temp_dir().join(format!("{marker}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("a.txt", b"plain".to_vec()),
            ("b.png", Vec::new()),
            (
                "c.png",
                vec![b'x'; (MAX_PROJECT_IMAGE_BYTES + 1) as usize],
            ),
            ("d.png", b"plain text, not an image".to_vec()),
            ("e.png", png_declaring(5000, 5000)),
            ("f.png", Vec::new()),
        ];

        for (name, bytes) in cases {
            let path = dir.join(name);
            std::fs::write(&path, &bytes).unwrap();
            let as_str = path.to_str().unwrap();
            let rendered = read(as_str).unwrap_err().to_string();

            assert!(!rendered.contains(marker), "{name}: {rendered}");
            assert!(!rendered.contains(as_str), "{name}: {rendered}");
        }

        let absent = dir.join("gone.png");
        let rendered = read(absent.to_str().unwrap()).unwrap_err().to_string();
        assert!(!rendered.contains(marker), "{rendered}");
    }

    fn thumbnail_size(bytes: &[u8]) -> (u32, u32) {
        let decoded = image::load_from_memory(bytes).expect("the thumbnail decodes");
        (decoded.width(), decoded.height())
    }

    /// The other half of the `mime_type` contract. `upsert_project_image` stores the string and
    /// the lazy backfill has to get a format back out of it, so a one-way mapping would leave
    /// every pre-027 row permanently without a thumbnail.
    #[test]
    fn every_stored_mime_type_maps_back_to_its_format() {
        for format in [ProjectImageFormat::Png, ProjectImageFormat::Jpeg] {
            assert_eq!(
                ProjectImageFormat::from_mime_type(format.mime_type()),
                Some(format)
            );
        }

        assert_eq!(ProjectImageFormat::from_mime_type("image/webp"), None);
        assert_eq!(ProjectImageFormat::from_mime_type("image/PNG"), None);
    }

    #[test]
    fn a_png_thumbnail_keeps_the_source_format_and_fits_the_ceiling() {
        let source = rendered_test_image(800, 600, false, ProjectImageFormat::Png);

        let (bytes, mime) = thumbnail(&source, ProjectImageFormat::Png).expect("a thumbnail");

        assert_eq!(mime, "image/png");
        assert_eq!(thumbnail_size(&bytes), (THUMBNAIL_EDGE, 192));
        assert!(u64::try_from(bytes.len()).unwrap() <= MAX_PROJECT_THUMBNAIL_BYTES);
    }

    #[test]
    fn a_jpeg_thumbnail_keeps_the_source_format_and_fits_the_ceiling() {
        let source = rendered_test_image(800, 600, false, ProjectImageFormat::Jpeg);

        let (bytes, mime) = thumbnail(&source, ProjectImageFormat::Jpeg).expect("a thumbnail");

        assert_eq!(mime, "image/jpeg");
        assert_eq!(thumbnail_size(&bytes), (THUMBNAIL_EDGE, 192));
        assert!(u64::try_from(bytes.len()).unwrap() <= MAX_PROJECT_THUMBNAIL_BYTES);
    }

    /// A square thumbnail of a panorama is a cropped thumbnail, and cropping is out of scope:
    /// the tile letterboxes rather than deciding for the user what to cut.
    #[test]
    fn a_non_square_source_keeps_its_aspect_ratio() {
        let source = rendered_test_image(800, 200, false, ProjectImageFormat::Png);

        let (bytes, _) = thumbnail(&source, ProjectImageFormat::Png).expect("a thumbnail");

        assert_eq!(thumbnail_size(&bytes), (THUMBNAIL_EDGE, 64));
    }

    /// The upscale guard. Without it a 48x32 avatar becomes a 256x171 thumbnail — more bytes
    /// than the picture it derives from, and blurrier.
    #[test]
    fn a_source_already_smaller_than_the_target_is_not_scaled_up() {
        let source = rendered_test_image(48, 32, false, ProjectImageFormat::Png);

        let (bytes, _) = thumbnail(&source, ProjectImageFormat::Png).expect("a thumbnail");

        assert_eq!(thumbnail_size(&bytes), (48, 32));
    }

    /// The production ceiling, not an injected one: 256x256 of noise is incompressible, so its
    /// PNG re-encode lands near 190 KiB and only a JPEG rung can satisfy 64 KiB.
    #[test]
    fn a_source_whose_own_format_cannot_fit_the_real_ceiling_falls_back_to_jpeg() {
        let source = rendered_test_image(
            THUMBNAIL_EDGE,
            THUMBNAIL_EDGE,
            true,
            ProjectImageFormat::Png,
        );

        let (bytes, mime) = thumbnail(&source, ProjectImageFormat::Png).expect("a thumbnail");

        assert_eq!(mime, "image/jpeg");
        assert!(u64::try_from(bytes.len()).unwrap() <= MAX_PROJECT_THUMBNAIL_BYTES);
    }

    /// A transparent source, which is the case that makes the RGBA flatten in `encoded`
    /// load-bearing: the JPEG encoder rejects an RGBA buffer, so without it every JPEG rung
    /// fails and this picture would silently get no thumbnail at all.
    #[test]
    fn a_transparent_png_can_still_fall_back_to_jpeg() {
        let pixels = image::RgbaImage::from_fn(THUMBNAIL_EDGE, THUMBNAIL_EDGE, |x, y| {
            let mixed = (x.wrapping_mul(2_654_435_761) ^ y.wrapping_mul(40_503)).to_le_bytes();
            image::Rgba([mixed[0], mixed[1], mixed[2], 128])
        });
        let source = encoded(&DynamicImage::ImageRgba8(pixels), ProjectImageFormat::Png)
            .expect("the fixture encodes");

        let (bytes, mime) = thumbnail(&source, ProjectImageFormat::Png).expect("a thumbnail");

        assert_eq!(mime, "image/jpeg");
        assert!(u64::try_from(bytes.len()).unwrap() <= MAX_PROJECT_THUMBNAIL_BYTES);
    }

    /// Every rung, driven deterministically by setting each ceiling one byte under the previous
    /// rung's own measured size. That is what proves the ORDER — format is traded before
    /// resolution — rather than merely proving something under 64 KiB comes back.
    #[test]
    fn the_ladder_trades_format_before_resolution_and_gives_up_last() {
        let source = rendered_test_image(
            THUMBNAIL_EDGE,
            THUMBNAIL_EDGE,
            true,
            ProjectImageFormat::Png,
        );

        let (as_png, png_mime) =
            thumbnail_within(&source, ProjectImageFormat::Png, u64::MAX).expect("rung 1");
        assert_eq!(png_mime, "image/png", "the source format is preferred");

        let below_png = u64::try_from(as_png.len()).unwrap() - 1;
        let (as_jpeg, jpeg_mime) =
            thumbnail_within(&source, ProjectImageFormat::Png, below_png).expect("rung 2");
        assert_eq!(jpeg_mime, "image/jpeg");
        assert_eq!(
            thumbnail_size(&as_jpeg),
            (THUMBNAIL_EDGE, THUMBNAIL_EDGE),
            "rung 2 trades the format, never the resolution"
        );

        let below_jpeg = u64::try_from(as_jpeg.len()).unwrap() - 1;
        let (halved, halved_mime) =
            thumbnail_within(&source, ProjectImageFormat::Png, below_jpeg).expect("rung 3");
        assert_eq!(halved_mime, "image/jpeg");
        assert_eq!(
            thumbnail_size(&halved),
            (THUMBNAIL_FALLBACK_EDGE, THUMBNAIL_FALLBACK_EDGE)
        );

        let below_halved = u64::try_from(halved.len()).unwrap() - 1;
        assert!(thumbnail_within(&source, ProjectImageFormat::Png, below_halved).is_none());
    }

    /// Undecodable input is an absent thumbnail, never an error: `read` accepts a file on its
    /// container header alone, so the two verdicts genuinely disagree, and the upload must
    /// survive that disagreement.
    #[test]
    fn input_the_decoder_refuses_yields_no_thumbnail_rather_than_an_error() {
        assert!(thumbnail(b"this is not image data", ProjectImageFormat::Png).is_none());
        assert!(thumbnail(&[], ProjectImageFormat::Jpeg).is_none());
        // A header the shipped validator accepts, with no pixel data behind it.
        assert!(thumbnail(&png_declaring(64, 64), ProjectImageFormat::Png).is_none());
    }
}
