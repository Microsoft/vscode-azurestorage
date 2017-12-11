/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { StorageAccount, StorageAccountKey } from '../../../node_modules/azure-arm-storage/lib/models';
import { AzureTreeNodeBase } from '../../azureServiceExplorer/nodes/azureTreeNodeBase';
import { AzureTreeDataProvider } from '../../azureServiceExplorer/azureTreeDataProvider';
import { SubscriptionModels } from 'azure-arm-resource';
import * as azureStorage from "azure-storage";
import * as path from 'path';
import { DirectoryNode } from './directoryNode';
import { FileNode } from './fileNode';
import { AzureLoadMoreTreeNodeBase } from '../../azureServiceExplorer/nodes/azureLoadMoreTreeNodeBase';

export class FileShareNode extends AzureLoadMoreTreeNodeBase {
    private _continuationToken: azureStorage.common.ContinuationToken;

    constructor(
        public readonly subscription: SubscriptionModels.Subscription, 
		public readonly share: azureStorage.FileService.ShareResult,
        public readonly storageAccount: StorageAccount,
        public readonly key: StorageAccountKey,
		treeDataProvider: AzureTreeDataProvider, 
        parentNode: AzureTreeNodeBase) {
		super(share.name, treeDataProvider, parentNode);
		
    }

    getTreeItem(): TreeItem {
        return {
            label: this.label,
            collapsibleState: TreeItemCollapsibleState.Collapsed,
            contextValue: 'azureFileShare',
            iconPath: {
				light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'light', 'AzureFileShare_16x.png'),
				dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'dark', 'AzureFileShare_16x.png')
			}
        }
    }
    
    hasMoreChildren(): boolean {
        return !!this._continuationToken;
    }

    async getMoreChildren(): Promise<any> {
        var fileResults = await this.listFiles(this._continuationToken);
        var {entries, continuationToken } = fileResults;
        this._continuationToken = continuationToken;
        return []
        .concat( entries.directories.map((directory: azureStorage.FileService.DirectoryResult) => {
            return new DirectoryNode('', directory, this.share, this.storageAccount, this.key, this.treeDataProvider, this);
        }))
        .concat(entries.files.map((file: azureStorage.FileService.FileResult) => {
            return new FileNode(file, '', this.share, this.storageAccount, this.key, this.treeDataProvider, this);
        }));
    }

    listFiles(currentToken: azureStorage.common.ContinuationToken): Promise<azureStorage.FileService.ListFilesAndDirectoriesResult> {
        return new Promise(resolve => {
            var fileService = azureStorage.createFileService(this.storageAccount.name, this.key.value);
            fileService.listFilesAndDirectoriesSegmented(this.share.name, '', currentToken, {maxResults: 50}, (_err, result: azureStorage.FileService.ListFilesAndDirectoriesResult) => {
				resolve(result);
			})
		});
    }
}
