use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const DOCX_MIME: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtractedPage {
    pub physical_page: Option<usize>,
    pub text: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StructuralKind {
    Paragraph,
    ListItem,
    TableRow,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StructuralBlock {
    pub kind: StructuralKind,
    pub text: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub section_path: Vec<String>,
    pub source_refs: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtractedDocument {
    pub text: String,
    pub pages: Vec<ExtractedPage>,
    pub blocks: Vec<StructuralBlock>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentError(String);

impl DocumentError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for DocumentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for DocumentError {}

pub fn extract_document(mime_type: &str, bytes: &[u8]) -> Result<ExtractedDocument, DocumentError> {
    let text = match mime_type {
        "text/plain" | "text/markdown" => String::from_utf8(bytes.to_vec())
            .map_err(|_| DocumentError::new("the text document is not UTF-8"))?,
        "application/pdf" => run_extractor("pdf", bytes, "pdftotext", &["-layout"])?,
        DOCX_MIME => {
            let xml = run_extractor(
                "docx",
                bytes,
                "unzip",
                &["-p", "{file}", "word/document.xml"],
            )?;
            docx_text(&xml)
        }
        _ => return Err(DocumentError::new("the document type is not supported")),
    };

    if text.trim().is_empty() {
        return Err(DocumentError::new(
            "the document contains no extractable text",
        ));
    }

    let pages = text
        .split('\u{000c}')
        .enumerate()
        .filter_map(|(index, page)| {
            let text = page.trim().to_string();
            (!text.is_empty()).then_some(ExtractedPage {
                physical_page: Some(index + 1),
                text,
            })
        })
        .collect::<Vec<_>>();
    let blocks = structural_blocks(
        &pages,
        mime_type == "text/markdown" || mime_type == DOCX_MIME,
    );

    Ok(ExtractedDocument {
        text,
        pages,
        blocks,
    })
}

fn structural_blocks(pages: &[ExtractedPage], markdown: bool) -> Vec<StructuralBlock> {
    let mut blocks = Vec::new();
    let mut sections: Vec<String> = Vec::new();

    for page in pages {
        for raw in page.text.split("\n\n") {
            let paragraph = raw.trim();
            if paragraph.is_empty() {
                continue;
            }
            if markdown {
                let first = paragraph.lines().next().unwrap_or_default().trim();
                let hashes = first
                    .chars()
                    .take_while(|character| *character == '#')
                    .count();
                if (1..=6).contains(&hashes)
                    && first.chars().nth(hashes).is_some_and(char::is_whitespace)
                {
                    sections.truncate(hashes - 1);
                    sections.push(first[hashes..].trim().to_string());
                    let rest = paragraph.lines().skip(1).collect::<Vec<_>>().join("\n");
                    if rest.trim().is_empty() {
                        continue;
                    }
                    blocks.push(block(rest.trim(), page.physical_page, &sections));
                    continue;
                }
            }
            blocks.push(block(paragraph, page.physical_page, &sections));
        }
    }
    blocks
}

fn block(text: &str, page: Option<usize>, sections: &[String]) -> StructuralBlock {
    let trimmed = text.trim();
    let kind = if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
        StructuralKind::ListItem
    } else if trimmed.contains('\t') {
        StructuralKind::TableRow
    } else {
        StructuralKind::Paragraph
    };
    StructuralBlock {
        kind,
        text: trimmed.to_string(),
        page_start: page,
        page_end: page,
        section_path: sections.to_vec(),
        source_refs: Vec::new(),
    }
}

fn docx_text(xml: &str) -> String {
    let mut output = Vec::new();
    let mut rest = xml;

    loop {
        let paragraph = rest.find("<w:p");
        let table = rest.find("<w:tbl");
        match (paragraph, table) {
            (None, None) => break,
            (None, Some(table_start)) => {
                let table_xml = &rest[table_start..];
                let Some(table_end) = table_xml.find("</w:tbl>") else {
                    break;
                };
                append_docx_table(&mut output, &table_xml[..table_end]);
                rest = &table_xml[table_end + "</w:tbl>".len()..];
            }
            (Some(paragraph_start), Some(table_start)) if table_start < paragraph_start => {
                let table_xml = &rest[table_start..];
                let Some(table_end) = table_xml.find("</w:tbl>") else {
                    break;
                };
                append_docx_table(&mut output, &table_xml[..table_end]);
                rest = &table_xml[table_end + "</w:tbl>".len()..];
            }
            (Some(paragraph_start), _) => {
                let paragraph_xml = &rest[paragraph_start..];
                let Some(paragraph_end) = paragraph_xml.find("</w:p>") else {
                    break;
                };
                append_docx_paragraph(&mut output, &paragraph_xml[..paragraph_end]);
                rest = &paragraph_xml[paragraph_end + "</w:p>".len()..];
            }
        }
    }

    output.join("\n\n")
}

fn append_docx_paragraph(output: &mut Vec<String>, paragraph_xml: &str) {
    let text = docx_text_nodes(paragraph_xml);
    if text.trim().is_empty() {
        return;
    }

    if let Some(level) = docx_heading_level(paragraph_xml) {
        output.push(format!("{} {}", "#".repeat(level), text.trim()));
    } else if paragraph_xml.contains("<w:numPr") {
        output.push(format!("- {}", text.trim()));
    } else {
        output.push(text.trim().to_string());
    }
}

fn append_docx_table(output: &mut Vec<String>, table_xml: &str) {
    let mut rows = table_xml;
    while let Some(row_start) = rows.find("<w:tr") {
        let row_and_tail = &rows[row_start..];
        let Some(row_end) = row_and_tail.find("</w:tr>") else {
            break;
        };
        let row_xml = &row_and_tail[..row_end];
        let mut cells = Vec::new();
        let mut remaining_cells = row_xml;
        while let Some(cell_start) = remaining_cells.find("<w:tc") {
            let cell_xml = &remaining_cells[cell_start..];
            let Some(cell_end) = cell_xml.find("</w:tc>") else {
                break;
            };
            let cell_text = docx_text_nodes(&cell_xml[..cell_end]);
            if !cell_text.trim().is_empty() {
                cells.push(cell_text.trim().to_string());
            }
            remaining_cells = &cell_xml[cell_end + "</w:tc>".len()..];
        }
        if !cells.is_empty() {
            output.push(cells.join("\t"));
        }
        rows = &row_and_tail[row_end + "</w:tr>".len()..];
    }
}

fn docx_heading_level(paragraph_xml: &str) -> Option<usize> {
    let style_start = paragraph_xml.find("<w:pStyle")?;
    let style = &paragraph_xml[style_start..paragraph_xml[style_start..].find('>')? + style_start];
    let heading_start = style.find("w:val=\"Heading")? + "w:val=\"Heading".len();
    let digits = style[heading_start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    digits
        .parse::<usize>()
        .ok()
        .filter(|level| (1..=6).contains(level))
}

fn docx_text_nodes(xml: &str) -> String {
    let mut text = String::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<w:t") {
        rest = &rest[start..];
        let Some(open_end) = rest.find('>') else {
            break;
        };
        rest = &rest[open_end + 1..];
        let Some(close) = rest.find("</w:t>") else {
            break;
        };
        text.push_str(&decode_xml_entities(&rest[..close]));
        rest = &rest[close + "</w:t>".len()..];
    }
    text
}

fn decode_xml_entities(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

struct StagedFile(PathBuf);

impl Drop for StagedFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn run_extractor(
    extension: &str,
    bytes: &[u8],
    program: &str,
    arguments: &[&str],
) -> Result<String, DocumentError> {
    let staged = StagedFile(std::env::temp_dir().join(format!(
        "vokoo-document-{}.{}",
        uuid::Uuid::new_v4(),
        extension
    )));
    std::fs::write(&staged.0, bytes)
        .map_err(|error| DocumentError::new(format!("could not stage the document: {error}")))?;

    let mut command = Command::new(program);
    for argument in arguments {
        command.arg(if *argument == "{file}" {
            path_text(&staged.0)
        } else {
            *argument
        });
    }
    if program == "pdftotext" {
        command.arg(&staged.0).arg("-");
    }
    let output = command
        .output()
        .map_err(|error| DocumentError::new(format!("could not run {program}: {error}")))?;
    if !output.status.success() {
        return Err(DocumentError::new(format!(
            "{program} could not read the document: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    String::from_utf8(output.stdout)
        .map_err(|_| DocumentError::new(format!("{program} returned non-UTF-8 text")))
}

fn path_text(path: &Path) -> &str {
    path.to_str().unwrap_or_default()
}
