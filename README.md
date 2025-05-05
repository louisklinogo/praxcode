# PraxCode - AI Code Assistant for VS Code

<p align="center">
  <pre>
  _____                 _____          _
 |  __ \               / ____|        | |
 | |__) | __ __ ___  _| |     ___   __| | ___
 |  ___/ '__/ _` \ \/ / |    / _ \ / _` |/ _ \
 | |   | | | (_| |>  <| |___| (_) | (_| |  __/
 |_|   |_|  \__,_/_/\_\\_____\___/ \__,_|\___|
  </pre>
</p>

<p align="center">
  <b>Your intelligent coding companion with deep codebase understanding</b>
</p>

PraxCode is a powerful, context-aware AI code assistant for Visual Studio Code that brings the capabilities of premium AI coding tools directly into your editor. Unlike other AI coding extensions, PraxCode gives you the freedom to choose between local and cloud LLM providers while maintaining privacy through local vector indexing of your codebase.

## ✨ Key Features

### 🧠 Deep Codebase Understanding
PraxCode indexes your entire codebase to provide truly context-aware assistance. The built-in Retrieval-Augmented Generation (RAG) system ensures that AI responses are grounded in your specific code, not just generic knowledge.

<p align="center">
  <i>[Screenshot: PraxCode analyzing a codebase and providing context-aware responses]</i>
</p>

### 💬 Intelligent Chat Interface
The sidebar chat interface provides a seamless way to interact with your AI assistant. Ask questions about your code, request explanations, or get suggestions for improvements - all with the context of your entire codebase.

