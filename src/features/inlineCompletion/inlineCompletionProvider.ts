import * as vscode from 'vscode';
import { LLMServiceFactory } from '../../services/llm/llmServiceFactory';
import { ConfigurationManager } from '../../utils/configurationManager';
import { logger } from '../../utils/logger';

/**
 * Provider for inline code completions
 */
export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private llmServiceFactory: LLMServiceFactory;
    private configManager: ConfigurationManager;
    
    /**
     * Constructor
     * @param llmServiceFactory The LLM service factory
     * @param configManager The configuration manager
     */
    constructor(llmServiceFactory: LLMServiceFactory, configManager: ConfigurationManager) {
        this.llmServiceFactory = llmServiceFactory;
        this.configManager = configManager;
    }
    
    /**
     * Provide inline completions
     * @param document The document
     * @param position The position
     * @param context The context
     * @param token The cancellation token
     */
    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
        // Check if inline completion is enabled
        const config = this.configManager.getConfiguration();
        if (!config.enableInlineCompletion) {
            return null;
        }
        
        try {
            // Get context around the cursor
            const contextBefore = this.getContextBefore(document, position);
            const contextAfter = this.getContextAfter(document, position);
            
            // Get the current line
            const currentLine = document.lineAt(position.line).text;
            
            // If the line is empty or just whitespace, don't provide completions
            if (currentLine.trim() === '') {
                return null;
            }
            
            // Get the indentation of the current line
            const indentation = currentLine.match(/^\s*/)?.[0] || '';
            
            // Get the LLM service
            const llmService = await this.llmServiceFactory.getService();
            
            // Create the prompt
            const prompt = `Complete the following code. Only provide the completion, not the existing code:

${contextBefore}█${contextAfter}

The █ symbol represents the cursor position. Complete the code at the cursor position.`;
            
            // Get the completion
            const response = await llmService.chat(
                [
                    {
                        role: 'system',
                        content: 'You are a code completion assistant. Your task is to complete the code at the cursor position. Only provide the completion, not the existing code. Keep your completions concise and relevant to the context.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                {
                    temperature: 0.2,
                    maxTokens: 100
                }
            );
            
            // Process the completion
            let completion = response.content.trim();
            
            // Remove any code block markers
            completion = completion.replace(/^```[a-z]*\n/, '').replace(/```$/, '');
            
            // If the completion is empty, don't provide anything
            if (!completion) {
                return null;
            }
            
            // Create the inline completion item
            const item = new vscode.InlineCompletionItem(
                completion,
                new vscode.Range(position, position)
            );
            
            return [item];
        } catch (error) {
            logger.error('Error providing inline completion', error);
            return null;
        }
    }
    
    /**
     * Get the context before the cursor
     * @param document The document
     * @param position The position
     */
    private getContextBefore(document: vscode.TextDocument, position: vscode.Position): string {
        // Get up to 20 lines before the cursor
        const startLine = Math.max(0, position.line - 20);
        const endLine = position.line;
        
        let context = '';
        
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i).text;
            
            if (i === endLine) {
                // For the current line, only include text up to the cursor
                context += line.substring(0, position.character);
            } else {
                context += line + '\n';
            }
        }
        
        return context;
    }
    
    /**
     * Get the context after the cursor
     * @param document The document
     * @param position The position
     */
    private getContextAfter(document: vscode.TextDocument, position: vscode.Position): string {
        // Get up to 10 lines after the cursor
        const startLine = position.line;
        const endLine = Math.min(document.lineCount - 1, position.line + 10);
        
        let context = '';
        
        for (let i = startLine; i <= endLine; i++) {
            const line = document.lineAt(i).text;
            
            if (i === startLine) {
                // For the current line, only include text after the cursor
                context += line.substring(position.character);
            } else {
                context += line + '\n';
            }
        }
        
        return context;
    }
}
