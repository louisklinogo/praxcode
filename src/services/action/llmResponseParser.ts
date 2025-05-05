import * as vscode from 'vscode';
import { logger } from '../../utils/logger';

/**
 * Interface for a parsed code change
 */
export interface ParsedCodeChange {
    originalCode?: string;
    newCode: string;
    language: string;
    description?: string;
    filePath?: string;
}

/**
 * Interface for a parsed command
 */
export interface ParsedCommand {
    command: string;
    description?: string;
}

/**
 * Service for parsing LLM responses
 */
export class LLMResponseParser {
    /**
     * Parse code changes from LLM response
     * @param content The LLM response content
     * @returns An array of parsed code changes
     */
    public static parseCodeChanges(content: string): ParsedCodeChange[] {
        const codeChanges: ParsedCodeChange[] = [];

        if (!content) {
            logger.warn('Cannot parse code changes: content is empty');
            return codeChanges;
        }

        try {
            logger.debug('Parsing code changes from content', { contentLength: content.length });

            // Extract code blocks
            const codeBlockRegex = /```([\w-]*)\n([\s\S]*?)```/g;
            let match;
            let codeBlockCount = 0;

            while ((match = codeBlockRegex.exec(content)) !== null) {
                codeBlockCount++;
                const language = match[1].trim().toLowerCase();
                const code = match[2].trim();

                // Skip empty code blocks
                if (!code) {
                    logger.debug('Skipping empty code block');
                    continue;
                }

                // Skip non-code languages
                const nonCodeLanguages = ['output', 'log', 'text', 'console', 'terminal', 'bash', 'shell', 'sh', 'cmd', 'powershell'];
                if (nonCodeLanguages.includes(language)) {
                    logger.debug('Skipping non-code language block', { language });
                    continue;
                }

                // Skip if the code doesn't look like actual code
                if (!this.isLikelyCode(code, language)) {
                    logger.debug('Skipping content that doesn\'t look like code', { language });
                    continue;
                }

                // Look for file path hints before the code block
                // Search in a larger context window before the code block
                const contextBefore = content.substring(Math.max(0, match.index - 300), match.index);

                // Try multiple file path detection patterns
                let filePath: string | undefined;

                // Helper function to validate file paths
                const isValidFilePath = (path: string): boolean => {
                    // Check if the path is too long (likely a sentence, not a path)
                    if (path.length > 100) {
                        return false;
                    }

                    // Check if the path contains spaces without quotes
                    if (path.includes(' ') && !path.startsWith('"') && !path.startsWith("'")) {
                        // Allow spaces in Windows paths like "C:\Program Files\file.txt"
                        if (!path.match(/^[A-Za-z]:\\/) && !path.match(/^\/[A-Za-z]/)) {
                            return false;
                        }
                    }

                    // Check if the path has a valid file extension
                    const validExtensions = /\.(js|jsx|ts|tsx|py|java|c|cpp|cs|go|rb|php|html|css|json|md|txt|xml|yaml|yml|config|ini|sh|bat|ps1)$/i;
                    if (!validExtensions.test(path)) {
                        return false;
                    }

                    // Check for invalid characters that shouldn't be in file paths
                    const invalidChars = /[<>:"|?*]/;
                    if (invalidChars.test(path) && !path.match(/^[A-Za-z]:\\/)) { // Allow : in Windows drive letters
                        return false;
                    }

                    return true;
                };

                // Pattern 1: "In file.js, we need to..."
                const inFileRegex = /(?:in|inside|within|for|to)\s+(?:the\s+)?(?:file\s+)?[`"']?([^`"'\n,;]+\.\w+)[`"']?/i;
                const inFileMatch = contextBefore.match(inFileRegex);
                if (inFileMatch && inFileMatch[1]) {
                    const candidate = inFileMatch[1].trim();
                    if (isValidFilePath(candidate)) {
                        filePath = candidate;
                    }
                }

                // Pattern 2: "Create/modify/update/edit file.js"
                if (!filePath) {
                    const actionFileRegex = /(?:create|modify|update|edit|change)(?:\s+the)?\s+(?:file\s+)?[`"']?([^`"'\n,;]+\.\w+)[`"']?/i;
                    const actionFileMatch = contextBefore.match(actionFileRegex);
                    if (actionFileMatch && actionFileMatch[1]) {
                        const candidate = actionFileMatch[1].trim();
                        if (isValidFilePath(candidate)) {
                            filePath = candidate;
                        }
                    }
                }

                // Pattern 3: "file.js needs to be updated"
                if (!filePath) {
                    const fileNeedsRegex = /[`"']?([^`"'\n,;]+\.\w+)[`"']?\s+(?:needs|should|must|will|can)\s+(?:to\s+)?(?:be\s+)?(?:updated|modified|changed|edited)/i;
                    const fileNeedsMatch = contextBefore.match(fileNeedsRegex);
                    if (fileNeedsMatch && fileNeedsMatch[1]) {
                        const candidate = fileNeedsMatch[1].trim();
                        if (isValidFilePath(candidate)) {
                            filePath = candidate;
                        }
                    }
                }

                // Pattern 4: "Here's the updated file.js"
                if (!filePath) {
                    const updatedFileRegex = /(?:here's|here\s+is|this\s+is)\s+(?:the\s+)?(?:updated|modified|new|changed)?\s+(?:version\s+of\s+)?[`"']?([^`"'\n,;]+\.\w+)[`"']?/i;
                    const updatedFileMatch = contextBefore.match(updatedFileRegex);
                    if (updatedFileMatch && updatedFileMatch[1]) {
                        const candidate = updatedFileMatch[1].trim();
                        if (isValidFilePath(candidate)) {
                            filePath = candidate;
                        }
                    }
                }

                // Pattern 5: Look for file path at the beginning of the paragraph
                if (!filePath) {
                    const paragraphs = contextBefore.split('\n\n');
                    const lastParagraph = paragraphs[paragraphs.length - 1] || '';
                    const filePathAtStartRegex = /^[`"']?([^`"'\n,;]+\.\w+)[`"']?[:\s]/m;
                    const filePathAtStartMatch = lastParagraph.match(filePathAtStartRegex);
                    if (filePathAtStartMatch && filePathAtStartMatch[1]) {
                        const candidate = filePathAtStartMatch[1].trim();
                        if (isValidFilePath(candidate)) {
                            filePath = candidate;
                        }
                    }
                }

                // Pattern 6: Look for "Code for X" pattern
                if (!filePath) {
                    const codeForRegex = /Code\s+for\s+([^`"'\n,;]+\.\w+)/i;
                    const codeForMatch = contextBefore.match(codeForRegex);
                    if (codeForMatch && codeForMatch[1]) {
                        const candidate = codeForMatch[1].trim();
                        if (isValidFilePath(candidate)) {
                            filePath = candidate;
                        }
                    }
                }

                // Pattern 7: Look for file extension in the language
                if (!filePath && language) {
                    // Map language to file extension
                    const extensionMap: Record<string, string> = {
                        'javascript': 'js',
                        'typescript': 'ts',
                        'python': 'py',
                        'java': 'java',
                        'csharp': 'cs',
                        'html': 'html',
                        'css': 'css',
                        'json': 'json',
                        'markdown': 'md'
                    };

                    const extension = extensionMap[language.toLowerCase()] || language.toLowerCase();

                    // Look for any mentions of files with this extension
                    const extensionRegex = new RegExp(`([\\w\\-./]+\\.${extension})`, 'i');
                    const extensionMatch = contextBefore.match(extensionRegex);
                    if (extensionMatch && extensionMatch[1]) {
                        const candidate = extensionMatch[1].trim();
                        if (isValidFilePath(candidate)) {
                            filePath = candidate;
                        }
                    }
                }

                logger.debug('File path detection result', { filePath });

                // Look for description of the change
                let description: string | undefined;

                // Pattern 1: "I will/Let's/Here's/I'm going to..."
                const intentRegex = /(?:I will|Let's|Here's|I'm going to)\s+([^.!?]+(?:[.!?][^.!?]+)*)[.!?]/i;
                const intentMatch = contextBefore.match(intentRegex);
                if (intentMatch && intentMatch[1]) {
                    description = intentMatch[1].trim();
                }

                // Pattern 2: "We need to..."
                if (!description) {
                    const needToRegex = /(?:We|You|I)\s+(?:need|want|should|must|can)\s+to\s+([^.!?]+)[.!?]/i;
                    const needToMatch = contextBefore.match(needToRegex);
                    if (needToMatch && needToMatch[1]) {
                        description = needToMatch[1].trim();
                    }
                }

                // Pattern 3: "This change will..."
                if (!description) {
                    const changeWillRegex = /(?:This|The)\s+(?:change|update|modification|code)\s+(?:will|should|can)\s+([^.!?]+)[.!?]/i;
                    const changeWillMatch = contextBefore.match(changeWillRegex);
                    if (changeWillMatch && changeWillMatch[1]) {
                        description = changeWillMatch[1].trim();
                    }
                }

                logger.debug('Description detection result', { description });

                // Add the code change
                logger.debug('Adding code change', {
                    language,
                    filePath,
                    codeLength: code.length,
                    description: description ? description.substring(0, 50) + '...' : undefined
                });

                codeChanges.push({
                    newCode: code,
                    language,
                    filePath,
                    description
                });
            }

            logger.debug('Code block parsing complete', {
                codeBlockCount,
                codeChangesFound: codeChanges.length
            });

            // Look for diff-style changes
            this.parseDiffChanges(content, codeChanges);

            logger.info('Parsed code changes', { count: codeChanges.length });
            return codeChanges;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error parsing code changes', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined
            });
            return codeChanges;
        }
    }

    /**
     * Check if content is likely actual code
     * @param code The code content to check
     * @param language The language of the code
     * @returns True if the content is likely code
     */
    private static isLikelyCode(code: string, language: string): boolean {
        // If it's very short, it's probably not code
        if (code.length < 10) {
            return false;
        }

        // Check for common code patterns based on language
        switch (language) {
            case 'javascript':
            case 'typescript':
            case 'js':
            case 'ts':
                // Look for JS/TS syntax
                return /function|const|let|var|import|export|class|interface|=>/i.test(code);

            case 'python':
            case 'py':
                // Look for Python syntax
                return /def|class|import|from|if|for|while|return/i.test(code);

            case 'java':
                // Look for Java syntax
                return /class|public|private|protected|void|int|String|boolean/i.test(code);

            case 'csharp':
            case 'cs':
                // Look for C# syntax
                return /class|namespace|using|public|private|void|string|int|bool/i.test(code);

            case 'html':
                // Look for HTML tags
                return /<\/?[a-z][\s\S]*>/i.test(code);

            case 'css':
                // Look for CSS syntax
                return /[.#]?[\w-]+\s*{[^}]*}/i.test(code);

            case 'json':
                // Look for JSON syntax
                return /^\s*[{[]/.test(code) && /[}\]]\s*$/.test(code);

            default:
                // For unknown languages, check for general code patterns
                const codePatterns = [
                    /[{}\[\]();]/,           // Common syntax characters
                    /\b(if|else|for|while|return|function|class)\b/i,  // Common keywords
                    /[a-zA-Z_]\w*\s*\(/,     // Function calls
                    /=\s*[^;]+;/,            // Assignments
                    /\b(const|let|var|int|string|bool|void)\b/i  // Type declarations
                ];

                return codePatterns.some(pattern => pattern.test(code));
        }
    }

    /**
     * Parse diff-style changes from LLM response
     * @param content The LLM response content
     * @param codeChanges The array of code changes to append to
     */
    private static parseDiffChanges(content: string, codeChanges: ParsedCodeChange[]): void {
        try {
            // Look for "Before" and "After" sections
            const beforeAfterRegex = /Before:?\s*```(?:[\w-]*)\n([\s\S]*?)```\s*After:?\s*```(?:[\w-]*)\n([\s\S]*?)```/gi;
            let baMatch;

            while ((baMatch = beforeAfterRegex.exec(content)) !== null) {
                const originalCode = baMatch[1].trim();
                const newCode = baMatch[2].trim();

                // Determine language from file extension or content
                const language = this.inferLanguageFromCode(originalCode);

                codeChanges.push({
                    originalCode,
                    newCode,
                    language
                });
            }

            // Look for unified diff format
            const diffRegex = /```diff\n([\s\S]*?)```/g;
            let diffMatch;

            while ((diffMatch = diffRegex.exec(content)) !== null) {
                const diffContent = diffMatch[1].trim();

                // Parse the diff to extract original and new code
                const { originalCode, newCode, language, filePath } = this.parseDiffContent(diffContent);

                if (originalCode || newCode) {
                    // Look for description before the diff block
                    const contextBefore = content.substring(Math.max(0, diffMatch.index - 300), diffMatch.index);
                    let description: string | undefined;

                    // Pattern 1: "This change will..."
                    const changeWillRegex = /(?:This|The)\s+(?:change|update|modification|diff)\s+(?:will|should|can)\s+([^.!?]+)[.!?]/i;
                    const changeWillMatch = contextBefore.match(changeWillRegex);
                    if (changeWillMatch && changeWillMatch[1]) {
                        description = changeWillMatch[1].trim();
                    }

                    // Pattern 2: "I'm making changes to..."
                    if (!description) {
                        const makingChangesRegex = /(?:I'm|I am)\s+(?:making|applying)\s+(?:changes|updates|modifications)\s+to\s+([^.!?]+)[.!?]/i;
                        const makingChangesMatch = contextBefore.match(makingChangesRegex);
                        if (makingChangesMatch && makingChangesMatch[1]) {
                            description = makingChangesMatch[1].trim();
                        }
                    }

                    codeChanges.push({
                        originalCode,
                        newCode: newCode || diffContent, // If we couldn't extract new code, use the whole diff
                        language,
                        filePath,
                        description
                    });
                }
            }

            // Also look for diffs without the diff language marker
            const gitDiffRegex = /```(?:patch|git)?\n(diff\s+--git\s+[\s\S]*?)```/g;
            let gitDiffMatch;

            while ((gitDiffMatch = gitDiffRegex.exec(content)) !== null) {
                const diffContent = gitDiffMatch[1].trim();

                // Only process if it looks like a git diff
                if (diffContent.startsWith('diff --git') ||
                    diffContent.includes('--- a/') ||
                    diffContent.includes('+++ b/')) {

                    // Parse the diff to extract original and new code
                    const { originalCode, newCode, language, filePath } = this.parseDiffContent(diffContent);

                    codeChanges.push({
                        originalCode: originalCode || diffContent, // Keep the original diff format
                        newCode: newCode || diffContent, // If we couldn't extract new code, use the whole diff
                        language,
                        filePath
                    });
                }
            }
        } catch (error) {
            logger.error('Error parsing diff changes', error);
        }
    }

    /**
     * Parse unified diff content
     * @param diffContent The diff content
     * @returns The original code, new code, language, and file path
     */
    private static parseDiffContent(diffContent: string): { originalCode: string, newCode: string, language: string, filePath?: string } {
        const lines = diffContent.split('\n');
        let originalCode = '';
        let newCode = '';
        let language = '';
        let filePath: string | undefined;

        // Helper function to validate file paths
        const isValidFilePath = (path: string): boolean => {
            // Check if the path is too long (likely a sentence, not a path)
            if (path.length > 100) {
                return false;
            }

            // Skip timestamp markers in diff
            if (path.includes('\t') || path === '/dev/null') {
                return false;
            }

            // Check if the path contains spaces without quotes
            if (path.includes(' ') && !path.startsWith('"') && !path.startsWith("'")) {
                // Allow spaces in Windows paths like "C:\Program Files\file.txt"
                if (!path.match(/^[A-Za-z]:\\/) && !path.match(/^\/[A-Za-z]/)) {
                    return false;
                }
            }

            // Check if the path has a valid file extension
            const validExtensions = /\.(js|jsx|ts|tsx|py|java|c|cpp|cs|go|rb|php|html|css|json|md|txt|xml|yaml|yml|config|ini|sh|bat|ps1)$/i;
            if (!validExtensions.test(path)) {
                return false;
            }

            // Check for invalid characters that shouldn't be in file paths
            const invalidChars = /[<>"|?*]/;
            if (invalidChars.test(path) && !path.match(/^[A-Za-z]:\\/)) { // Allow : in Windows drive letters
                return false;
            }

            return true;
        };

        // Try to extract file name and language
        const fileLineRegex = /^(?:---|\+\+\+)\s+(?:a\/|b\/)?(.+)$/;
        for (const line of lines) {
            const fileMatch = line.match(fileLineRegex);
            if (fileMatch) {
                const path = fileMatch[1];

                if (!isValidFilePath(path)) {
                    continue;
                }

                filePath = path;
                const extension = path.split('.').pop();
                if (extension) {
                    language = this.mapExtensionToLanguage(extension);
                    break;
                }
            }
        }

        // Also try to extract from git diff header
        if (!filePath) {
            const gitDiffRegex = /^diff\s+--git\s+a\/(.+?)\s+b\/(.+)$/;
            for (const line of lines) {
                const gitMatch = line.match(gitDiffRegex);
                if (gitMatch) {
                    const path = gitMatch[2]; // Use the "b" path (new file)

                    if (!isValidFilePath(path)) {
                        continue;
                    }

                    filePath = path;
                    const extension = path.split('.').pop();
                    if (extension) {
                        language = this.mapExtensionToLanguage(extension);
                    }
                    break;
                }
            }
        }

        // Extract original and new code
        let inHunk = false;
        for (const line of lines) {
            // Check for hunk headers to know we're in a diff hunk
            if (line.startsWith('@@')) {
                inHunk = true;
                continue;
            }

            if (inHunk) {
                if (line.startsWith('-')) {
                    originalCode += line.substring(1) + '\n';
                } else if (line.startsWith('+')) {
                    newCode += line.substring(1) + '\n';
                } else if (!line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++')) {
                    // Context lines go into both
                    originalCode += line + '\n';
                    newCode += line + '\n';
                }
            }
        }

        // If we didn't find any hunks, try a more lenient approach
        if (originalCode === '' && newCode === '') {
            for (const line of lines) {
                if (line.startsWith('-') && !line.startsWith('---')) {
                    originalCode += line.substring(1) + '\n';
                } else if (line.startsWith('+') && !line.startsWith('+++')) {
                    newCode += line.substring(1) + '\n';
                } else if (!line.startsWith('@@') && !line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++')) {
                    // Context lines go into both
                    originalCode += line + '\n';
                    newCode += line + '\n';
                }
            }
        }

        return {
            originalCode: originalCode.trim(),
            newCode: newCode.trim(),
            language: language || this.inferLanguageFromCode(originalCode || newCode),
            filePath
        };
    }

    /**
     * Map file extension to language
     * @param extension The file extension
     * @returns The language
     */
    private static mapExtensionToLanguage(extension: string): string {
        const extensionMap: Record<string, string> = {
            'js': 'javascript',
            'ts': 'typescript',
            'jsx': 'javascript',
            'tsx': 'typescript',
            'py': 'python',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'cs': 'csharp',
            'go': 'go',
            'rb': 'ruby',
            'php': 'php',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'md': 'markdown'
        };

        return extensionMap[extension.toLowerCase()] || extension;
    }

    /**
     * Infer language from code
     * @param code The code
     * @returns The inferred language
     */
    private static inferLanguageFromCode(code: string): string {
        // Very basic language inference based on syntax patterns
        if (code.includes('function') && (code.includes('=>') || code.includes('{'))) {
            return 'javascript';
        } else if (code.includes('def ') && code.includes(':')) {
            return 'python';
        } else if (code.includes('class ') && code.includes('{')){
            return 'java';
        } else if (code.includes('<html') || code.includes('</div>')) {
            return 'html';
        } else if (code.includes('import React') || code.includes('from "react"')) {
            return 'javascript';
        } else if (code.includes('#include')) {
            return 'cpp';
        }

        return '';
    }

    /**
     * Parse commands from LLM response
     * @param content The LLM response content
     * @returns An array of parsed commands
     */
    public static parseCommands(content: string): ParsedCommand[] {
        const commands: ParsedCommand[] = [];

        if (!content) {
            logger.warn('Cannot parse commands: content is empty');
            return commands;
        }

        try {
            logger.debug('Parsing commands from content', { contentLength: content.length });

            // Look for commands in code blocks with shell, bash, cmd, powershell, etc.
            const shellLanguages = ['sh', 'shell', 'bash', 'cmd', 'powershell', 'ps', 'bat', 'batch', 'terminal', 'console', ''];
            const codeBlockRegex = /```([\w-]*)\n([\s\S]*?)```/gi;
            let match;
            let codeBlockCount = 0;

            while ((match = codeBlockRegex.exec(content)) !== null) {
                codeBlockCount++;
                const language = match[1].trim().toLowerCase();
                const code = match[2].trim();

                // Check if this is a shell/command code block
                if (shellLanguages.includes(language)) {
                    logger.debug('Found shell code block', { language, codeLength: code.length });

                    // Split by lines and filter out comments and empty lines
                    const lines = code.split('\n')
                        .map(line => line.trim())
                        .filter(line => line && !line.startsWith('#') && !line.startsWith('//'));

                    if (lines.length === 0) {
                        logger.debug('Shell code block contains no valid commands');
                        continue;
                    }

                    // Look for description before the code block
                    const contextBefore = content.substring(Math.max(0, match.index - 200), match.index);
                    const paragraphs = contextBefore.split('\n\n');
                    const lastParagraph = paragraphs[paragraphs.length - 1] || '';

                    // Try different description patterns
                    let description: string | undefined;

                    // Pattern 1: "Run this command to..."
                    const runCommandRegex = /(?:run|execute|use|try|enter|type)\s+(?:the\s+)?(?:following|this)?\s+(?:command|script|code)(?:\s+to\s+([^.!?]+))?[.!?]/i;
                    const runCommandMatch = lastParagraph.match(runCommandRegex);
                    if (runCommandMatch && runCommandMatch[1]) {
                        description = runCommandMatch[1].trim();
                    }

                    // Pattern 2: "To install the package..."
                    if (!description) {
                        const toDoRegex = /To\s+([^.!?]+)(?:,|\s+you\s+can|\s+use|\s+run)[.!?]?/i;
                        const toDoMatch = lastParagraph.match(toDoRegex);
                        if (toDoMatch && toDoMatch[1]) {
                            description = toDoMatch[1].trim();
                        }
                    }

                    // Pattern 3: "This command will..."
                    if (!description) {
                        const willDoRegex = /This\s+(?:command|script|code)\s+will\s+([^.!?]+)[.!?]/i;
                        const willDoMatch = lastParagraph.match(willDoRegex);
                        if (willDoMatch && willDoMatch[1]) {
                            description = willDoMatch[1].trim();
                        }
                    }

                    logger.debug('Command description extracted', { description });

                    // Add each line as a separate command
                    for (const line of lines) {
                        // Skip lines that are just file paths or markdown
                        if (this.isLikelyFilePath(line) || this.isLikelyMarkdown(line)) {
                            logger.debug('Skipping likely file path or markdown', { line });
                            continue;
                        }

                        // Skip lines that don't look like commands
                        if (!this.isLikelyCommand(line)) {
                            logger.debug('Skipping line that doesn\'t look like a command', { line });
                            continue;
                        }

                        logger.debug('Adding command from code block', { command: line });
                        commands.push({
                            command: line,
                            description
                        });
                    }
                } else {
                    logger.debug('Skipping non-shell code block', { language });
                }
            }

            logger.debug('Code block parsing complete', {
                codeBlockCount,
                commandsFound: commands.length
            });

            // Also look for inline commands with $ or > prefix
            const inlineCommandRegex = /(?:^|\n)(?:\s*[`$>]\s*)([\w\s-./\\:;|&<>"'{}[\]()+=]+)/g;
            let inlineMatch;
            let inlineCommandCount = 0;

            while ((inlineMatch = inlineCommandRegex.exec(content)) !== null) {
                inlineCommandCount++;
                const command = inlineMatch[1].trim();

                if (!command) {
                    continue;
                }

                // Skip if this command is already in our list
                if (commands.some(c => c.command === command)) {
                    logger.debug('Skipping duplicate inline command', { command });
                    continue;
                }

                // Skip lines that are just file paths or markdown
                if (this.isLikelyFilePath(command) || this.isLikelyMarkdown(command)) {
                    logger.debug('Skipping likely file path or markdown', { command });
                    continue;
                }

                // Skip lines that don't look like commands
                if (!this.isLikelyCommand(command)) {
                    logger.debug('Skipping line that doesn\'t look like a command', { command });
                    continue;
                }

                // Look for description around the command
                const contextBefore = content.substring(Math.max(0, inlineMatch.index - 150), inlineMatch.index);
                const contextAfter = content.substring(inlineMatch.index, Math.min(content.length, inlineMatch.index + 150));
                const surroundingContext = contextBefore + contextAfter;

                // Try different description patterns
                let description: string | undefined;

                // Pattern 1: "Run this command to..."
                const runCommandRegex = /(?:run|execute|use|try|enter|type)\s+(?:the\s+)?(?:following|this)?\s+(?:command|script|code)(?:\s+to\s+([^.!?]+))?[.!?]/i;
                const runCommandMatch = surroundingContext.match(runCommandRegex);
                if (runCommandMatch && runCommandMatch[1]) {
                    description = runCommandMatch[1].trim();
                }

                // Pattern 2: "To install the package..."
                if (!description) {
                    const toDoRegex = /To\s+([^.!?]+)(?:,|\s+you\s+can|\s+use|\s+run)[.!?]?/i;
                    const toDoMatch = surroundingContext.match(toDoRegex);
                    if (toDoMatch && toDoMatch[1]) {
                        description = toDoMatch[1].trim();
                    }
                }

                // Pattern 3: "This command will..."
                if (!description) {
                    const willDoRegex = /This\s+(?:command|script|code)\s+will\s+([^.!?]+)[.!?]/i;
                    const willDoMatch = surroundingContext.match(willDoRegex);
                    if (willDoMatch && willDoMatch[1]) {
                        description = willDoMatch[1].trim();
                    }
                }

                logger.debug('Adding inline command', { command, description });
                commands.push({
                    command,
                    description
                });
            }

            logger.debug('Inline command parsing complete', {
                inlineCommandCount,
                totalCommandsFound: commands.length
            });

            return commands;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error parsing commands', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined
            });
            return commands;
        }
    }

    /**
     * Check if a string is likely a file path rather than a command
     * @param str The string to check
     * @returns True if the string is likely a file path
     */
    private static isLikelyFilePath(str: string): boolean {
        // Check if the path is too long (likely a sentence, not a path)
        if (str.length > 100) {
            return false;
        }

        // Check if the path contains spaces without quotes
        if (str.includes(' ') && !str.startsWith('"') && !str.startsWith("'")) {
            // Allow spaces in Windows paths like "C:\Program Files\file.txt"
            if (!str.match(/^[A-Za-z]:\\/) && !str.match(/^\/[A-Za-z]/)) {
                return false;
            }
        }

        // Check for common file extensions
        const fileExtensionRegex = /\.(js|jsx|ts|tsx|py|java|c|cpp|cs|go|rb|php|html|css|json|md|txt|xml|yaml|yml|config|ini|sh|bat|ps1)$/i;
        if (fileExtensionRegex.test(str)) {
            // Check for invalid characters that shouldn't be in file paths
            const invalidChars = /[<>:"|?*]/;
            if (invalidChars.test(str) && !str.match(/^[A-Za-z]:\\/)) { // Allow : in Windows drive letters
                return false;
            }
            return true;
        }

        // Check for path-like patterns
        const pathPatternRegex = /^(?:\.{1,2}\/|\/|\w:\\|~\/)/;
        if (pathPatternRegex.test(str) && !str.includes(' ')) {
            // Check for invalid characters that shouldn't be in file paths
            const invalidChars = /[<>:"|?*]/;
            if (invalidChars.test(str) && !str.match(/^[A-Za-z]:\\/)) { // Allow : in Windows drive letters
                return false;
            }
            return true;
        }

        return false;
    }

    /**
     * Check if a string is likely markdown rather than a command
     * @param str The string to check
     * @returns True if the string is likely markdown
     */
    private static isLikelyMarkdown(str: string): boolean {
        // Check for markdown headers
        if (/^#{1,6}\s/.test(str)) {
            return true;
        }

        // Check for markdown list items
        if (/^[-*+]\s/.test(str)) {
            return true;
        }

        // Check for markdown links
        if (/\[.+\]\(.+\)/.test(str)) {
            return true;
        }

        // Check if it's just the word "markdown"
        if (/^markdown$/i.test(str)) {
            return true;
        }

        return false;
    }

    /**
     * Check if a string is likely a command
     * @param str The string to check
     * @returns True if the string is likely a command
     */
    private static isLikelyCommand(str: string): boolean {
        // Common command prefixes
        const commandPrefixes = [
            'npm', 'yarn', 'pnpm', 'node', 'python', 'pip', 'git', 'docker', 'kubectl',
            'dotnet', 'mvn', 'gradle', 'cargo', 'go', 'rustc', 'gcc', 'g++', 'make',
            'cd', 'ls', 'dir', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'echo', 'touch',
            'curl', 'wget', 'ssh', 'scp', 'tar', 'zip', 'unzip', 'chmod', 'chown',
            'ps', 'kill', 'top', 'netstat', 'ping', 'traceroute', 'ifconfig', 'ipconfig',
            'apt', 'apt-get', 'yum', 'brew', 'pacman', 'dnf', 'code', 'vscode'
        ];

        // Check if the string starts with a common command prefix
        for (const prefix of commandPrefixes) {
            if (str.startsWith(prefix + ' ') || str === prefix) {
                return true;
            }
        }

        // Check for command-line flags
        if (/\s-{1,2}[a-zA-Z]/.test(str)) {
            return true;
        }

        // Check for Windows commands
        const windowsCommands = [
            'cls', 'copy', 'del', 'erase', 'md', 'rd', 'ren', 'type',
            'ver', 'vol', 'xcopy', 'shutdown', 'tasklist', 'taskkill',
            'sc', 'reg', 'net', 'ipconfig', 'systeminfo', 'powershell'
        ];

        for (const cmd of windowsCommands) {
            if (str.startsWith(cmd + ' ') || str === cmd) {
                return true;
            }
        }

        return false;
    }
}
