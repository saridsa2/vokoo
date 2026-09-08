use sha2::{Digest, Sha256};

use super::{ExtractedDocument, StructuralBlock};

pub const CHUNKER_VERSION: &str = "clinical-structure-v1";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChunkConfig {
    pub target_min_tokens: usize,
    pub target_max_tokens: usize,
    pub overlap_tokens: usize,
    pub hard_max_tokens: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            target_min_tokens: 600,
            target_max_tokens: 900,
            overlap_tokens: 100,
            hard_max_tokens: 1_200,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentChunk {
    pub ordinal: usize,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub section_path: Vec<String>,
    pub content: String,
    pub token_count: usize,
    pub content_sha256: String,
    pub layout_item_refs: Vec<String>,
}

#[derive(Clone, Debug)]
struct ChunkProvenance {
    page_start: Option<usize>,
    page_end: Option<usize>,
    section_path: Vec<String>,
    layout_item_refs: Vec<String>,
}

impl From<&StructuralBlock> for ChunkProvenance {
    fn from(block: &StructuralBlock) -> Self {
        Self {
            page_start: block.page_start,
            page_end: block.page_end,
            section_path: block.section_path.clone(),
            layout_item_refs: block.source_refs.clone(),
        }
    }
}

pub fn chunk_document(document: &ExtractedDocument, config: &ChunkConfig) -> Vec<DocumentChunk> {
    let mut chunks = Vec::new();
    let mut pending = Vec::<String>::new();
    let mut pending_meta: Option<ChunkProvenance> = None;

    for block in &document.blocks {
        let words = block
            .text
            .split_whitespace()
            .map(str::to_string)
            .collect::<Vec<_>>();
        if words.is_empty() {
            continue;
        }

        if words.len() > config.target_max_tokens {
            flush(&mut chunks, &mut pending, pending_meta.as_ref(), config);
            pending_meta = None;
            let step = config
                .target_max_tokens
                .saturating_sub(config.overlap_tokens)
                .max(1);
            let mut start = 0;
            let provenance = ChunkProvenance::from(block);
            while start < words.len() {
                let end = (start + config.target_max_tokens).min(words.len());
                push_chunk(&mut chunks, &words[start..end], &provenance);
                if end == words.len() {
                    break;
                }
                start += step;
            }
            continue;
        }

        let section_changed = pending_meta
            .as_ref()
            .is_some_and(|meta| meta.section_path != block.section_path);
        if !pending.is_empty()
            && (pending.len() + words.len() > config.target_max_tokens || section_changed)
        {
            flush(&mut chunks, &mut pending, pending_meta.as_ref(), config);
            pending_meta = None;
        }
        if pending_meta.is_none() {
            pending_meta = Some(ChunkProvenance::from(block));
        } else if let Some(meta) = pending_meta.as_mut() {
            meta.page_end = block.page_end.or(meta.page_end);
            for reference in &block.source_refs {
                if !meta.layout_item_refs.contains(reference) {
                    meta.layout_item_refs.push(reference.clone());
                }
            }
        }
        pending.extend(words);
    }
    flush(&mut chunks, &mut pending, pending_meta.as_ref(), config);
    chunks
}

fn flush(
    chunks: &mut Vec<DocumentChunk>,
    pending: &mut Vec<String>,
    meta: Option<&ChunkProvenance>,
    config: &ChunkConfig,
) {
    if pending.is_empty() {
        return;
    }
    if let Some(meta) = meta {
        if pending.len() <= config.hard_max_tokens {
            push_chunk(chunks, pending, meta);
        }
    }
    pending.clear();
}

fn push_chunk(chunks: &mut Vec<DocumentChunk>, words: &[String], meta: &ChunkProvenance) {
    let content = words.join(" ");
    let content_sha256 = format!("{:x}", Sha256::digest(content.as_bytes()));
    chunks.push(DocumentChunk {
        ordinal: chunks.len(),
        page_start: meta.page_start,
        page_end: meta.page_end,
        section_path: meta.section_path.clone(),
        token_count: words.len(),
        content,
        content_sha256,
        layout_item_refs: meta.layout_item_refs.clone(),
    });
}
