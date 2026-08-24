---
name: effect-best-practices
version: 1.0.0
---

# Effect projection

- Use `Effect.Service` and `Effect.fn` for business logic.
- Use `Schema.TaggedError` for public failures and preserve specific tags.
- Keep infrastructure in layers and flatten composition with `Layer.mergeAll`.
- Do not throw inside `Effect.gen`, use `catchAll`, or run Effects inside services.
- The package root must expose plain Promise values; `/effect` owns Effect values.
- Run strict Effect language-service diagnostics in CI.
