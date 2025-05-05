import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { Logger, LogLevel } from '../../utils/logger';

suite('Logger Tests', () => {
    let outputChannelMock: any;
    let createOutputChannelStub: sinon.SinonStub;
    
    setup(() => {
        // Create a mock for the output channel
        outputChannelMock = {
            appendLine: sinon.stub(),
            show: sinon.stub(),
            dispose: sinon.stub()
        };
        
        // Stub the createOutputChannel method
        createOutputChannelStub = sinon.stub(vscode.window, 'createOutputChannel').returns(outputChannelMock);
    });
    
    teardown(() => {
        // Restore the stub
        createOutputChannelStub.restore();
        
        // Reset the Logger instance
        (Logger as any).instance = undefined;
    });
    
    test('Logger should be a singleton', () => {
        const logger1 = Logger.getInstance();
        const logger2 = Logger.getInstance();
        
        assert.strictEqual(logger1, logger2, 'Logger instances should be the same');
        assert.strictEqual(createOutputChannelStub.callCount, 1, 'createOutputChannel should be called only once');
    });
    
    test('Logger should log messages at the appropriate level', () => {
        const logger = Logger.getInstance();
        
        // Set log level to INFO
        logger.setLogLevel(LogLevel.INFO);
        
        // Test debug message (should not be logged)
        logger.debug('Debug message');
        assert.strictEqual(outputChannelMock.appendLine.callCount, 0, 'Debug message should not be logged at INFO level');
        
        // Test info message
        logger.info('Info message');
        assert.strictEqual(outputChannelMock.appendLine.callCount, 1, 'Info message should be logged at INFO level');
        
        // Test warn message
        logger.warn('Warning message');
        assert.strictEqual(outputChannelMock.appendLine.callCount, 2, 'Warning message should be logged at INFO level');
        
        // Test error message
        logger.error('Error message');
        assert.strictEqual(outputChannelMock.appendLine.callCount, 3, 'Error message should be logged at INFO level');
    });
    
    test('Logger should format error objects correctly', () => {
        const logger = Logger.getInstance();
        logger.setLogLevel(LogLevel.DEBUG);
        
        const error = new Error('Test error');
        logger.error('Error occurred', error);
        
        assert.strictEqual(outputChannelMock.appendLine.callCount, 1, 'Error should be logged');
        const loggedMessage = outputChannelMock.appendLine.firstCall.args[0];
        
        assert.ok(loggedMessage.includes('Error occurred'), 'Log should include the message');
        assert.ok(loggedMessage.includes('Test error'), 'Log should include the error message');
    });
    
    test('Logger should handle non-serializable data', () => {
        const logger = Logger.getInstance();
        logger.setLogLevel(LogLevel.DEBUG);
        
        // Create a circular reference
        const circularObj: any = { name: 'circular' };
        circularObj.self = circularObj;
        
        logger.debug('Debug with circular reference', circularObj);
        
        assert.strictEqual(outputChannelMock.appendLine.callCount, 1, 'Message should be logged');
        const loggedMessage = outputChannelMock.appendLine.firstCall.args[0];
        
        assert.ok(loggedMessage.includes('Debug with circular reference'), 'Log should include the message');
        assert.ok(loggedMessage.includes('[Non-serializable data:'), 'Log should indicate non-serializable data');
    });
});
