# ML Research Bench Scaffold

Starter Vibe Research scaffold for ML benchmark/meta-experiment work.

This recipe intentionally keeps benchmarking in the normal Vibe Research system rather than adding a separate benchmark mode. It captures:

- the Library and Occupations buildings for the research ledger
- BuildingHub and Scaffold Recipes for sharing/importing setup state
- Harbor/Modal-style sandbox assumptions for isolated runs and optional GPU work
- workspace-visible, auditable free-form agent DMs with group inboxes for GPU and review coordination
- local bindings for workspace path, Library path, and provider API keys, without exporting those values

Apply it from Vibe Research with the scaffold recipe API or `vr-scaffold-recipe`, then supply local bindings on the receiving machine.
