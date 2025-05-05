# PraxCode - Project Planning

## 1. Project Name

**PraxCode**

## 2. Vision

To create a highly flexible and context-aware AI code assistant for Visual Studio Code, empowering developers with a choice of LLMs (local, cloud APIs, routing services) and leveraging local vector indexing for deep codebase understanding, rivaling the capabilities of leading AI coding tools.

## 3. Core Philosophy

*   **Flexibility:** User choice is paramount regarding LLM providers (Ollama, OpenAI, Anthropic, Google, OpenRouter, Custom) and models.
*   **Context-Awareness:** Go beyond open files by building and utilizing a local vector index of the entire codebase for richer context in prompts, leveraging local vector indexing and potentially standardizing context delivery using the Model Context Protocol (MCP).
*   **Feature Richness:** Implement a comprehensive suite of features inspired by GitHub Copilot, Augment, Continue, etc. (Chat, Completion, Refactoring, Generation, Explanation), including agentic capabilities facilitated by structured communication with MCP-compatible LLM servers.
*   **Privacy & Local-First:** Enable fully offline workflows using local LLMs (Ollama) and local vector stores.
*   **Developer Experience:** Seamless and intuitive integration into the existing VS Code workflow.

## 4. Target Audience

Developers using Visual Studio Code who want:
*   Advanced AI coding assistance.
*   Control over the AI models they use (including local/privacy-focused options).
*   AI that understands the broader context of their project, not just the current file.

## 5. Key Features (High-Level)

*   **Multi-Provider LLM Integration:** Support for Ollama, OpenAI, Anthropic, Google Gemini, OpenRouter, and potentially custom API endpoints.
*   **Model Context Protocol (MCP) Support:** Structure context data according to the MCP specification for transmission to compatible LLM servers.
*   **Structured Response Handling:** Process structured responses from MCP servers, including defined formats for code changes, terminal commands, etc.
*   **Workspace Indexing:** Automatic background indexing of codebase using local vector storage.
*   **Contextual Chat:** Sidebar chat assistant aware of workspace context via RAG.
*   **Inline Code Completion:** Suggestions based on surrounding code and indexed context.
*   **Code Generation:** Generate code snippets/functions from instructions or chat.
*   **Code Understanding:** Explain selected code.
*   **Code Modification:** Refactor, improve, or edit selected code (with diff view).
*   **Test Generation:** Generate unit tests for selected code.
*   **Documentation Generation:** Create docstrings/comments for functions/classes.
*   **Commit Message Generation:** Suggest commit messages based on staged changes.
*   **Configuration:** User-friendly settings for provider selection, API keys (secure storage), model choice, indexing preferences.

## 6. Technical Architecture Overview

PraxCode will consist of the following core components interacting within the VS Code extension environment:

1.  **VS Code Extension Core (`extension.ts`):** Manages activation, commands, UI elements (Webviews, Status Bar), and interaction with the VS Code API. Built with TypeScript.
2.  **Configuration Manager:** Handles `settings.json`, secure storage (`SecretStorage`), and runtime configuration access.
3.  **LLM Service (Abstraction Layer):** Defines a common interface (`generate`, `chat`, `streamChat`) and implements specific providers (Ollama, OpenAI, etc.) handling API calls, authentication, and streaming.
4.  **Vector Store Service (Abstraction Layer):** Defines an interface for vector operations (`add`, `search`). Includes an implementation using a local vector database (e.g., LanceDB, ChromaDB) and handles embedding generation via configurable models (local via Ollama or API).
5.  **Indexing Service:** Scans the workspace, chunks files (ideally language-aware using Tree-sitter), generates embeddings via the Vector Store Service, and stores them locally. Handles updates and background processing.
6.  **RAG Orchestrator:** Takes user input/code context, queries the Vector Store Service for relevant code chunks, constructs the final prompt (managing context window limits), and interacts with the LLM Service.
7.  **Model Context Protocol Service:** A component responsible for generating ContextItem objects from PraxCode's various context sources (current file, RAG results, diagnostics, etc.) according to the MCP specification.
8.  **UI Components:** Sidebar Webview (React/Svelte/Vue or basic HTML/JS), Inline elements (Decorators, Inline Completion Provider), Status Bar item, Context Menus, Diff View integration.

**Flow Example (Chat Query):**
User Input (Chat) -> UI Component -> RAG Orchestrator -> Vector Store Service (Search) -> RAG Orchestrator (Prompt Assembly) -> LLM Service (API Call to selected provider) -> LLM Service (Stream Response) -> UI Component (Display Response)

