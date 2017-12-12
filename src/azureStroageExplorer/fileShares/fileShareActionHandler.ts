/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { BaseActionHandler } from '../../azureServiceExplorer/actions/baseActionHandler';

import { FileShareNode } from './fileShareNode';
import { StorageExplorerLauncher } from '../../storageExplorerLauncher/storageExplorerLauncher';
import { FileEditor } from './fileEditor';
import { IAzureNode } from 'vscode-azureextensionui';

export class FileShareActionHandler extends BaseActionHandler {
    private _editor: FileEditor;

    registerActions(context: vscode.ExtensionContext) {
        this._editor = new FileEditor();
        context.subscriptions.push(this._editor);

        this.initCommand(context, "azureStorage.openFileShare", (node) => { this.openFileShareInStorageExplorer(node) });
        this.initCommand(context, "azureStorage.editFile", (node) => {this._editor.showEditor(node)});
        this.initEvent(context, 'azureStorage.fileEditor.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument, (doc: vscode.TextDocument) => this._editor.onDidSaveTextDocument(context.globalState, doc));
    }

    openFileShareInStorageExplorer(node: IAzureNode<FileShareNode>) {
        var resourceId = node.treeItem.storageAccount.id;
        var subscriptionid = node.treeItem.subscription.subscriptionId;
        var resourceType = "Azure.FileShare";
        var resourceName = node.treeItem.share.name;

        StorageExplorerLauncher.openResource(resourceId, subscriptionid, resourceType, resourceName);
    }
}
