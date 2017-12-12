/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { BaseActionHandler } from '../../azureServiceExplorer/actions/baseActionHandler';

import { BlobContainerNode } from './blobContainerNode';
import { StorageExplorerLauncher } from '../../storageExplorerLauncher/storageExplorerLauncher';
import { BlobEditor } from './blobEditor';
import { IAzureNode } from 'vscode-azureextensionui';

export class BlobContainerActionHandler extends BaseActionHandler {
    private _editor: BlobEditor;
    registerActions(context: vscode.ExtensionContext) {
        this._editor = new BlobEditor();
        context.subscriptions.push(this._editor);

        this.initCommand(context, "azureStorage.openBlobContainer", (node) => { this.openBlobContainerInStorageExplorer(node) });
        this.initCommand(context, "azureStorage.editBlob", (node) => {this._editor.showEditor(node)});
        this.initEvent(context, 'azureStorage.blobEditor.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument, (doc: vscode.TextDocument) => this._editor.onDidSaveTextDocument(context.globalState, doc));
    }

    openBlobContainerInStorageExplorer(node: IAzureNode<BlobContainerNode>) {
        var resourceId = node.treeItem.storageAccount.id;
        var subscriptionid = node.treeItem.subscription.subscriptionId;
        var resourceType = "Azure.BlobContainer";
        var resourceName = node.treeItem.container.name;

        StorageExplorerLauncher.openResource(resourceId, subscriptionid, resourceType, resourceName);
    }
}