**Flow Example (Chat Query with MCP):**
User Input (Chat) -> UI Component -> RAG Orchestrator / Other Context Sources -> Model Context Protocol Service (Generate ContextItems) -> LLM Service (Detect MCP support, format MCP Request) -> LLM Endpoint (MCP Server) -> LLM Endpoint (MCP Response with ContextItems + potential structured actions) -> LLM Service (Parse MCP Response) -> Action Execution Service (Handle structured actions) / UI Component (Display text response)

## 7. Technology Stack

*   **Language:** TypeScript
*   **Platform:** Node.js (within VS Code Extension Host)
*   **Core:** VS Code API (`vscode`)
*   **UI (Webview):** HTML, CSS, TypeScript (potentially with a lightweight framework like Preact or Svelte if needed)
*   **LLM Interaction:** `axios` or `node-fetch` for direct API calls, potentially official SDKs (OpenAI, Anthropic, Google). Ollama client library.
*   **Vector Store:** LanceDB (recommended for zero-copy, local-first WASM/Node bindings), or alternatives like ChromaDB embedded, Faiss bindings.
*   **Language Parsing (for chunking):** Tree-sitter (via Node bindings)
*   **Model Context Protocol:** Library or manual implementation based on the MCP specification.
*   **Parsing:** Libraries/logic for parsing structured JSON responses from MCP servers.
*   **Packaging:** `vsce` (VS Code Extension manager), `webpack` or `esbuild` for bundling.

## 8. Development Roadmap (Iterative)

*   **Milestone 1: MVP (Core Functionality)**
    *   Basic Extension Setup & Configuration (Ollama + OpenAI).
    *   LLM Service + Ollama/OpenAI Providers.
    *   Basic Sidebar Chat (no RAG).
    *   Vector Store Service (LanceDB) + Manual Indexing (simple chunking).
    *   Basic RAG Integration in Chat.
    *   "Explain Code" command (using RAG).
*   **Milestone 2: Feature Expansion**
    *   Add more LLM Providers (Anthropic, Google, OpenRouter).
    *   Basic Inline Code Completion.
    *   Improved Indexing (Tree-sitter chunking, auto-index on save).
    *   "Generate Docs" & "Generate Tests" commands.
    *   Status Bar Indicator.
    *   Secure Secret Storage for API keys.
*   **Milestone 3: Polish & Advanced Features**
    *   Refactoring / Inline Edits (`/edit`) with Diff View.
    *   Commit Message Generation.
    *   UI/UX Refinements (streaming, code rendering).
    *   Performance Optimizations (indexing, RAG).
    *   Advanced Configuration (include/exclude, embedding model choice).
*   **Milestone Y: Model Context Protocol Integration**
    *   Implement ModelContextProtocolService.
    *   Adapt LLM Service for conditional MCP request/response handling.
    *   Find or setup a test MCP-compatible LLM endpoint.
    *   Adapt Action Execution Service to handle structured action responses from MCP.
    *   Future: Deeper integration with MCP features as the spec evolves and server support grows.
*   **Future:** Symbol indexing, advanced agentic features, further optimizations.

## 9. Key Considerations & Risks

*   **Performance:** Indexing time/resources, vector search speed, LLM latency (mitigated by streaming, local options).
*   **Prompt Engineering:** Designing effective prompts for diverse tasks and models is crucial and requires iteration.
*   **Context Window Management:** Strategies for selecting and truncating context effectively.
*   **Accuracy:** LLM limitations (hallucinations); clearly label AI output. RAG quality depends heavily on chunking and retrieval.
*   **Security:** Secure API key storage is critical. Clear communication about data flow (especially with cloud LLMs).
*   **Error Handling:** Robust handling of API failures, network issues, indexing problems.
*   **Dependencies:** Managing dependencies, especially native ones (like Vector DBs or Tree-sitter), for cross-platform compatibility.
*   **Suggestion Quality:** Ensuring code change suggestions and terminal commands are accurate, relevant, and properly formatted.
*   **Action Execution:** Reliable execution of suggested actions (applying code changes, running terminal commands) with proper error handling and user feedback.
*   **Server Support:** The main challenge is that standard LLM APIs (OpenAI, Anthropic, Google) do not currently support the Model Context Protocol natively. You would need to:
    *   Find an LLM model hosted on a platform that does support MCP.
    *   Use a router (like OpenRouter, if it adds MCP support) that routes requests to MCP-aware endpoints.
    *   Build/run a local proxy server that sits between PraxCode and a local LLM (Ollama) and translates between MCP and the LLM's native API (a significant undertaking).
