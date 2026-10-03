# Instrument identity — current decision

`conid` is the instrument identity across Orbit modules. Symbols and company names are display metadata, not durable cross-module keys.
`InstrumentIdentityService` owns conid-to-display identity and the instruments cache. IBKR symbol resolution remains a separate concern.
Quote, search, conid resolution and instrument reads use the shared identity boundary; product modules must not create competing display caches.
Missing metadata must remain visible rather than becoming an invented ticker or company name.
See [module boundaries](../../architecture/modules.md). Inflect-specific consumers and migration steps are retired.
