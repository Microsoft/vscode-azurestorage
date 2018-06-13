/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import { Reporter, reporter } from './components/telemetry/reporter';
import * as vscode from 'vscode';
/*
import { AzureStorgeProvider } from './explorer/azureStorage'
*/

import { AzureTreeDataProvider, AzureActionHandler, IAzureNode, IAzureUserInput, AzureUserInput, IAzureTreeItem } from 'vscode-azureextensionui';
import { StorageAccountProvider } from './azureStorageExplorer/storageAccountProvider';
import { azureStorageOutputChannel } from './azureStorageExplorer/azureStorageOutputChannel';
import { registerBlobActionHandlers } from './azureStorageExplorer/blobContainers/blobActionHandlers';
import { registerBlobContainerActionHandlers } from './azureStorageExplorer/blobContainers/blobContainerActionHandlers';
import { registerBlobContainerGroupActionHandlers } from './azureStorageExplorer/blobContainers/blobContainerGroupActionHandlers';
import { registerDirectoryActionHandlers } from './azureStorageExplorer/fileShares/directoryActionHandlers';
import { registerFileActionHandlers } from './azureStorageExplorer/fileShares/fileActionHandlers';
import { registerFileShareActionHandlers } from './azureStorageExplorer/fileShares/fileShareActionHandlers';
import { registerFileShareGroupActionHandlers } from './azureStorageExplorer/fileShares/fileShareGroupActionHandlers';
import { registerLoadMoreActionHandler } from './azureStorageExplorer/loadMoreActionHandler';
import { registerQueueActionHandlers } from './azureStorageExplorer/queues/queueActionHandlers';
import { registerQueueGroupActionHandlers } from './azureStorageExplorer/queues/queueGroupActionHandlers';
import { registerStorageAccountActionHandlers } from './azureStorageExplorer/storageAccounts/storageAccountActionHandlers';
import { registerTableActionHandlers } from './azureStorageExplorer/tables/tableActionHandlers';
import { registerTableGroupActionHandlers } from './azureStorageExplorer/tables/tableGroupActionHandlers';
import { commands } from 'vscode';
import { ICopyUrl } from './ICopyUrl';
import { StorageAccountNode } from './azureStorageExplorer/storageAccounts/storageAccountNode';
import { BlobContainerNode } from './azureStorageExplorer/blobContainers/blobContainerNode';

export function activate(context: vscode.ExtensionContext): void {
    console.log('Extension "Azure Storage Tools" is now active.');
    // const rootPath = vscode.workspace.rootPath;

    context.subscriptions.push(new Reporter(context));

    const actionHandler: AzureActionHandler = new AzureActionHandler(context, azureStorageOutputChannel, reporter);

    const ui: IAzureUserInput = new AzureUserInput(context.globalState);

    const tree = new AzureTreeDataProvider(new StorageAccountProvider(), 'azureStorage.loadMoreNode', ui, reporter);
    registerBlobActionHandlers(actionHandler);
    registerBlobContainerActionHandlers(actionHandler, context);
    registerBlobContainerGroupActionHandlers(actionHandler);
    registerFileActionHandlers(actionHandler);
    registerDirectoryActionHandlers(actionHandler);
    registerFileShareActionHandlers(actionHandler, context);
    registerFileShareGroupActionHandlers(actionHandler);
    registerLoadMoreActionHandler(actionHandler, tree);
    registerQueueActionHandlers(actionHandler);
    registerQueueGroupActionHandlers(actionHandler);
    registerStorageAccountActionHandlers(actionHandler, tree);
    registerTableActionHandlers(actionHandler);
    registerTableGroupActionHandlers(actionHandler);

    vscode.window.registerTreeDataProvider('azureStorage', tree);
    actionHandler.registerCommand('azureStorage.refresh', (node?: IAzureNode) => tree.refresh(node));
    actionHandler.registerCommand('azureStorage.copyUrl', (node?: IAzureNode<IAzureTreeItem & ICopyUrl>) => node.treeItem.copyUrl(node));
    actionHandler.registerCommand('azureStorage.selectSubscriptions', () => commands.executeCommand("azure-account.selectSubscriptions"));
    actionHandler.registerCommand("azureStorage.openInPortal", (node: IAzureNode<IAzureTreeItem>) => {
        node.openInPortal();
    });
    actionHandler.registerCommand("azureStorage.configureStaticWebsite", async (node: IAzureNode<IAzureTreeItem>) => {
        // asdf handle on $web container
        if (!node) {
            node = <IAzureNode<StorageAccountNode>>await tree.showNodePicker(StorageAccountNode.contextValue);
        }

        if (node) {
            if (node.treeItem.contextValue === BlobContainerNode.contextValue) {
                // Currently the portal only allows configuring at the storage account level testpoint, so retrieve the storage account node
                let storageAccountNode = node.parent && node.parent.parent;
                console.assert(!!storageAccountNode && storageAccountNode.treeItem.contextValue === StorageAccountNode.contextValue, "Couldn't find storage account node for container");
                node = storageAccountNode;
            }
        }

        if (node) {
            let featureQuery = "feature.staticwebsites=true"; // Needed until preview is public
            let resourceId = `${node.id}/staticWebsite`;
            node.openInPortal(resourceId, { queryPrefix: featureQuery });
        }
    });
}