*   **Spec Stability:** As a newer protocol, the MCP spec might evolve. PraxCode's implementation needs to be adaptable.
*   **Feature Overlap:** Ensure the MCP integration enhances, rather than replaces, the existing context and action mechanisms (like RAG and WorkspaceEdit), providing a potential alternative standardized communication path.

## 10. Debugging & Improvement Plan for Agent Mode

### Current Issues

1. **Code Change Suggestions:**
   * Redundancy: Multiple identical suggestions.
   * Simplicity: Suggestions often echo back context rather than generating meaningful changes.
   * Context Mismatch: RAG sometimes retrieves markdown or documentation instead of actual code.

2. **Terminal Command Suggestions:**
   * Incorrect Format: Suggestions are often file paths/metadata rather than valid terminal commands.
   * Non-Functionality: "Apply" and "Run" buttons sometimes do nothing when clicked.

### Improvement Strategy

#### Phase 1: Fixing the Non-Functionality ("Apply" / "Run" Buttons) ✅

This is crucial because even if suggestions were perfect, they're useless if they can't be applied.

1. **Verify Webview → Extension Communication** ✅
   * Add detailed console.log statements in the webview's JavaScript.
   * Log click events, associated data, and messages sent to the extension host.

2. **Verify Extension ← Webview Communication** ✅
   * Log message receipt and content in the extension.
   * Ensure messages match what the webview intended to send.

3. **Verify Data Routing & Action Service Call** ✅
   * Confirm correct message type identification.
   * Verify data extraction and service function calls.

4. **Debug ActionExecutionService - Apply Code Changes** ✅
   * Log code change data, WorkspaceEdit objects, confirmation dialogs, and edit application.
   * Implement robust error handling and user feedback.

5. **Debug ActionExecutionService - Run Terminal Command** ✅
   * Log command strings, confirmation dialogs, terminal creation/access, and command execution.
   * Add error handling and visual feedback.

#### Phase 2: Improving Suggestion Accuracy (LLM/Prompt/RAG) ✅

Once the buttons work, focus on the quality of suggestions.

1. **Log the Entire LLM Interaction** ✅
   * Record prompts, RAG context, and raw responses.
   * Analyze for patterns and issues.

2. **Analyze Prompts for Code Changes** ✅
   * Review clarity, context provision, and output format specification.
   * Refine prompts to be more specific about desired changes.

3. **Analyze Prompts for Terminal Commands** ✅
   * Ensure explicit requests for shell/terminal commands.
   * Verify RAG context relevance for command generation.

4. **Review RAG Context Relevance** ✅
   * Evaluate if retrieved content helps with the specific task.
   * Adjust query specificity, file type filtering, and chunking strategy.

5. **Refine LLM Response Parsing** ✅
   * Compare raw responses to what's displayed/used.
   * Improve parsing logic for code blocks, diffs, and commands.

## 11. Diff-Based Code Change Implementation

### Completed Improvements

1. **Added Diff Parsing Library** ✅
   * Added the `diff` npm package to dependencies
   * Created a new `DiffParser` service to handle parsing unified diffs

2. **Created Diff Parser Service** ✅
   * Implemented `DiffParser` class with methods to parse diffs and create workspace edits
   * Added interfaces for parsed diffs and hunks

3. **Enhanced ActionExecutionService** ✅
   * Added methods to apply changes from diff strings
   * Implemented preview functionality for diffs

4. **Updated ActionableItems** ✅
   * Added methods to detect and handle diff-based code changes
   * Implemented diff format detection and creation

5. **Enhanced LLMResponseParser** ✅
   * Improved diff parsing capabilities
   * Added support for extracting file paths from diffs

6. **Added Diff Format Prompt** ✅
   * Created a prompt to instruct the LLM to provide changes in diff format
   * Added the prompt to system messages in ChatPanel and ChatWebviewProvider

### Benefits of Diff-Based Changes

1. **Precision**: Changes can be applied to specific parts of files rather than replacing entire files
2. **Context**: Diffs provide clear before/after context for changes
3. **Clarity**: Easier for users to understand what changes are being made
4. **Reliability**: More robust application of changes with proper error handling

### Future Enhancements

1. **Improved Diff Visualization**: Enhance the diff preview UI
2. **Multi-File Diffs**: Support applying diffs across multiple files in a single operation
3. **Conflict Resolution**: Add better handling for cases where the file has changed since indexing
4. **Unit Testing**: Add comprehensive tests for diff parsing and application