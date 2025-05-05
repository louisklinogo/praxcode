# PraxCode - Task Breakdown

This document outlines the specific tasks required to build PraxCode, broken down by milestones.

## Legend

*   `[ ]` To Do
*   `[x]` Done
*   `(P0)` Highest Priority
*   `(P1)` Medium Priority
*   `(P2)` Lower Priority

## Milestone 1: MVP (Core Functionality)

### Setup & Core Structure (P0)
*   [x] Initialize VS Code Extension project (`yo code`) using TypeScript template.
*   [x] Set up build process (e.g., `esbuild` or `webpack`) and `tsconfig.json`.
*   [x] Set up linting (`eslint`) and formatting (`prettier`).
*   [x] Define basic extension activation/deactivation logic in `extension.ts`.
*   [x] Add basic logging framework.

### Configuration Management (P0)
*   [x] Create `ConfigurationManager` class to read VS Code settings (`workspace.getConfiguration`).
*   [x] Define initial settings structure in `package.json` (LLM provider choice, Ollama URL, OpenAI Key placeholder).
*   [x] Implement secure storage for API keys using `vscode.SecretStorage`. (Defer UI interaction for keys to later).

### LLM Service (P0)
*   [x] Define `LLMService` abstract interface (`chat`, `streamChat` methods).
*   [x] Implement `OllamaProvider` conforming to `LLMService` (connect to local Ollama API).
*   [x] Implement `OpenAIProvider` conforming to `LLMService` (connect to OpenAI API, handle API key from `ConfigurationManager`).
*   [x] Implement basic error handling for API requests.

### Basic UI - Sidebar Chat (P1)
*   [x] Create a basic Sidebar Webview using `vscode.window.createWebviewPanel`.
*   [x] Implement basic HTML/CSS/JS structure for chat input and message display area in the webview.
*   [x] Establish message passing (VS Code <-> Webview) for sending prompts and receiving responses.
*   [x] Connect chat input to `LLMService` (initially without RAG).
*   [x] Display streaming LLM responses in the chat view.

### Vector Store & Indexing (P1)
*   [x] Add `LanceDB` Node.js dependency.
*   [x] Define `VectorStoreService` interface (`initialize`, `addDocuments`, `similaritySearch`).
*   [x] Implement `LanceDBAdapter` conforming to `VectorStoreService`.
*   [x] Implement basic embedding generation (choose initial method: Ollama `nomic-embed-text` or OpenAI `text-embedding-ada-002` via API - make configurable later).
*   [x] Create `IndexingService` class.
*   [x] Implement manual indexing command:
    *   [x] Use `vscode.workspace.findFiles` to find text files.
    *   [x] Implement simple fixed-size, overlapping chunking strategy.
    *   [x] Generate embeddings for chunks using `VectorStoreService`.
    *   [x] Add documents (text chunks + embeddings) to LanceDB via `VectorStoreService`.
    *   [x] Add basic progress notification (`window.withProgress`).

### RAG Orchestrator & Integration (P1)
*   [x] Create `RAGOrchestrator` class.
*   [x] Implement logic to take user query, get embeddings.
*   [x] Query `VectorStoreService` for relevant chunks (similarity search).
*   [x] Implement basic prompt assembly: Combine System Prompt + Retrieved Chunks + User Query.
*   [x] Implement basic context window truncation (simple length limit).
*   [x] Modify Sidebar Chat UI logic to use `RAGOrchestrator` before calling `LLMService`.

### Feature: Explain Code (P2)
*   [x] Add "PraxCode: Explain Selection" command to the command palette and context menu.
*   [x] Get selected text (`editor.selection`).
*   [x] Send selected text + RAG context (using `RAGOrchestrator`) to `LLMService` with an "Explain this code" prompt.
*   [x] Display the explanation result in a dedicated Webview.

### Testing & Docs (P2)
*   [x] Set up basic unit testing framework (e.g., `jest` or `mocha`).
*   [x] Write initial unit tests for core utility functions.
*   [x] Create initial `README.md` with setup and basic usage instructions.

## Milestone 2: Feature Expansion

### More LLM Providers (P1)
*   [ ] Implement `AnthropicProvider`.
*   [ ] Implement `GoogleProvider` (Gemini).
*   [ ] Implement `OpenRouterProvider`.
*   [ ] Update `ConfigurationManager` and settings UI (if any) to support selection and key management for new providers.

### Inline Code Completion (P1)
*   [ ] Register an `InlineCompletionItemProvider`.
*   [ ] Get code context around the cursor position.
*   [ ] (Option 1 - Simple) Send prefix/suffix context to `LLMService` for completion.
*   [ ] (Option 2 - Advanced) Integrate `RAGOrchestrator` to add relevant indexed context to the completion prompt (requires performance tuning).
*   [ ] Implement logic to handle LLM response and format as `InlineCompletionItem`.
*   [ ] Add configuration to enable/disable inline completion.

