/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tslint:disable-next-line:no-require-imports
import StorageManagementClient = require('azure-arm-storage');
import { StorageAccount } from '../../node_modules/azure-arm-storage/lib/models';
import { IChildProvider, IAzureTreeItem, IAzureNode } from 'vscode-azureextensionui';
import { StorageAccountNode } from './storageAccounts/storageAccountNode';

export class StorageAccountProvider implements IChildProvider {
    async loadMoreChildren(node: IAzureNode, _clearCache: boolean): Promise<IAzureTreeItem[]> {
        let storageManagementClient = new StorageManagementClient(node.credentials, node.subscription.subscriptionId);

        let accounts = await storageManagementClient.storageAccounts.list();
        let accountNodes = accounts.map((storageAccount: StorageAccount) => {
            return new StorageAccountNode(storageAccount, storageManagementClient);
        });

        return accountNodes;
    }

    hasMoreChildren(): boolean {
        return false;
    }
}
