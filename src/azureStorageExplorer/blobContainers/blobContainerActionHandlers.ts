/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { BlobContainerNode, ChildType } from './blobContainerNode';
import { storageExplorerLauncher } from '../../storageExplorerLauncher/storageExplorerLauncher';
import { IAzureNode, AzureActionHandler, IAzureParentNode } from 'vscode-azureextensionui';
import { RemoteFileEditor } from '../../azureServiceExplorer/editors/RemoteFileEditor';
import { azureStorageOutputChannel } from '../azureStorageOutputChannel';
import { BlobNode } from './blobNode';
import { BlobFileHandler } from './blobFileHandler';

export function registerBlobContainerActionHandlers(actionHandler: AzureActionHandler, context: vscode.ExtensionContext): void {
    const _editor: RemoteFileEditor<IAzureNode<BlobNode>> = new RemoteFileEditor(new BlobFileHandler(), "azureStorage.blob.showSavePrompt", azureStorageOutputChannel);
    context.subscriptions.push(_editor);

    actionHandler.registerCommand("azureStorage.openBlobContainer", openBlobContainerInStorageExplorer);
    actionHandler.registerCommand("azureStorage.editBlob", (node: IAzureParentNode<BlobNode>) => _editor.showEditor(node));
    actionHandler.registerCommand("azureStorage.deleteBlobContainer", (node: IAzureParentNode<BlobContainerNode>) => node.deleteNode());
    actionHandler.registerCommand("azureStorage.createBlockTextBlob", (node: IAzureParentNode<BlobContainerNode>) => node.createChild({ childType: ChildType.newBlockBlob }));
    actionHandler.registerCommand("azureStorage.uploadBlockBlob", (node: IAzureParentNode<BlobContainerNode>) => node.createChild({ childType: ChildType.uploadedBlob }));
    actionHandler.registerEvent('azureStorage.blobEditor.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument, (trackTelemetry: () => void, doc: vscode.TextDocument) => _editor.onDidSaveTextDocument(trackTelemetry, doc));
}

function openBlobContainerInStorageExplorer(node: IAzureNode<BlobContainerNode>): Promise<void> {
    let accountId = node.treeItem.storageAccount.id;
    let subscriptionid = node.subscription.subscriptionId;
    const resourceType = 'Azure.BlobContainer';
    let resourceName = node.treeItem.container.name;

    return storageExplorerLauncher.openResource(accountId, subscriptionid, resourceType, resourceName);
}
