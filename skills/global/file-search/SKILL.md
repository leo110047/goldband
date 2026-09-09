---
name: file-search
description: Find files, symbols, usages, and text with scoped ripgrep searches. Use syntax-aware search only when the task needs it and the tool is available.
license: MIT
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# File Search

Use `rg --files` to locate files and scoped `rg -n` searches to locate content.
Read the relevant context before making a behavioral claim.

- Start with the likely directory, file type, or symbol; broaden only when the
  result does not answer the question.
- Regex matches do not establish syntax or runtime behavior. Check the code,
  or use an available AST-aware tool when structure matters.
- Check tool availability when needed; portable instructions do not establish
  which binaries are installed in the current environment.
- No matches do not prove absence: consider ignored files, generated output,
  symlinks, and the search pattern before drawing that conclusion.
- Limit raw output and follow relevant leads instead of dumping broad matches.
