// Mock vscode module
module.exports = {
    window: {
        showInformationMessage: () => {},
        showErrorMessage: () => {},
        showWarningMessage: () => {},
        createOutputChannel: () => ({
            appendLine: () => {},
            show: () => {},
            dispose: () => {}
        })
    },
    workspace: {
        getConfiguration: () => ({
            get: (key, defaultValue) => defaultValue
        })
    },
    OutputChannel: class {},
    Uri: {
        file: (path) => ({ fsPath: path })
    },
    EventEmitter: class {},
    Disposable: class {},
    StatusBarAlignment: {
        Left: 1,
        Right: 2
    },
    ProgressLocation: {
        Notification: 1
    }
};
