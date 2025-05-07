# RAG-Only Mode Implementation Plan

## Core Concept
When a user types a query in the chat and PraxCode detects that the configured LLM provider is unavailable (offline, API key missing, connection error, explicit "none" setting), it skips the step of sending the query to the LLM. Instead, it directly performs the RAG retrieval step and presents the raw results (the retrieved code chunks and their source locations) to the user in the chat UI.

## Implementation Plan

### 1. Configuration/Detection of LLM Availability
- **Task 1.1: Add LLM Availability Check**
  - Create a function in LLMService or a dedicated LLMStatusService that can quickly check the operational status of the currently configured LLM provider.
  - Check if a provider is configured at all (configuration.get('llmProvider')).
  - For API providers (OpenAI, Anthropic), check if the API key is configured in SecretStorage.
  - For Ollama, attempt a small, quick ping to the configured URL.
  - Add an explicit "None" option in the LLM provider setting.

- **Task 1.2: Integrate Status into UI**
  - Update the Status Bar item or add an indicator in the chat UI to clearly show the current LLM connection status.
  - This helps manage user expectations.

### 2. Modify RAG Orchestrator / Chat Flow
- **Task 2.1: Introduce Conditional Logic**
  - In the main chat message handling logic:
    - Perform the RAG retrieval step first (this is needed regardless).
    - Call the LLM Availability Check (Task 1.1).
    - If LLM is available AND RAG-only mode is not explicitly requested/enabled: Proceed with constructing the full prompt and sending it to the LLMService as before.
    - If LLM is not available OR RAG-only mode is explicitly enabled: Skip sending to the LLM. Instead, package the raw retrieved RAG results to be sent back to the chat Webview UI.

### 3. Update Chat Webview UI
- **Task 3.1: Handle New Result Type**
  - Modify the JavaScript code in the Webview to recognize a new type of message or data structure received from the extension host – one that contains a list of raw RAG results instead of a formatted LLM response string.

- **Task 3.2: Render RAG Results**
  - Implement a specific rendering logic for this new data type. Display:
    - A clear header like "No LLM available. Showing relevant codebase context:"
    - For each retrieved chunk:
      - The file path and line numbers (e.g., path/to/file.ts (Lines 45-60)).
      - Optionally, the relevance score.
      - The code snippet itself, formatted nicely (e.g., in a code block with syntax highlighting).
    - Add a button or make the location clickable to open the file in the editor at the specific line range.

- **Task 3.3: User Feedback**
  - Display messages if RAG is attempted but no relevant chunks are found.

### 4. Indexing Service Check
- **Task 4.1: Check Index Status**
  - Before performing a RAG search in RAG-only mode, quickly check if the vector index actually exists and is not empty.
  - If it's not ready, inform the user that indexing is required.

### 5. User Experience Refinements
- **Task 5.1: Add RAG-Only Configuration**
  - Add a setting (praxcode.features.ragOnlyChat or similar) to allow users to explicitly force this mode even when an LLM is technically available (e.g., for privacy or cost reasons).

- **Task 5.2: Clear Messaging**
  - Ensure all messages related to LLM availability and RAG-only mode are very clear to the user in the chat interface and status bar.

## Benefits of this approach
- **Partial Functionality**: PraxCode remains somewhat useful even without a connected LLM.
- **Index Validation**: It gives users a way to "test" if their codebase index is working and retrieving relevant results.
- **Code Exploration**: It becomes a powerful tool for quickly finding code related to concepts or keywords across the entire project, even files they haven't opened.
- **Privacy/Offline Use**: Ideal for users who want to keep everything local or work offline but still benefit from the codebase index.
