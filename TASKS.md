# PraxCode - Development Tasks

## Milestone 1: MVP (Core Functionality)

- [x] Basic Extension Setup & Configuration (Ollama + OpenAI)
- [x] LLM Service + Ollama/OpenAI Providers
- [x] Basic Sidebar Chat (no RAG)
- [x] Vector Store Service (LanceDB) + Manual Indexing (simple chunking)
- [x] Basic RAG Integration in Chat
- [x] "Explain Code" command (using RAG)

## Milestone 2: Feature Expansion

- [x] Add more LLM Providers (Anthropic, Google, OpenRouter)
- [x] Basic Inline Code Completion
- [x] Improved Indexing (auto-index on save)
- [x] "Generate Docs" & "Generate Tests" commands
- [x] Status Bar Indicator
- [x] Secure Secret Storage for API keys

## Milestone 3: Polish & Advanced Features

- [x] Refactoring / Inline Edits with Diff View
- [x] Commit Message Generation
- [x] UI/UX Refinements (streaming, code rendering)
- [x] Performance Optimizations (indexing, RAG)
- [x] Advanced Configuration (include/exclude)
- [x] Agent Mode Implementation

## Milestone 4: Agent Mode Debugging & Improvement

### Phase 1: Fixing the Non-Functionality ("Apply" / "Run" Buttons)

#### Task 1.1: Verify Webview → Extension Communication
- [x] Add console.log statements in webview JavaScript for click events
- [x] Log data associated with suggestions (code blocks, commands)
- [x] Log message objects sent via vscode.postMessage()
- [x] Test by clicking buttons and checking VS Code Developer Tools console

#### Task 1.2: Verify Extension ← Webview Communication
- [x] Add logging in message handler (onDidReceiveMessage)
- [x] Log entire message objects received from webview
- [x] Check Extension Host logs or Debug Console for message receipt
- [x] Verify message content matches what webview sent

#### Task 1.3: Verify Data Routing & Action Service Call
- [x] Add logging for message type identification
- [x] Log data extraction from message payload
- [x] Log service function calls with extracted data
- [x] Verify correct routing based on message type

#### Task 1.4: Debug ActionExecutionService - Apply Code Changes
- [x] Log code change data and target file URI
- [x] Log generated WorkspaceEdit objects
- [x] Log confirmation dialog display and user response
- [x] Add try-catch around vscode.workspace.applyEdit
- [x] Log success/failure of edit application
- [x] Improve error handling and user feedback

```typescript
try {
    console.log('PraxCode: Attempting to apply edit:', edit);
    const success = await vscode.workspace.applyEdit(edit);
    console.log(`PraxCode: Apply edit success: ${success}`);
    if (!success) {
        vscode.window.showErrorMessage('PraxCode: Failed to apply code changes.');
    }
} catch (error) {
    console.error('PraxCode: Error applying workspace edit:', error);
    vscode.window.showErrorMessage(`PraxCode: Error applying changes: ${error.message}`);
}
```

#### Task 1.5: Debug ActionExecutionService - Run Terminal Command
- [x] Log command string received
- [x] Log confirmation dialog display and user response
- [x] Log terminal creation/retrieval
- [x] Log command execution
- [x] Add try-catch around terminal operations
- [x] Improve error handling and user feedback

```typescript
try {
    console.log(`PraxCode: Attempting to run command: "${command}"`);
    // ... get/create terminal logic ...
    if (terminal) {
        terminal.show(); // Make sure it's visible
        terminal.sendText(command, true); // Send command + newline
        console.log(`PraxCode: Command sent to terminal.`);
        // Optional: vscode.window.showInformationMessage(`Sent command to terminal: ${command}`);
    } else {
        console.error('PraxCode: Failed to get or create terminal.');
        vscode.window.showErrorMessage('PraxCode: Could not access terminal.');
    }
} catch (error) {
    console.error('PraxCode: Error running command:', error);
    vscode.window.showErrorMessage(`PraxCode: Error running command: ${error.message}`);
}
```

### Phase 2: Improving Suggestion Accuracy (LLM/Prompt/RAG)

#### Task 2.1: Log the Entire LLM Interaction
- [ ] Log final prompts sent to LLM (system message, RAG context, history, user query)
- [ ] Log RAG context chunks retrieved and included
- [ ] Log raw LLM responses before parsing
- [ ] Analyze logs to identify issues

#### Task 2.2: Analyze Prompts for Code Changes
- [ ] Review logged prompts for clarity and specificity
- [ ] Check if original code is clearly provided
- [ ] Verify instructions for desired changes
- [ ] Specify output format (e.g., diff format)
- [ ] Refine prompt templates based on findings

Example improved prompt:
```
System: You are an AI coding assistant. Given the original code and an instruction, provide the necessary changes in a standard unified diff format. Only output the diff.

User: Refactor the following code for clarity:
```original-code
[Selected Code Here]
```
```

#### Task 2.3: Analyze Prompts for Terminal Commands
- [ ] Review logged prompts for command generation
- [ ] Check if prompts explicitly request shell/terminal commands
- [ ] Verify RAG context relevance for command generation
- [ ] Consider direct LLM queries for command generation
- [ ] Refine prompt templates based on findings

