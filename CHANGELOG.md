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

## [0.1.1] - 2025-05-01

### Added
- RAG-only mode for better results when LLM is unavailable
- Configurable minimum relevance score for RAG results
- Improved formatting of RAG-only results with better organization
- Detailed error messages when no relevant code is found
- Sorting of RAG results by relevance score

### Fixed
- Fixed issue with indexing not working properly on Windows
- Fixed issue with code explanation not working properly on large codebases
- Fixed issue with RAG results not being properly formatted in the chat UI

## [0.1.2] - 2025-05-01

### Added
- Added support for caching embeddings
- Added support for caching LLM responses
- Added support for caching RAG results
- Added support for caching chat history
- Added support for caching code explanations
- Added support for caching generated documentation
- Added support for caching generated tests

## [0.1.3] - 2025-05-13

### Added
- Added support for caching generated commit messages
- Added support for caching generated refactoring suggestions
- Added support for caching generated inline code completions