<p align="center">
  <i>[Screenshot: PraxCode's chat interface showing a conversation about code]</i>
</p>

### 🔍 Code Explanation
Select any code snippet and get a detailed explanation with the "Explain Code" command. PraxCode analyzes the selected code in the context of your entire codebase to provide comprehensive explanations.

<p align="center">
  <i>[Screenshot: PraxCode explaining a complex code snippet with context from the codebase]</i>
</p>

### 🌐 Multi-Provider Support
Choose the AI model that works best for you:
- **Local Models** via [Ollama](https://ollama.ai/) (Llama, CodeLlama, Mistral, etc.)
- **Cloud Providers** including OpenAI (GPT-3.5, GPT-4)
- **Coming Soon**: Anthropic (Claude), Google (Gemini), and more

### 🔒 Privacy-Focused
When using local models, your code never leaves your machine. The vector store is maintained locally, ensuring your intellectual property remains secure.

## 📋 Requirements

- Visual Studio Code 1.99.0 or higher
- For local models: [Ollama](https://ollama.ai/) installed and running
- For cloud models: API keys for the respective services

## 🚀 Installation

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=praxcode.praxcode)
2. Configure your preferred LLM provider in the settings
3. Index your workspace using the "PraxCode: Index Workspace" command

## 🛠️ Setup Guide

### Setting Up Local Models with Ollama

1. **Install Ollama**:
   - Download and install from [ollama.ai](https://ollama.ai/)
   - Follow the installation instructions for your operating system

2. **Pull a Model**:
   ```bash
   # For general coding assistance
   ollama pull llama3

   # For specialized code understanding
   ollama pull codellama
   ```

3. **Start the Ollama Server**:
   - Ollama typically runs as a background service
   - Verify it's running by visiting http://localhost:11434/ in your browser

4. **Configure PraxCode**:
   - Open VS Code settings
   - Set `praxcode.llmProvider` to `ollama`
   - Set `praxcode.ollamaUrl` to `http://localhost:11434` (or your custom URL)
   - Set `praxcode.ollamaModel` to your preferred model (e.g., `llama3` or `codellama`)

### Setting Up Cloud Providers

1. **OpenAI Setup**:
   - Create an account at [OpenAI](https://platform.openai.com/)
   - Generate an API key in your account dashboard
   - In VS Code settings:
     - Set `praxcode.llmProvider` to `openai`
     - When prompted, enter your API key (it will be stored securely)

2. **Other Providers** (Coming Soon):
   - Similar setup process with provider-specific API keys
   - Configuration through the same settings interface

### Indexing Your Workspace

1. Open the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Run the command "PraxCode: Index Workspace"
3. A progress notification will appear showing the indexing status
4. Once complete, PraxCode will have a deep understanding of your codebase

<p align="center">
  <i>[Screenshot: PraxCode indexing a workspace with progress indicator]</i>
</p>

## 💻 Usage Examples

### Asking Questions About Your Code

1. Open the PraxCode sidebar by clicking the PraxCode icon in the activity bar
2. Type your question in the chat input, for example:
   - "How does the authentication system work in this project?"
   - "Explain the data flow in the application"
   - "What are the main components of this codebase?"

### Getting Code Explanations

1. Select a code snippet in your editor
2. Right-click and select "PraxCode: Explain Selected Code" or use the command palette
3. A detailed explanation will appear, analyzing the code in context

### Customizing Indexing

By default, PraxCode indexes most code files while excluding common directories like `node_modules`. You can customize this behavior:

1. Open VS Code settings
2. Modify `praxcode.indexing.includePatterns` to add specific file types
3. Modify `praxcode.indexing.excludePatterns` to exclude certain directories or files

## ⚙️ Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| `praxcode.llmProvider` | The LLM provider to use | `ollama` |
| `praxcode.ollamaUrl` | URL of the Ollama API server | `http://localhost:11434` |
| `praxcode.ollamaModel` | Model to use with Ollama | `llama3` |
| `praxcode.vectorStore.enabled` | Enable/disable vector store for indexing | `true` |
| `praxcode.vectorStore.embeddingModel` | Embedding model for vector embeddings | `nomic-embed-text` |
| `praxcode.indexing.includePatterns` | Glob patterns for files to include | `["**/*.{js,ts,jsx,tsx,py,java,c,cpp,cs,go,rb,php,html,css,md}"]` |
| `praxcode.indexing.excludePatterns` | Glob patterns for files to exclude | `["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"]` |
| `praxcode.ui.showStatusBarItem` | Show/hide the status bar item | `true` |
| `praxcode.logging.logLevel` | Log level (debug, info, warn, error) | `info` |

## 📚 Supported Models

### Ollama Models
- Llama 3 (recommended)
- CodeLlama
- Mistral
- Phi-2
- Gemma
- And any other models supported by Ollama

### OpenAI Models
- GPT-3.5 Turbo
- GPT-4
- GPT-4 Turbo

### Coming Soon
- Anthropic Claude models
- Google Gemini models
- Custom model support

## 🔧 Commands

| Command | Description |
|---------|-------------|
| `praxcode.indexWorkspace` | Index the current workspace for context-aware responses |
| `praxcode.explainCode` | Explain the currently selected code |
| `praxcode.showMenu` | Show the PraxCode menu with common actions |

## 🔒 Privacy & Security

- **Local Processing**: When using Ollama, all code processing happens locally on your machine
- **Secure Storage**: API keys for cloud providers are stored securely using VS Code's Secret Storage
- **Selective Indexing**: You have full control over which files are indexed through include/exclude patterns
- **No Telemetry**: PraxCode does not collect usage data or send your code to external servers

## 📝 Release Notes

See the [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

### Latest Release: v0.1.0

Initial release of PraxCode with the following features:
- Multi-provider LLM integration (Ollama, OpenAI)
- Contextual chat with RAG
- Code explanation
- Workspace indexing

## 📄 License

This extension is licensed under the [MIT License](LICENSE).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an Issue on our [GitHub repository](https://github.com/praxcode/praxcode).

---

<p align="center">
  <b>Elevate your coding experience with PraxCode - where AI meets deep code understanding.</b>
</p>

> **Note:** Screenshots in this README will be updated with actual images in the next release.

**Enjoy coding with PraxCode!**
