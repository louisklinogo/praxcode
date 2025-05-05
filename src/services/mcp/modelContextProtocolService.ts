import * as vscode from 'vscode';
import { logger } from '../../utils/logger';
import { SearchResult } from '../vectorstore/vectorStoreService';

/**
 * Interface for MCP ContextItem
 * Based on the Model Context Protocol specification
 */
export interface MCPContextItem {
    type: string;
    content: string;
    metadata?: {
        [key: string]: any;
    };
}

/**
 * Interface for MCP Request
 */
export interface MCPRequest {
    messages: {
        role: 'system' | 'user' | 'assistant';
        content: string;
        context_items?: MCPContextItem[];
    }[];
    model?: string;
    temperature?: number;
    max_tokens?: number;
    stop?: string[];
    stream?: boolean;
}

/**
 * Interface for MCP Response
 */
export interface MCPResponse {
    message: {
        role: 'assistant';
        content: string;
        context_items?: MCPContextItem[];
    };
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * Service for handling Model Context Protocol (MCP) operations
 * Generates ContextItems from various sources in the VS Code environment
 */
export class ModelContextProtocolService {
    private static instance: ModelContextProtocolService;

    private constructor() {
        logger.info('ModelContextProtocolService initialized');
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        logger.debug('ModelContextProtocolService disposed');
    }

    /**
     * Get the singleton instance of the service
     */
    public static getInstance(): ModelContextProtocolService {
        if (!ModelContextProtocolService.instance) {
            ModelContextProtocolService.instance = new ModelContextProtocolService();
        }
        return ModelContextProtocolService.instance;
    }

    /**
     * Create a context item from a text document
     * @param document The VS Code text document
     * @returns An MCP context item
     */
    public createContextItemFromDocument(document: vscode.TextDocument): MCPContextItem {
        const language = document.languageId;
        const filePath = document.uri.fsPath;
        const content = document.getText();

        return {
            type: 'file',
            content: content,
            metadata: {
                filePath: filePath,
                language: language,
                lineCount: document.lineCount
            }
        };
    }

    /**
     * Create a context item from selected text
     * @param document The VS Code text document
     * @param selection The selection range
     * @returns An MCP context item
     */
    public createContextItemFromSelection(document: vscode.TextDocument, selection: vscode.Range): MCPContextItem {
        const language = document.languageId;
        const filePath = document.uri.fsPath;
        const content = document.getText(selection);
        const startLine = selection.start.line + 1; // 1-based line numbers
        const endLine = selection.end.line + 1;

        return {
            type: 'code',
            content: content,
            metadata: {
                filePath: filePath,
                language: language,
                startLine: startLine,
                endLine: endLine
            }
        };
    }

    /**
     * Create context items from RAG search results
     * @param searchResults The search results from the vector store
     * @returns An array of MCP context items
     */
    public createContextItemsFromRAGResults(searchResults: SearchResult[]): MCPContextItem[] {
        return searchResults.map(result => {
            const doc = result.document;
            const filePath = doc.metadata.filePath;
            const language = doc.metadata.language || 'text';
            const startLine = doc.metadata.startLine;
            const endLine = doc.metadata.endLine;
            const score = result.score;

            return {
                type: 'code',
                content: doc.text,
                metadata: {
                    filePath: filePath,
                    language: language,
                    startLine: startLine,
                    endLine: endLine,
                    relevanceScore: score
                }
            };
        });
    }

    /**
     * Create a context item from VS Code diagnostics
     * @param diagnostics The VS Code diagnostics
     * @param document The document the diagnostics are for
     * @returns An MCP context item
     */
    public createContextItemFromDiagnostics(diagnostics: vscode.Diagnostic[], document: vscode.TextDocument): MCPContextItem {
        const filePath = document.uri.fsPath;

        // Format diagnostics into a readable string
        const formattedDiagnostics = diagnostics.map(diag => {
            const severity = this.getDiagnosticSeverityString(diag.severity);
            const startLine = diag.range.start.line + 1; // 1-based line numbers
            const message = diag.message;
            return `${severity} at line ${startLine}: ${message}`;
        }).join('\n');

        return {
            type: 'diagnostic',
            content: formattedDiagnostics,
            metadata: {
                filePath: filePath,
                count: diagnostics.length
            }
        };
    }

    /**
     * Create a context item from terminal output
     * @param terminalOutput The terminal output text
     * @param terminalName The name of the terminal
     * @returns An MCP context item
     */
    public createContextItemFromTerminalOutput(terminalOutput: string, terminalName: string): MCPContextItem {
        return {
            type: 'terminal',
            content: terminalOutput,
            metadata: {
                terminalName: terminalName,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Create a context item from Git status
     * @param gitStatus The Git status text
     * @returns An MCP context item
     */
    public createContextItemFromGitStatus(gitStatus: string): MCPContextItem {
        return {
            type: 'git',
            content: gitStatus,
            metadata: {
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Create a context item from a diff
     * @param diff The diff text
     * @param filePath The file path the diff applies to
     * @returns An MCP context item
     */
    public createContextItemFromDiff(diff: string, filePath: string): MCPContextItem {
        return {
            type: 'diff',
            content: diff,
            metadata: {
                filePath: filePath,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Convert a VS Code diagnostic severity to a string
     * @param severity The diagnostic severity
     * @returns A string representation of the severity
     */
    private getDiagnosticSeverityString(severity: vscode.DiagnosticSeverity): string {
        switch (severity) {
            case vscode.DiagnosticSeverity.Error:
                return 'Error';
            case vscode.DiagnosticSeverity.Warning:
                return 'Warning';
            case vscode.DiagnosticSeverity.Information:
                return 'Information';
            case vscode.DiagnosticSeverity.Hint:
                return 'Hint';
            default:
                return 'Unknown';
        }
    }
}