### Indexing Improvements (P1)
*   [ ] Integrate `Tree-sitter` for language-aware chunking (functions, classes). Select initial languages (e.g., TS/JS, Python).
*   [ ] Implement automatic re-indexing on file save (debounced).
*   [ ] Add configuration for include/exclude file patterns for indexing.
*   [ ] Add configuration to choose the embedding model (from a list of supported local/API models).

### Feature: Generate Docs (P2)
*   [ ] Add "PraxCode: Generate Documentation" command/context menu item.
*   [ ] Identify the code construct (function/class) at the selection/cursor using Tree-sitter or basic regex.
*   [ ] Send code + RAG context to `LLMService` with a "Generate docstring" prompt.
*   [ ] Insert the generated docstring above the selection.

### Feature: Generate Tests (P2)
*   [ ] Add "PraxCode: Generate Unit Tests" command/context menu item.
*   [ ] Identify the code construct (function/class) at the selection/cursor.
*   [ ] Send code + RAG context to `LLMService` with a "Generate unit tests" prompt.
*   [ ] Display generated tests in chat or offer to create a new test file.

### UI & UX (P1)
*   [ ] Implement Status Bar Item showing current LLM, indexing status (idle, indexing, error).
*   [ ] Improve Webview UI (better code block rendering with copy button, clearer visual distinction between user/AI).
*   [ ] Refine streaming response handling for smoother display.

### Testing & Docs (P2)
*   [ ] Add integration tests for core flows (e.g., chat with RAG).
*   [ ] Expand unit test coverage.
*   [ ] Update `README.md` and potentially add more detailed documentation.

## Milestone 3: Polish & Advanced Features

### Feature: Refactoring / Inline Edits (P1)
*   [ ] Add "PraxCode: Refactor Selection" command/context menu item.
*   [ ] Add inline command capability (e.g., using `/edit` in a comment or quick input).
*   [ ] Send selected code + instruction + RAG context to `LLMService`.
*   [ ] Receive modified code suggestion from LLM.
*   [x] Implement VS Code Diff View (`vscode.diff`) to show proposed changes.
*   [x] Provide actions to accept/reject the changes.

### Diff-Based Code Change System (P0)
*   [x] Add `diff` npm package for parsing unified diffs.
*   [x] Create `DiffParser` service to handle parsing unified diffs into structured data.
*   [x] Implement methods to convert parsed diffs to VS Code WorkspaceEdit objects.
*   [x] Enhance `ActionExecutionService` with methods to apply changes from diff strings.
*   [x] Update `ActionableItems` to detect and handle diff-based code changes.
*   [x] Improve `LLMResponseParser` to better extract file paths and content from diffs.
*   [x] Create system prompts to instruct the LLM to provide changes in diff format.
*   [x] Add diff preview functionality before applying changes.

### Feature: Commit Message Generation (P1)
*   [ ] Add a button or command in the SCM (Source Control Management) view.
*   [ ] Get staged changes using `git diff --staged` (via VS Code SCM API or shell command).
*   [ ] Send diff output + RAG context (optional, maybe based on changed files) to `LLMService`.
*   [ ] Populate the SCM input box with the suggested commit message.

### Performance & Optimization (P1)
*   [x] Optimize code change application with precise diff-based edits.
*   [x] Improve LLM response parsing for better extraction of actionable items.
*   [ ] Profile indexing process and optimize chunking/embedding/storage.
*   [ ] Optimize vector search queries.
*   [ ] Analyze and optimize RAG prompt construction and context selection/truncation logic.
*   [ ] Investigate caching strategies (e.g., for embeddings, common LLM queries).

### Configuration Enhancements (P2)
*   [ ] Add settings UI (potentially a webview) for easier configuration of providers, models, API keys, and indexing.
*   [ ] Allow specifying custom API endpoints for LLM providers.

### Error Handling & Robustness (P1)
*   [x] Comprehensive review and enhancement of error handling for code changes (parsing failures, file not found, application errors).
*   [x] Provide clearer error messages to the user via notifications or chat for code change operations.
*   [ ] Comprehensive review and enhancement of error handling for other components (network, API limits, indexing failures, etc.).

### Testing & Docs (P2)
*   [ ] Add end-to-end tests simulating user interaction.
*   [ ] Finalize documentation, including configuration options and troubleshooting.
*   [ ] Consider adding basic telemetry (opt-in) for error reporting and feature usage.

## Future / Backlog

*   [ ] Implement Symbol Indexing for `@` mentions in chat.
*   [ ] Explore multi-modal capabilities if supported by chosen LLMs.
*   [ ] Investigate more complex agentic workflows (e.g., multi-step tasks).
*   [ ] Add support for fine-tuning local models based on codebase (very advanced).
*   [ ] Community features (sharing prompts, etc.).