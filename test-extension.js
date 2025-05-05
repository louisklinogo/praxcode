const vscode = require('vscode');

async function testExtension() {
    try {
        console.log('Testing PraxCode extension...');
        
        // Test the hello world command
        await vscode.commands.executeCommand('praxcode.helloWorld');
        console.log('Hello World command executed');
        
        // Test the show menu command
        await vscode.commands.executeCommand('praxcode.showMenu');
        console.log('Show Menu command executed');
        
        // Test the index workspace command
        await vscode.commands.executeCommand('praxcode.indexWorkspace');
        console.log('Index Workspace command executed');
        
        // Test the open chat panel command
        await vscode.commands.executeCommand('praxcode.openChatPanel');
        console.log('Open Chat Panel command executed');
        
        console.log('All commands executed successfully');
    } catch (error) {
        console.error('Error testing extension:', error);
    }
}

module.exports = {
    testExtension
};

// Run the test if this script is executed directly
if (require.main === module) {
    testExtension();
}
