use std::path::Path;

use crate::ai::backend::{AiAttachment, AiDocumentFormat, AiImageFormat};
use crate::error::AppError;

/// Mirrors `MAX_DECODED_MEDIA_BYTES` in `apps/api-bedrock`. Enforced here so an
/// oversized file is refused before any quota unit can be reserved for it.
pub const MAX_ATTACHMENT_BYTES: u64 = 4 * 1024 * 1024;

/// The reason an attachment was refused, as the `field` of the returned
/// `AppError::Validation`. The frontend maps it to localized copy, so these strings
/// are a closed contract with `chatAttachmentMessageKey` in `src/lib/appError.ts`.
const UNSUPPORTED_TYPE: &str = "attachment_unsupported_type";
const EMPTY: &str = "attachment_empty";
const TOO_LARGE: &str = "attachment_too_large";
const UNREADABLE: &str = "attachment_unreadable";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentKind {
    Image(AiImageFormat),
    Document(AiDocumentFormat),
}

fn rejected(field: &str, message: &str) -> AppError {
    AppError::Validation {
        message: message.to_string(),
        field: Some(field.to_string()),
    }
}

pub fn kind_for_extension(extension: &str) -> Option<AttachmentKind> {
    match extension.trim().trim_start_matches('.').to_lowercase().as_str() {
        "png" => Some(AttachmentKind::Image(AiImageFormat::Png)),
        "jpg" | "jpeg" => Some(AttachmentKind::Image(AiImageFormat::Jpeg)),
        "pdf" => Some(AttachmentKind::Document(AiDocumentFormat::Pdf)),
        "csv" => Some(AttachmentKind::Document(AiDocumentFormat::Csv)),
        "txt" => Some(AttachmentKind::Document(AiDocumentFormat::Txt)),
        "xls" => Some(AttachmentKind::Document(AiDocumentFormat::Xls)),
        "xlsx" => Some(AttachmentKind::Document(AiDocumentFormat::Xlsx)),
        _ => None,
    }
}

fn kind_for_path(path: &Path) -> Result<AttachmentKind, AppError> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(kind_for_extension)
        .ok_or_else(|| {
            rejected(
                UNSUPPORTED_TYPE,
                "That file type cannot be attached to a chat message.",
            )
        })
}