Example improved prompt:
```
System: You are an AI assistant. Provide the necessary shell command(s) to accomplish the user's request. Only output the command(s), each on a new line. Do not include explanations unless specifically asked.

User: How do I install the 'axios' npm package?
```

#### Task 2.4: Review RAG Context Relevance
- [ ] Analyze logged RAG context for relevance to tasks
- [ ] Adjust vector store queries for better specificity
- [ ] Implement file type filtering for different tasks
- [ ] Consider conditional RAG usage based on task type
- [ ] Review chunking strategy and embedding model

#### Task 2.5: Refine LLM Response Parsing
- [x] Compare raw LLM responses to parsed/displayed content
- [x] Improve code block extraction
- [x] Add support for parsing diff format
- [x] Enhance command extraction
- [x] Make parsing more robust to LLM output variations

## Implementation Progress Summary

### Completed Tasks
- [x] Added comprehensive logging throughout the codebase
- [x] Improved error handling in all critical components
- [x] Enhanced validation of inputs and data
- [x] Improved command detection and filtering
- [x] Added detailed feedback for success/failure scenarios
- [x] Implemented robust parsing for commands and code changes

### Next Steps
- [ ] Complete the remaining tasks in Phase 2 (Tasks 2.1-2.4)
- [ ] Conduct thorough testing of the Agent Mode functionality
- [ ] Gather user feedback and make further improvements
- [ ] Consider adding more advanced agentic capabilities

## Milestone Y: Model Context Protocol Integration

### Learning & Design (P1)
- [ ] Read and understand the latest Model Context Protocol specification (modelcontextprotocol.io/specification or similar)
- [ ] Design the structure of the ModelContextProtocolService
- [ ] Identify key ContextItem types PraxCode can generate (code, file, diff, diagnostic, terminal output, etc.)
- [ ] Design how the LLMService will determine if a provider supports MCP and how it will switch between MCP and plain text requests/responses

### Implementing Context Generation (P1)
- [ ] Create ModelContextProtocolService class
- [ ] Implement functions to generate ContextItem objects from:
  - [ ] Current open file (vscode.TextDocument)
  - [ ] Selected code (vscode.Range)
  - [ ] RAG results (convert text chunks to ContextItems of type 'code' or 'text')
  - [ ] VS Code Diagnostics (vscode.Diagnostic)
  - [ ] Terminal output (if captured - see previous tasks)
  - [ ] Git status (using VS Code SCM API)
  - [ ] Other relevant workspace info (filepaths, configuration snippets)

### Adapting LLM Service (P1)
- [ ] Modify the LLMService interface and/or implementations to potentially accept a list of ContextItems in addition to or instead of a single text prompt
- [ ] Add logic in relevant provider implementations (Ollama, OpenAI, etc.) to check for MCP support (initially, this might be a configuration flag or limited to a specific endpoint)
- [ ] If MCP is supported, format the request payload according to the MCP spec JSON structure, including the generated ContextItems
- [ ] If MCP is not supported, fall back to constructing a detailed text prompt using the information from the ContextItems

### Handling MCP Responses (P1)
- [ ] Based on the MCP spec, identify how structured actions (like code changes, commands) are represented in the response JSON
- [ ] Implement parsing logic in the LLMService or a dedicated response handler to extract:
  - [ ] The main text response
  - [ ] Any structured action suggestions (e.g., a ContextItem of type diff, or a specific action payload defined by MCP or an extension)
- [ ] Modify the RAGOrchestrator or main chat logic to process both text output and potential structured actions from the parsed MCP response

### Integrating with Action Execution (P1)
- [ ] Update the ActionExecutionService to accept action requests in the structured format defined by the MCP
- [ ] Map the MCP-defined action structure (e.g., diff content, command string) to the internal formats used for WorkspaceEdit and terminal sendText
- [ ] Ensure the user confirmation flow is still triggered by actions parsed from the MCP response

### Finding/Testing with MCP Endpoint (P0 - Critical Dependency)
- [ ] Identify or set up an LLM server endpoint that explicitly supports the Model Context Protocol. (This is likely the biggest hurdle). Options:
  - [ ] Check if any major model providers (Anthropic, Google, OpenAI) or routers (OpenRouter) have added or plan to add MCP support
  - [ ] Investigate if Ollama can be run with an MCP-compatible proxy layer
  - [ ] Potentially set up a simple local server implementing the MCP spec to test against
- [ ] Configure PraxCode settings to point to this MCP endpoint
- [ ] Test the end-to-end flow: context -> MCP request -> MCP response -> parsing -> action execution

### UI Integration (P2)
- [ ] Adapt the chat UI or other UI components to visually represent suggested actions parsed from the MCP response, similar to how you display "Suggested Code Changes" and "Terminal Command" now, but driven by the structured MCP data

### Testing & Refinement (P2)
- [ ] Add unit tests for ModelContextProtocolService (ContextItem generation)
- [ ] Add unit tests for MCP request formatting and response parsing (mocking responses)
- [ ] Add integration tests simulating communication with an MCP endpoint (mocking the endpoint if necessary)

## Future Milestones

- [ ] Symbol indexing
- [ ] Advanced agentic features
- [ ] Further optimizations
- [ ] Tree-sitter integration for better code understanding
