use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::process::Command;

pub const LAYOUT_SCHEMA_VERSION: &str = "layout-v1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct NormalizedExtraction {
    pub schema_version: String,
    pub provider: String,
    pub provider_version: String,
    pub source_sha256: String,
    pub pages: Vec<NormalizedPage>,
    pub items: Vec<LayoutItem>,
    pub warnings: Vec<String>,
    pub raw_artifact: Value,
}

impl NormalizedExtraction {
    pub fn indexable_text(&self) -> String {
        self.items
            .iter()
            .filter(|item| item.content_layer == ContentLayer::Body)
            .map(|item| item.text.trim())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    pub fn as_extracted_document(&self) -> super::ExtractedDocument {
        let body = self
            .items
            .iter()
            .filter(|item| item.content_layer == ContentLayer::Body && !item.text.trim().is_empty())
            .collect::<Vec<_>>();
        let pages = self
            .pages
            .iter()
            .map(|page| {
                let text = body
                    .iter()
                    .filter(|item| {
                        item.spans
                            .first()
                            .is_some_and(|span| span.page_number == page.page_number)
                    })
                    .map(|item| item.text.trim())
                    .collect::<Vec<_>>()
                    .join("\n\n");
                super::ExtractedPage {
                    physical_page: Some(page.page_number),
                    text,
                }
            })
            .collect();
        let blocks = body
            .into_iter()
            .map(|item| {
                let page_start = item.spans.iter().map(|span| span.page_number).min();
                let page_end = item.spans.iter().map(|span| span.page_number).max();
                let kind = match item.label.as_str() {
                    "list_item" => super::StructuralKind::ListItem,
                    "table" => super::StructuralKind::TableRow,
                    _ => super::StructuralKind::Paragraph,
                };
                super::StructuralBlock {
                    kind,
                    text: item.text.clone(),
                    page_start,
                    page_end,
                    section_path: item.section_path.clone(),
                    source_refs: vec![item.provider_ref.clone()],
                }
            })
            .collect();
        super::ExtractedDocument {
            text: self.indexable_text(),
            pages,
            blocks,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct NormalizedPage {
    pub page_number: usize,
    pub width_points: f64,
    pub height_points: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentLayer {
    Body,
    Furniture,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LayoutItem {
    pub provider_ref: String,
    pub parent_ref: Option<String>,
    pub ordinal: usize,
    pub label: String,
    pub content_layer: ContentLayer,
    pub text: String,
    pub section_path: Vec<String>,
    pub spans: Vec<LayoutSpan>,
    pub metadata: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LayoutSpan {
    pub page_number: usize,
    pub bbox: LayoutBox,
    pub char_start: usize,
    pub char_end: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct LayoutBox {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub origin: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderErrorKind {
    Retryable,
    Permanent,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderError {
    kind: ProviderErrorKind,
    message: String,
}

impl ProviderError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            kind: ProviderErrorKind::Permanent,
            message: message.into(),
        }
    }

    fn retryable(message: impl Into<String>) -> Self {
        Self {
            kind: ProviderErrorKind::Retryable,
            message: message.into(),
        }
    }

    pub fn is_retryable(&self) -> bool {
        self.kind == ProviderErrorKind::Retryable
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProviderError {}

#[derive(Clone, Debug)]
pub struct ExtractionRequest {
    pub mime_type: String,
    pub source_sha256: String,
    pub bytes: Arc<[u8]>,
}

#[async_trait]
pub trait DocumentExtractionProvider: Send + Sync {
    async fn extract(
        &self,
        request: ExtractionRequest,
    ) -> Result<NormalizedExtraction, ProviderError>;
}

pub struct DoclingCommandProvider {
    executable: PathBuf,
    expected_version: String,
    timeout: Duration,
    max_output_bytes: usize,
}

impl DoclingCommandProvider {
    pub fn new(
        executable: impl Into<PathBuf>,
        expected_version: impl Into<String>,
        timeout: Duration,
        max_output_bytes: usize,
    ) -> Self {
        Self {
            executable: executable.into(),
            expected_version: expected_version.into(),
            timeout,
            max_output_bytes,
        }
    }

    async fn output(&self, arguments: &[&str]) -> Result<std::process::Output, ProviderError> {
        let mut command = Command::new(&self.executable);
        command.args(arguments).kill_on_drop(true);
        let output = tokio::time::timeout(self.timeout, command.output())
            .await
            .map_err(|_| ProviderError::retryable("the Docling process timed out"))?
            .map_err(|error| {
                ProviderError::retryable(format!("could not start the Docling process: {error}"))
            })?;
        if output.stdout.len() > self.max_output_bytes
            || output.stderr.len() > self.max_output_bytes.min(64 * 1024)
        {
            return Err(ProviderError::invalid(
                "the Docling process exceeded its output limit",
            ));
        }
        Ok(output)
    }
}

#[async_trait]
impl DocumentExtractionProvider for DoclingCommandProvider {
    async fn extract(
        &self,
        request: ExtractionRequest,
    ) -> Result<NormalizedExtraction, ProviderError> {
        if request.mime_type != "application/pdf" {
            return Err(ProviderError::invalid(
                "the Docling VPS provider currently accepts PDF documents only",
            ));
        }
        let actual_hash = format!("{:x}", Sha256::digest(request.bytes.as_ref()));
        if actual_hash != request.source_sha256 {
            return Err(ProviderError::invalid(
                "the extraction source does not match its SHA-256",
            ));
        }

        let version = self.output(&["--version"]).await?;
        if !version.status.success() {
            return Err(ProviderError::invalid(
                "the Docling executable could not report its version",
            ));
        }
        let version = String::from_utf8(version.stdout)
            .map_err(|_| ProviderError::invalid("the Docling version is not UTF-8"))?;
        let reported_version = version.split_whitespace().nth(1).unwrap_or_default().trim();
        if reported_version != self.expected_version {
            return Err(ProviderError::invalid(format!(
                "Docling version {reported_version} does not match pinned version {}",
                self.expected_version
            )));
        }

        let staged = StagedSource::write(request.bytes.as_ref(), "pdf").await?;
        let path = staged.path().to_string_lossy().into_owned();
        let output = self
            .output(&["--to", "json", "--heading-hierarchy", "--skip-ocr", &path])
            .await?;
        if !output.status.success() {
            return Err(ProviderError::invalid(format!(
                "Docling rejected the PDF with status {}",
                output.status
            )));
        }
        let artifact = String::from_utf8(output.stdout)
            .map_err(|_| ProviderError::invalid("the Docling artifact is not UTF-8"))?;
        normalize_docling_json(&artifact, &request.source_sha256, &self.expected_version)
    }
}

static STAGED_SOURCE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

struct StagedSource(PathBuf);

impl StagedSource {
    async fn write(bytes: &[u8], extension: &str) -> Result<Self, ProviderError> {
        let sequence = STAGED_SOURCE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "vokoo-document-{}-{sequence}.{extension}",
            std::process::id()
        ));
        tokio::fs::write(&path, bytes).await.map_err(|error| {
            ProviderError::retryable(format!("could not stage the document source: {error}"))
        })?;
        Ok(Self(path))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for StagedSource {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub fn normalize_docling_json(
    artifact: &str,
    source_sha256: &str,
    provider_version: &str,
) -> Result<NormalizedExtraction, ProviderError> {
    if source_sha256.len() != 64
        || !source_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ProviderError::invalid(
            "the source hash is not lowercase SHA-256",
        ));
    }
    if provider_version.trim().is_empty() {
        return Err(ProviderError::invalid("the provider version is missing"));
    }

    let raw_artifact: Value = serde_json::from_str(artifact)
        .map_err(|error| ProviderError::invalid(format!("invalid Docling JSON: {error}")))?;
    if raw_artifact.get("schema_name").and_then(Value::as_str) != Some("DoclingDocument") {
        return Err(ProviderError::invalid(
            "the artifact is not a DoclingDocument",
        ));
    }

    let pages_value = raw_artifact
        .get("pages")
        .and_then(Value::as_object)
        .ok_or_else(|| ProviderError::invalid("the Docling artifact has no pages"))?;
    let mut pages = pages_value
        .values()
        .map(parse_page)
        .collect::<Result<Vec<_>, _>>()?;
    pages.sort_by_key(|page| page.page_number);
    if pages.is_empty() {
        return Err(ProviderError::invalid("the Docling artifact has no pages"));
    }
    if pages
        .windows(2)
        .any(|pair| pair[0].page_number == pair[1].page_number)
    {
        return Err(ProviderError::invalid(
            "the Docling artifact repeats a page",
        ));
    }
    let page_map = pages
        .iter()
        .map(|page| (page.page_number, page))
        .collect::<HashMap<_, _>>();

    let mut builder = LayoutBuilder {
        artifact: &raw_artifact,
        pages: page_map,
        items: Vec::new(),
        visiting: HashSet::new(),
        sections: Vec::new(),
    };
    builder.walk_root("body", ContentLayer::Body)?;
    builder.walk_root("furniture", ContentLayer::Furniture)?;
    let items = std::mem::take(&mut builder.items);
    drop(builder);

    Ok(NormalizedExtraction {
        schema_version: LAYOUT_SCHEMA_VERSION.into(),
        provider: "docling-rs".into(),
        provider_version: provider_version.into(),
        source_sha256: source_sha256.into(),
        pages,
        items,
        warnings: Vec::new(),
        raw_artifact,
    })
}

fn parse_page(value: &Value) -> Result<NormalizedPage, ProviderError> {
    let page_number = value
        .get("page_no")
        .and_then(Value::as_u64)
        .and_then(|number| usize::try_from(number).ok())
        .filter(|number| *number > 0)
        .ok_or_else(|| ProviderError::invalid("a Docling page has an invalid page number"))?;
    let size = value
        .get("size")
        .ok_or_else(|| ProviderError::invalid(format!("page {page_number} has no size")))?;
    let width_points = finite_positive(size.get("width"), "page width")?;
    let height_points = finite_positive(size.get("height"), "page height")?;
    Ok(NormalizedPage {
        page_number,
        width_points,
        height_points,
    })
}

fn finite_positive(value: Option<&Value>, name: &str) -> Result<f64, ProviderError> {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite() && *number > 0.0)
        .ok_or_else(|| ProviderError::invalid(format!("the {name} is invalid")))
}

struct LayoutBuilder<'a> {
    artifact: &'a Value,
    pages: HashMap<usize, &'a NormalizedPage>,
    items: Vec<LayoutItem>,
    visiting: HashSet<String>,
    sections: Vec<String>,
}

impl LayoutBuilder<'_> {
    fn walk_root(&mut self, key: &str, layer: ContentLayer) -> Result<(), ProviderError> {
        let children = self
            .artifact
            .get(key)
            .and_then(|root| root.get("children"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for child in children {
            let reference = reference_value(&child)?;
            self.walk_ref(reference, layer)?;
        }
        Ok(())
    }

    fn walk_ref(&mut self, reference: &str, layer: ContentLayer) -> Result<(), ProviderError> {
        if !self.visiting.insert(reference.to_string()) {
            return Err(ProviderError::invalid(format!(
                "the Docling tree contains a cycle at {reference}"
            )));
        }
        let node = resolve_ref(self.artifact, reference)?;
        if reference.starts_with("#/groups/") {
            let children = node
                .get("children")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for child in children {
                self.walk_ref(reference_value(&child)?, layer)?;
            }
        } else {
            self.push_item(reference, node, layer)?;
        }
        self.visiting.remove(reference);
        Ok(())
    }

    fn push_item(
        &mut self,
        reference: &str,
        node: &Value,
        layer: ContentLayer,
    ) -> Result<(), ProviderError> {
        let label = node
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("unspecified")
            .to_string();
        let text = item_text(node, &label);
        if layer == ContentLayer::Body && !text.trim().is_empty() {
            if label == "title" {
                self.sections.clear();
                self.sections.push(text.trim().to_string());
            } else if label == "section_header" {
                let level = node
                    .get("level")
                    .and_then(Value::as_u64)
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(1);
                let keep = level.min(self.sections.len());
                self.sections.truncate(keep);
                self.sections.push(text.trim().to_string());
            }
        }
        let spans = node
            .get("prov")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .map(|value| self.parse_span(value))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?
            .unwrap_or_default();
        let parent_ref = node
            .get("parent")
            .and_then(|parent| parent.get("$ref"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let metadata = if reference.starts_with("#/tables/") {
            node.get("data").cloned().unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        self.items.push(LayoutItem {
            provider_ref: reference.to_string(),
            parent_ref,
            ordinal: self.items.len(),
            label,
            content_layer: layer,
            text,
            section_path: self.sections.clone(),
            spans,
            metadata,
        });
        Ok(())
    }

    fn parse_span(&self, value: &Value) -> Result<LayoutSpan, ProviderError> {
        let page_number = value
            .get("page_no")
            .and_then(Value::as_u64)
            .and_then(|number| usize::try_from(number).ok())
            .ok_or_else(|| ProviderError::invalid("a source span has no page number"))?;
        let page = self.pages.get(&page_number).ok_or_else(|| {
            ProviderError::invalid(format!(
                "a source span references missing page {page_number}"
            ))
        })?;
        let bbox = value
            .get("bbox")
            .ok_or_else(|| ProviderError::invalid("a source span has no bounding box"))?;
        let layout_box = LayoutBox {
            left: finite_coordinate(bbox.get("l"), "left")?,
            top: finite_coordinate(bbox.get("t"), "top")?,
            right: finite_coordinate(bbox.get("r"), "right")?,
            bottom: finite_coordinate(bbox.get("b"), "bottom")?,
            origin: bbox
                .get("coord_origin")
                .and_then(Value::as_str)
                .unwrap_or("BOTTOMLEFT")
                .to_string(),
        };
        let within_page = layout_box.left <= layout_box.right
            && layout_box.bottom <= layout_box.top
            && layout_box.right <= page.width_points
            && layout_box.top <= page.height_points
            && layout_box.origin == "BOTTOMLEFT";
        if !within_page {
            return Err(ProviderError::invalid(format!(
                "a source box is outside page {page_number}"
            )));
        }
        let charspan = value
            .get("charspan")
            .and_then(Value::as_array)
            .filter(|span| span.len() == 2);
        let char_start = charspan
            .and_then(|span| span[0].as_u64())
            .and_then(|number| usize::try_from(number).ok())
            .unwrap_or(0);
        let char_end = charspan
            .and_then(|span| span[1].as_u64())
            .and_then(|number| usize::try_from(number).ok())
            .unwrap_or(char_start);
        if char_end < char_start {
            return Err(ProviderError::invalid(
                "a source character span is inverted",
            ));
        }
        Ok(LayoutSpan {
            page_number,
            bbox: layout_box,
            char_start,
            char_end,
        })
    }
}

fn finite_coordinate(value: Option<&Value>, name: &str) -> Result<f64, ProviderError> {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite() && *number >= 0.0)
        .ok_or_else(|| ProviderError::invalid(format!("the box {name} coordinate is invalid")))
}

fn reference_value(value: &Value) -> Result<&str, ProviderError> {
    value
        .get("$ref")
        .and_then(Value::as_str)
        .ok_or_else(|| ProviderError::invalid("the Docling tree contains an invalid reference"))
}

fn resolve_ref<'a>(artifact: &'a Value, reference: &str) -> Result<&'a Value, ProviderError> {
    let mut parts = reference.strip_prefix("#/").unwrap_or("").split('/');
    let bucket = parts.next().unwrap_or_default();
    let index = parts
        .next()
        .and_then(|part| part.parse::<usize>().ok())
        .ok_or_else(|| ProviderError::invalid(format!("invalid Docling reference {reference}")))?;
    if parts.next().is_some() || !matches!(bucket, "texts" | "groups" | "tables" | "pictures") {
        return Err(ProviderError::invalid(format!(
            "invalid Docling reference {reference}"
        )));
    }
    artifact
        .get(bucket)
        .and_then(Value::as_array)
        .and_then(|items| items.get(index))
        .ok_or_else(|| ProviderError::invalid(format!("missing Docling reference {reference}")))
}

fn item_text(node: &Value, label: &str) -> String {
    if let Some(text) = node.get("text").and_then(Value::as_str) {
        return text.to_string();
    }
    if label == "table" {
        if let Some(cells) = node
            .get("data")
            .and_then(|data| data.get("table_cells"))
            .and_then(Value::as_array)
        {
            return cells
                .iter()
                .filter_map(|cell| cell.get("text").and_then(Value::as_str))
                .filter(|text| !text.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\t");
        }
    }
    String::new()
}
