import * as vscode from 'vscode';

/**
 * Log levels for the extension
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

/**
 * Logger class for the extension
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('PraxCode');
        this.logLevel = LogLevel.INFO; // Default log level
    }

    /**
     * Get the logger instance (singleton)
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Set the log level
     * @param level The log level to set
     */
    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    /**
     * Log a debug message
     * @param message The message to log
     * @param data Optional data to log
     */
    public debug(message: string, data?: any): void {
        if (this.logLevel <= LogLevel.DEBUG) {
            this.log('DEBUG', message, data);
        }
    }

    /**
     * Log an info message
     * @param message The message to log
     * @param data Optional data to log
     */
    public info(message: string, data?: any): void {
        if (this.logLevel <= LogLevel.INFO) {
            this.log('INFO', message, data);
        }
    }

    /**
     * Log a warning message
     * @param message The message to log
     * @param data Optional data to log
     */
    public warn(message: string, data?: any): void {
        if (this.logLevel <= LogLevel.WARN) {
            this.log('WARN', message, data);
        }
    }

    /**
     * Log an error message
     * @param message The message to log
     * @param error Optional error to log
     */
    public error(message: string, error?: any): void {
        if (this.logLevel <= LogLevel.ERROR) {
            this.log('ERROR', message, error);
        }
    }

    /**
     * Show the output channel
     */
    public show(): void {
        this.outputChannel.show();
    }

    /**
     * Dispose the output channel
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }

    /**
     * Internal log method
     * @param level The log level
     * @param message The message to log
     * @param data Optional data to log
     */
    private log(level: string, message: string, data?: any): void {
        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] [${level}] ${message}`;
        
        if (data) {
            if (data instanceof Error) {
                logMessage += `\n${data.stack || data.message}`;
            } else {
                try {
                    logMessage += `\n${JSON.stringify(data, null, 2)}`;
                } catch (e) {
                    logMessage += `\n[Non-serializable data: ${typeof data}]`;
                }
            }
        }
        
        this.outputChannel.appendLine(logMessage);
    }
}

// Export a singleton instance
export const logger = Logger.getInstance();
