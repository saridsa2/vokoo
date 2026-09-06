# Compiler agent spike

This isolated spike exercises two compiler inputs through the same boundary:

- a short text request, compiled directly into agent and flow drafts;
- a raw PDF, mapped by physical page and decomposed by an AISDK supervisor into
  at most four bounded worker tasks before deterministic linking.

Workers emit agent and flow drafts while deterministic code limits every flow
component and edge outcome to the checked-in platform catalogue. The document
report keeps the page map, supervisor exclusions and gaps, every worker result,
and any merge failures visible. A worker page range is the provenance envelope
for its fragment.

Raw external documents do not implicitly authorize operational entry points.
A worker only receives a trigger as active when its source pages explicitly
name that VoKoo trigger ID. This deliberately makes an unbound clinical
guideline produce reusable agent drafts and catalogue-gap notes rather than an
invented call or integration flow.

It writes nothing to the database and publishes nothing.

```sh
cd spikes/compiler-agent
MINIMAX_API_KEY=... cargo run -- fixtures/appointment-request.txt

# Requires Poppler's pdftotext command. The source PDF remains outside the repo.
MINIMAX_API_KEY=... cargo run -- document /path/to/source.pdf
```

`VOKOO_COMPILER_MODEL` selects the MiniMax model and defaults to `MiniMax-M3`.
The optional second argument selects a different catalogue JSON file.
