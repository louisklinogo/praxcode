# Changelog

All notable changes to the PraxCode extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-05-01

### Added
- Initial release of PraxCode with the following features:
- Multi-provider LLM integration (Ollama, OpenAI)
- Contextual chat with RAG (Retrieval-Augmented Generation)
- Code explanation functionality
- Workspace indexing for context-aware responses
- Support for local models via Ollama
- Support for cloud models via OpenAI
- Configurable indexing patterns
- Secure API key storage
- Detailed logging system

### Fixed
- Improved vector store implementation with file-based storage
- Enhanced embedding service with fallback mechanisms
- Fixed RAG system to properly retrieve and use indexed content
- Improved error handling throughout the system