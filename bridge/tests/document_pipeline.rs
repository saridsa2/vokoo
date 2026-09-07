use rustvani::vokoo::documents::{
    chunk_document, extract_document, ChunkConfig, StructuralKind, CHUNKER_VERSION, DOCX_MIME,
};

#[test]
fn text_pages_keep_physical_provenance() {
    let source = b"Scope\x0cRecommendation\nEscalate after 14 days.";
    let extracted = extract_document("text/plain", source).expect("plain text should extract");

    assert_eq!(extracted.pages.len(), 2);
    assert_eq!(extracted.pages[1].physical_page, Some(2));
    assert!(extracted.pages[1].text.contains("Escalate after 14 days"));
}

#[test]
fn pdf_pages_keep_physical_provenance() {
    let source = include_bytes!("fixtures/documents/guideline.pdf");
    let extracted = extract_document("application/pdf", source).expect("PDF should extract");

    assert_eq!(extracted.pages.len(), 2);
    assert_eq!(extracted.pages[1].physical_page, Some(2));
    assert!(extracted.pages[1].text.contains("Escalate after 14 days"));
}

#[test]
fn markdown_headings_become_chunk_provenance() {
    let source = b"# Diabetes\n\n## Escalation\n\nEscalate treatment when HbA1c remains high.";
    let extracted = extract_document("text/markdown", source).expect("markdown should extract");
    let chunks = chunk_document(&extracted, &ChunkConfig::default());

    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].section_path, vec!["Diabetes", "Escalation"]);
}

#[test]
fn a_chunk_spanning_pages_records_the_full_page_range() {
    let source = b"First page recommendation.\x0cSecond page rationale.";
    let extracted = extract_document("text/plain", source).expect("plain text should extract");
    let chunks = chunk_document(&extracted, &ChunkConfig::default());

    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].page_start, Some(1));
    assert_eq!(chunks[0].page_end, Some(2));
}

#[test]
fn corrupt_docx_is_rejected() {
    let problem = extract_document(DOCX_MIME, b"not a zip").expect_err("corrupt DOCX must fail");

    assert!(problem.to_string().contains("could not read"));
}

#[test]
fn docx_headings_lists_and_table_cells_remain_structured() {
    let bytes = include_bytes!("fixtures/documents/guideline.docx");
    let extracted = extract_document(DOCX_MIME, bytes).expect("DOCX should extract");

    assert!(extracted
        .blocks
        .iter()
        .any(|block| block.section_path == vec!["Diabetes pathway"]));
    assert!(
        extracted
            .blocks
            .iter()
            .any(|block| block.kind == StructuralKind::ListItem
                && block.text.contains("Review HbA1c"))
    );
    assert!(extracted
        .blocks
        .iter()
        .any(|block| block.kind == StructuralKind::TableRow
            && block.text.contains("Escalate above 58 mmol/mol")));
}

#[test]
fn clinical_chunks_are_bounded_and_deterministic() {
    let mut source = String::from("# Monitoring\n\n");
    for _ in 0..1_000 {
        source.push_str("Monitor symptoms and record the result every day. ");
    }
    let extracted = extract_document("text/markdown", source.as_bytes()).unwrap();

    let first = chunk_document(&extracted, &ChunkConfig::default());
    let second = chunk_document(&extracted, &ChunkConfig::default());

    assert_eq!(CHUNKER_VERSION, "clinical-structure-v1");
    assert_eq!(first, second);
    assert!(first.len() > 1);
    assert!(first.iter().all(|chunk| chunk.token_count <= 1_200));
    assert!(first[..first.len() - 1]
        .iter()
        .all(|chunk| (600..=900).contains(&chunk.token_count)));
    let first_words = first[0].content.split_whitespace().collect::<Vec<_>>();
    let second_words = first[1].content.split_whitespace().collect::<Vec<_>>();
    assert_eq!(
        &first_words[first_words.len() - 100..],
        &second_words[..100]
    );
    assert!(first
        .iter()
        .enumerate()
        .all(|(index, chunk)| chunk.ordinal == index));

    let changed = extract_document("text/markdown", b"# Monitoring\n\nDifferent content.").unwrap();
    let changed = chunk_document(&changed, &ChunkConfig::default());
    assert_ne!(first[0].content_sha256, changed[0].content_sha256);
}

#[test]
fn a_short_recommendation_keeps_its_condition_and_escalation() {
    let source = b"# Follow-up\n\nIf symptoms persist after fourteen days, escalate to specialist review.\n\nRecord the reason for escalation.";
    let extracted = extract_document("text/markdown", source).unwrap();
    let chunks = chunk_document(&extracted, &ChunkConfig::default());

    let escalation = chunks
        .iter()
        .find(|chunk| chunk.content.contains("escalate to specialist"))
        .expect("recommendation chunk");
    assert!(escalation.content.contains("If symptoms persist"));
    assert!(escalation.content.contains("Record the reason"));
}
