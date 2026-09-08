use std::sync::Arc;
use std::time::Duration;

use rustvani::vokoo::documents::{
    chunk_document, extract_document, normalize_docling_json, ChunkConfig, ContentLayer,
    DoclingCommandProvider, DocumentExtractionProvider, ExtractionRequest, StructuralKind,
    CHUNKER_VERSION, DOCX_MIME,
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

#[test]
fn docling_layout_preserves_pages_reading_order_and_source_boxes() {
    let artifact = include_str!("fixtures/documents/docling-layout.json");
    let extraction = normalize_docling_json(
        artifact,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "1.37.0",
    )
    .expect("the Docling fixture should normalize");

    assert_eq!(extraction.schema_version, "layout-v1");
    assert_eq!(extraction.provider, "docling-rs");
    assert_eq!(extraction.pages.len(), 2);
    assert_eq!(extraction.pages[1].page_number, 2);
    assert_eq!(extraction.pages[1].width_points, 612.0);

    let recommendation = extraction
        .items
        .iter()
        .find(|item| item.text.contains("58 mmol/mol"))
        .expect("recommendation item");
    assert_eq!(recommendation.ordinal, 2);
    assert_eq!(recommendation.label, "list_item");
    assert_eq!(
        recommendation.section_path,
        vec!["Type 2 diabetes in adults", "Blood glucose management"]
    );
    assert_eq!(recommendation.spans[0].page_number, 2);
    assert_eq!(recommendation.spans[0].bbox.left, 80.0);
    assert_eq!(recommendation.spans[0].bbox.top, 510.0);
    assert_eq!(recommendation.spans[0].bbox.origin, "BOTTOMLEFT");
}

#[test]
fn docling_furniture_is_retained_but_never_indexed() {
    let extraction = normalize_docling_json(
        include_str!("fixtures/documents/docling-layout.json"),
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "1.37.0",
    )
    .unwrap();

    assert_eq!(
        extraction
            .items
            .iter()
            .filter(|item| item.content_layer == ContentLayer::Furniture)
            .count(),
        2
    );
    let indexable = extraction.indexable_text();
    assert!(indexable.contains("Escalate treatment"));
    assert!(!indexable.contains("NICE guideline NG28"));
}

#[test]
fn docling_layout_rejects_a_box_outside_its_page() {
    let invalid = include_str!("fixtures/documents/docling-layout.json").replacen(
        "\"r\": 530.0",
        "\"r\": 900.0",
        1,
    );
    let problem = normalize_docling_json(
        &invalid,
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "1.37.0",
    )
    .expect_err("an impossible source box must be rejected");

    assert!(problem.to_string().contains("outside page 2"));
}

#[cfg(unix)]
#[tokio::test]
async fn docling_command_provider_uses_the_pdf_layout_pipeline_and_cleans_up() {
    use std::os::unix::fs::PermissionsExt;

    let unique = uuid::Uuid::new_v4();
    let directory = std::env::temp_dir().join(format!("vokoo-docling-provider-{unique}"));
    std::fs::create_dir_all(&directory).unwrap();
    let executable = directory.join("docling-rs");
    let arguments = directory.join("arguments.txt");
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/documents/docling-layout.json");
    let script = format!(
        "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'docling-rs 1.37.0'\n  exit 0\nfi\nprintf '%s\\n' \"$@\" > '{}'\nexec /bin/cat '{}'\n",
        arguments.display(),
        fixture.display(),
    );
    std::fs::write(&executable, script).unwrap();
    let mut permissions = std::fs::metadata(&executable).unwrap().permissions();
    permissions.set_mode(0o700);
    std::fs::set_permissions(&executable, permissions).unwrap();

    let provider =
        DoclingCommandProvider::new(&executable, "1.37.0", Duration::from_secs(2), 1024 * 1024);
    let extraction = provider
        .extract(ExtractionRequest {
            mime_type: "application/pdf".into(),
            source_sha256: "60c11e4424fe3971f1f4d49aff55bcf07633895cd557176048a623d46bc1193f"
                .into(),
            bytes: Arc::from(include_bytes!("fixtures/documents/guideline.pdf").as_slice()),
        })
        .await
        .expect("the command provider should normalize its result");

    assert_eq!(extraction.provider_version, "1.37.0");
    let recorded = std::fs::read_to_string(&arguments).unwrap();
    let args = recorded.lines().collect::<Vec<_>>();
    assert_eq!(
        &args[..4],
        ["--to", "json", "--heading-hierarchy", "--skip-ocr"]
    );
    let staged = args.last().expect("staged PDF argument");
    assert!(staged.ends_with(".pdf"));
    assert!(!std::path::Path::new(staged).exists());

    std::fs::remove_dir_all(directory).unwrap();
}
