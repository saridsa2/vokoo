use std::path::PathBuf;

use vokoo_compiler_spike::{compile_document_with_minimax, compile_with_minimax, CatalogueNode};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let first = args.next().ok_or(
        "usage: vokoo-compiler-spike <request.txt> [catalogue.json]\n       vokoo-compiler-spike document <source.pdf> [catalogue.json]",
    )?;
    let document_mode = first == "document";
    let source_path = if document_mode {
        args.next()
            .map(PathBuf::from)
            .ok_or("document mode requires a source PDF")?
    } else {
        PathBuf::from(first)
    };
    let catalogue_path = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("../../docs/flow-node-catalogue.json"));

    let catalogue: Vec<CatalogueNode> =
        serde_json::from_str(&std::fs::read_to_string(&catalogue_path)?)?;
    let api_key = std::env::var("MINIMAX_API_KEY").map_err(|_| "MINIMAX_API_KEY is required")?;
    let model = std::env::var("VOKOO_COMPILER_MODEL").unwrap_or_else(|_| "MiniMax-M3".into());

    if document_mode {
        let report =
            compile_document_with_minimax(&api_key, &model, &source_path, &catalogue).await?;
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        let request = std::fs::read_to_string(&source_path)?;
        let draft = compile_with_minimax(&api_key, &model, &request, &catalogue).await?;
        println!("{}", serde_json::to_string_pretty(&draft)?);
    }
    Ok(())
}
