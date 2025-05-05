// Mock vscode module
const mockVscode = require('./mock-vscode');
jest.mock('vscode', () => mockVscode, { virtual: true });

// Run the simple vector store test
require('./out/test/simpleRagTest');