/// Validates the selected path without reading its contents, returning the basename the
/// composer displays.
///
/// The basename crosses IPC into volatile React state only; it is never persisted,
/// logged, or sent to a provider (AD-11).
pub fn inspect(file_path: &str) -> Result<String, AppError> {
    let path = Path::new(file_path);
    kind_for_path(path)?;

    let metadata = std::fs::metadata(path)
        .map_err(|_| rejected(UNREADABLE, "That file could not be read."))?;

    if !metadata.is_file() {
        return Err(rejected(UNREADABLE, "That file could not be read."));
    }

    let size = metadata.len();
    if size == 0 {
        return Err(rejected(EMPTY, "That file is empty."));
    }
    if size > MAX_ATTACHMENT_BYTES {
        return Err(rejected(TOO_LARGE, "That file is larger than 4 MB."));
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .ok_or_else(|| rejected(UNREADABLE, "That file could not be read."))
}

/// Re-validates and reads the file into the port's attachment type.
///
/// Deliberately re-checks rather than trusting `inspect`: the two calls are separated
/// by however long the user spent typing, so the ceiling has to hold against the bytes
/// actually sent. The metadata pass runs first so an enormous file is refused without
/// being materialized in memory, and the byte-length pass then closes the window in
/// which the file grew between the two.
pub fn read(file_path: &str) -> Result<AiAttachment, AppError> {
    let kind = kind_for_path(Path::new(file_path))?;
    inspect(file_path)?;

    let bytes = std::fs::read(file_path)
        .map_err(|_| rejected(UNREADABLE, "That file could not be read."))?;

    if bytes.is_empty() {
        return Err(rejected(EMPTY, "That file is empty."));
    }
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(rejected(TOO_LARGE, "That file is larger than 4 MB."));
    }

    Ok(match kind {
        AttachmentKind::Image(format) => AiAttachment::Image { format, bytes },
        AttachmentKind::Document(format) => AiAttachment::Document { format, bytes },
    })
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
            "nixus-attachment-{}-{}",
            std::process::id(),
            name
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(bytes).unwrap();
        path
    }

    /// The extensions the native picker offers. Kept here as the enforcement-side copy
    /// of `CHAT_ATTACHMENT_EXTENSIONS` in the desktop UI, so dropping one from this
    /// boundary while the picker still offers it fails the build.
    const OFFERED_EXTENSIONS: &[&str] =
        &["pdf", "png", "jpg", "jpeg", "csv", "txt", "xls", "xlsx"];

    #[test]
    fn every_advertised_extension_maps_to_a_format() {
        for extension in OFFERED_EXTENSIONS {
            assert!(
                kind_for_extension(extension).is_some(),
                "{extension} is offered by the picker but has no format"
            );
        }
    }

    #[test]
    fn the_five_document_formats_map_to_their_bedrock_counterparts() {
        assert_eq!(
            kind_for_extension("pdf"),
            Some(AttachmentKind::Document(AiDocumentFormat::Pdf))
        );
        assert_eq!(
            kind_for_extension("csv"),
            Some(AttachmentKind::Document(AiDocumentFormat::Csv))
        );
        assert_eq!(
            kind_for_extension("txt"),
            Some(AttachmentKind::Document(AiDocumentFormat::Txt))
        );
        assert_eq!(
            kind_for_extension("xls"),
            Some(AttachmentKind::Document(AiDocumentFormat::Xls))
        );
        assert_eq!(
            kind_for_extension("xlsx"),
            Some(AttachmentKind::Document(AiDocumentFormat::Xlsx))
        );
    }

    #[test]
    fn images_map_to_their_declared_image_format() {
        assert_eq!(
            kind_for_extension("PNG"),
            Some(AttachmentKind::Image(AiImageFormat::Png))
        );
        assert_eq!(
            kind_for_extension(".jpg"),
            Some(AttachmentKind::Image(AiImageFormat::Jpeg))
        );
        assert_eq!(
            kind_for_extension("jpeg"),
            Some(AttachmentKind::Image(AiImageFormat::Jpeg))
        );
    }

    /// Formats Bedrock supports but the desktop does not offer must stay refused: the
    /// picker filter is not a security boundary, since a path can be supplied directly.
    #[test]
    fn a_format_outside_the_offered_set_is_refused() {
        for extension in ["docx", "doc", "html", "md", "gif", "webp", "exe", ""] {
            assert_eq!(kind_for_extension(extension), None, "{extension}");
        }
    }

    #[test]
    fn inspect_returns_the_basename_for_an_allowed_file() {
        let path = temp_file("statement.csv", b"date,amount\n2026-01-01,100\n");

        let name = inspect(path.to_str().unwrap()).expect("accepted");

        assert_eq!(name, "statement.csv");
    }

    /// The basename only. A directory name is as much of a leak as the full path, and the
    /// composer has no use for one (AD-11).
    #[test]
    fn inspect_returns_no_directory_component() {
        let path = temp_file("nested.csv", b"a,b\n");

        let name = inspect(path.to_str().unwrap()).expect("accepted");

        assert_eq!(name, "nested.csv");
        assert!(!name.contains('/'));
        assert!(!name.contains('\\'));
    }

    /// The four `field` values the frontend switches on. Pinned as literals because the only
    /// other half of this contract lives in `src/lib/appError.ts`: renaming one here would
    /// otherwise compile, ship, and silently degrade every refusal to the fallback wording.
    #[test]
    fn the_emitted_rejection_fields_are_the_contracted_literals() {
        assert_eq!(UNSUPPORTED_TYPE, "attachment_unsupported_type");
        assert_eq!(EMPTY, "attachment_empty");
        assert_eq!(TOO_LARGE, "attachment_too_large");
        assert_eq!(UNREADABLE, "attachment_unreadable");
    }

    /// Each refusal must be distinguishable, or two different problems map to one message.
    #[test]
    fn every_rejection_field_is_distinct() {
        let fields = [UNSUPPORTED_TYPE, EMPTY, TOO_LARGE, UNREADABLE];
        let unique: std::collections::BTreeSet<&str> = fields.iter().copied().collect();

        assert_eq!(unique.len(), fields.len());
    }

    #[test]
    fn inspect_refuses_an_unsupported_extension() {
        let path = temp_file("notes.docx", b"anything");

        let error = inspect(path.to_str().unwrap()).unwrap_err();

        assert_eq!(field_of(&error), Some(UNSUPPORTED_TYPE));
    }

    #[test]
    fn inspect_refuses_an_extensionless_file() {
        let path = temp_file("statement", b"anything");

        let error = inspect(path.to_str().unwrap()).unwrap_err();

        assert_eq!(field_of(&error), Some(UNSUPPORTED_TYPE));
    }

    #[test]
    fn inspect_refuses_an_empty_file() {
        let path = temp_file("empty.txt", b"");

        let error = inspect(path.to_str().unwrap()).unwrap_err();

        assert_eq!(field_of(&error), Some(EMPTY));
    }

    #[test]
    fn inspect_refuses_a_file_over_the_four_mebibyte_ceiling() {
        let path = temp_file("big.txt", &vec![b'x'; (MAX_ATTACHMENT_BYTES + 1) as usize]);

        let error = inspect(path.to_str().unwrap()).unwrap_err();

        assert_eq!(field_of(&error), Some(TOO_LARGE));
    }

    /// The boundary itself, so an off-by-one cannot refuse a legal file.
    #[test]
    fn inspect_accepts_a_file_exactly_at_the_ceiling() {
        let path = temp_file("exact.txt", &vec![b'x'; MAX_ATTACHMENT_BYTES as usize]);

        assert!(inspect(path.to_str().unwrap()).is_ok());
    }

    #[test]
    fn inspect_refuses_a_missing_file() {
        let error = inspect("/nixus/definitely/not/here.pdf").unwrap_err();

        assert_eq!(field_of(&error), Some(UNREADABLE));
    }

    #[test]
    fn read_produces_a_document_attachment_carrying_the_declared_format() {
        let path = temp_file("book.xlsx", b"PK\x03\x04payload");

        let attachment = read(path.to_str().unwrap()).expect("read");

        match attachment {
            AiAttachment::Document { format, bytes } => {
                assert_eq!(format, AiDocumentFormat::Xlsx);
                assert_eq!(bytes, b"PK\x03\x04payload");
            }
            other => panic!("expected a document, got {other:?}"),
        }
    }

    #[test]
    fn read_produces_an_image_attachment_carrying_the_declared_format() {
        let path = temp_file("shot.png", b"\x89PNG\r\n\x1a\n");

        let attachment = read(path.to_str().unwrap()).expect("read");

        match attachment {
            AiAttachment::Image { format, .. } => assert_eq!(format, AiImageFormat::Png),
            other => panic!("expected an image, got {other:?}"),
        }
    }

    #[test]
    fn read_refuses_the_same_files_inspect_refuses() {
        let unsupported = temp_file("read-notes.docx", b"anything");
        let empty = temp_file("read-empty.csv", b"");

        assert_eq!(
            field_of(&read(unsupported.to_str().unwrap()).unwrap_err()),
            Some(UNSUPPORTED_TYPE)
        );
        assert_eq!(
            field_of(&read(empty.to_str().unwrap()).unwrap_err()),
            Some(EMPTY)
        );
        assert_eq!(
            field_of(&read("/nixus/definitely/not/here.csv").unwrap_err()),
            Some(UNREADABLE)
        );
    }

    /// The path is the one piece of state that must never reach a user-visible or
    /// logged string, and every refusal here is built from a fixed message (AD-11).
    #[test]
    fn no_rejection_message_contains_the_path() {
        let path = temp_file("secret-folder-name.docx", b"x");
        let as_str = path.to_str().unwrap();

        let error = read(as_str).unwrap_err();
        let rendered = error.to_string();

        assert!(!rendered.contains("secret-folder-name"));
        assert!(!rendered.contains(as_str));
    }
}
