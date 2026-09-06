# Compiler agent spike

This isolated spike proves one boundary: an AISDK agent can emit both agent
drafts and flow drafts, while deterministic code limits every flow component
and edge outcome to the checked-in platform catalogue.

It writes nothing to the database and publishes nothing.

```sh
cd spikes/compiler-agent
MINIMAX_API_KEY=... cargo run -- fixtures/appointment-request.txt
```

`VOKOO_COMPILER_MODEL` selects the MiniMax model and defaults to `MiniMax-M3`.
The optional second argument selects a different catalogue JSON file.
