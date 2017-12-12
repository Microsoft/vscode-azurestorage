/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri } from 'vscode';
import { StorageAccount, StorageAccountKey } from '../../../node_modules/azure-arm-storage/lib/models';
import { FileShareNode } from './fileShareNode';
import { SubscriptionModels } from 'azure-arm-resource';
import * as azureStorage from "azure-storage";
import * as path from 'path';
import { IAzureTreeItem, IAzureParentTreeItem } from 'vscode-azureextensionui';

export class FileShareGroupNode implements IAzureParentTreeItem {
    private _continuationToken: azureStorage.common.ContinuationToken;

    constructor(
        public readonly subscription: SubscriptionModels.Subscription, 
        public readonly storageAccount: StorageAccount,
        public readonly key: StorageAccountKey) {		
    }

    public id: string = "File Shares";
    public label: string = "File Shares";
    public contextValue: string = 'azureFileShare';
    public iconPath: { light: string | Uri; dark: string | Uri } = {
        light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'light', 'AzureFileShare_16x.png'),
        dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'dark', 'AzureFileShare_16x.png')
    };

    async loadMoreChildren(): Promise<IAzureTreeItem[]> {
        var fileShares = await this.listFileShares(this._continuationToken);
        var {entries, continuationToken } = fileShares;
        this._continuationToken = continuationToken;

        return entries.map((fileShare: azureStorage.FileService.ShareResult) => {
            return new FileShareNode(
                this.subscription,
                fileShare, 
                this.storageAccount, 
                this.key);
        });
    }

    hasMoreChildren(): boolean {
        return !!this._continuationToken;
    }

    listFileShares(currentToken: azureStorage.common.ContinuationToken): Promise<azureStorage.FileService.ListSharesResult> {
        return new Promise(resolve => {
            var fileService = azureStorage.createFileService(this.storageAccount.name, this.key.value);
			fileService.listSharesSegmented(currentToken, {maxResults: 50}, (_err, result: azureStorage.FileService.ListSharesResult) => {
				resolve(result);
			})
		});
    }
}
