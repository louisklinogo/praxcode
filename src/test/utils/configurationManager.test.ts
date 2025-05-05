import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ConfigurationManager, LLMProviderType } from '../../utils/configurationManager';

suite('ConfigurationManager Tests', () => {
    let configStub: any;
    let getConfigurationStub: sinon.SinonStub;
    let contextMock: any;
    
    setup(() => {
        // Create a mock configuration
        configStub = {
            get: sinon.stub()
        };
        
        // Set default return values for config.get
        configStub.get.withArgs('llmProvider', LLMProviderType.OLLAMA).returns(LLMProviderType.OLLAMA);
        configStub.get.withArgs('ollamaUrl', 'http://localhost:11434').returns('http://localhost:11434');
        configStub.get.withArgs('ollamaModel', 'llama3').returns('llama3');
        configStub.get.withArgs('vectorStore.enabled', true).returns(true);
        configStub.get.withArgs('vectorStore.embeddingModel', 'nomic-embed-text').returns('nomic-embed-text');
        configStub.get.withArgs('indexing.includePatterns', sinon.match.any).returns(['**/*.{js,ts}']),
        configStub.get.withArgs('indexing.excludePatterns', sinon.match.any).returns(['**/node_modules/**']),
        configStub.get.withArgs('ui.showStatusBarItem', true).returns(true);
        configStub.get.withArgs('logging.logLevel', 'info').returns('info');
        
        // Stub the getConfiguration method
        getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(configStub);
        
        // Create a mock for the extension context
        contextMock = {
            secrets: {
                store: sinon.stub().resolves(),
                get: sinon.stub().resolves('test-api-key'),
                delete: sinon.stub().resolves()
            }
        };
        
        // Reset the ConfigurationManager instance
        (ConfigurationManager as any).instance = undefined;
    });
    
    teardown(() => {
        // Restore the stub
        getConfigurationStub.restore();
    });
    
    test('ConfigurationManager should be a singleton', () => {
        const configManager1 = ConfigurationManager.getInstance(contextMock);
        const configManager2 = ConfigurationManager.getInstance(contextMock);
        
        assert.strictEqual(configManager1, configManager2, 'ConfigurationManager instances should be the same');
    });
    
    test('getConfiguration should return the correct configuration', () => {
        const configManager = ConfigurationManager.getInstance(contextMock);
        const config = configManager.getConfiguration();
        
        assert.strictEqual(config.llmProvider, LLMProviderType.OLLAMA, 'llmProvider should be OLLAMA');
        assert.strictEqual(config.ollamaUrl, 'http://localhost:11434', 'ollamaUrl should be correct');
        assert.strictEqual(config.ollamaModel, 'llama3', 'ollamaModel should be correct');
        assert.strictEqual(config.vectorStoreEnabled, true, 'vectorStoreEnabled should be true');
        assert.strictEqual(config.embeddingModel, 'nomic-embed-text', 'embeddingModel should be correct');
        assert.deepStrictEqual(config.includePatterns, ['**/*.{js,ts}'], 'includePatterns should be correct');
        assert.deepStrictEqual(config.excludePatterns, ['**/node_modules/**'], 'excludePatterns should be correct');
        assert.strictEqual(config.showStatusBarItem, true, 'showStatusBarItem should be true');
        assert.strictEqual(config.logLevel, 'info', 'logLevel should be info');
    });
    
    test('storeSecret should store a secret in the secret storage', async () => {
        const configManager = ConfigurationManager.getInstance(contextMock);
        await configManager.storeSecret('test-key', 'test-value');
        
        assert.strictEqual(contextMock.secrets.store.callCount, 1, 'store should be called once');
        assert.strictEqual(contextMock.secrets.store.firstCall.args[0], 'test-key', 'Key should be correct');
        assert.strictEqual(contextMock.secrets.store.firstCall.args[1], 'test-value', 'Value should be correct');
    });
    
    test('getSecret should retrieve a secret from the secret storage', async () => {
        const configManager = ConfigurationManager.getInstance(contextMock);
        const secret = await configManager.getSecret('test-key');
        
        assert.strictEqual(contextMock.secrets.get.callCount, 1, 'get should be called once');
        assert.strictEqual(contextMock.secrets.get.firstCall.args[0], 'test-key', 'Key should be correct');
        assert.strictEqual(secret, 'test-api-key', 'Secret should be correct');
    });
    
    test('deleteSecret should delete a secret from the secret storage', async () => {
        const configManager = ConfigurationManager.getInstance(contextMock);
        await configManager.deleteSecret('test-key');
        
        assert.strictEqual(contextMock.secrets.delete.callCount, 1, 'delete should be called once');
        assert.strictEqual(contextMock.secrets.delete.firstCall.args[0], 'test-key', 'Key should be correct');
    });
});
