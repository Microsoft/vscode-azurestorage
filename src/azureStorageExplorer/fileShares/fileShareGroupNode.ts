/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import { FileService } from 'azure-storage';
import * as path from 'path';
import { ProgressLocation, Uri, window } from 'vscode';
import { IAzureNode, IAzureParentTreeItem, IAzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { StorageAccountKeyWrapper, StorageAccountWrapper } from "../../components/storageWrappers";
import { FileShareNode } from './fileShareNode';

const minQuotaGB = 1;
const maxQuotaGB = 5120;

export class FileShareGroupNode implements IAzureParentTreeItem {
    private _continuationToken: azureStorage.common.ContinuationToken | undefined;

    constructor(
        public readonly storageAccount: StorageAccountWrapper,
        public readonly key: StorageAccountKeyWrapper) {
    }

    public label: string = "File Shares";
    public contextValue: string = 'azureFileShareGroup';
    public iconPath: { light: string | Uri; dark: string | Uri } = {
        light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'light', 'AzureFileShare_16x.png'),
        dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'dark', 'AzureFileShare_16x.png')
    };

    async loadMoreChildren(_node: IAzureNode, clearCache: boolean): Promise<IAzureTreeItem[]> {
        if (clearCache) {
            this._continuationToken = undefined;
        }

        // tslint:disable-next-line:no-non-null-assertion // currentToken argument typed incorrectly in SDK
        let fileShares = await this.listFileShares(this._continuationToken!);
        let { entries, continuationToken } = fileShares;
        this._continuationToken = continuationToken;

        return entries.map((fileShare: azureStorage.FileService.ShareResult) => {
            return new FileShareNode(
                fileShare,
                this.storageAccount,
                this.key);
        });
    }

    hasMoreChildren(): boolean {
        return !!this._continuationToken;
    }

    // tslint:disable-next-line:promise-function-async // Grandfathered in
    listFileShares(currentToken: azureStorage.common.ContinuationToken): Promise<azureStorage.FileService.ListSharesResult> {
        return new Promise((resolve, reject) => {
            let fileService = azureStorage.createFileService(this.storageAccount.name, this.key.value);
            fileService.listSharesSegmented(currentToken, { maxResults: 50 }, (err?: Error, result?: azureStorage.FileService.ListSharesResult) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        const shareName = await window.showInputBox({
            placeHolder: 'Enter a name for the new file share',
            validateInput: FileShareGroupNode.validateFileShareName
        });

        if (shareName) {
            const quotaGB = await window.showInputBox({
                prompt: `Specify quota (in GB, between ${minQuotaGB} and ${maxQuotaGB}), to limit total storage size`,
                value: maxQuotaGB.toString(),
                validateInput: FileShareGroupNode.validateQuota
            });

            if (quotaGB) {
                return await window.withProgress({ location: ProgressLocation.Window }, async (progress) => {
                    showCreatingNode(shareName);
                    progress.report({ message: `Azure Storage: Creating file share '${shareName}'` });
                    const share = await this.createFileShare(shareName, Number(quotaGB));
                    return new FileShareNode(share, this.storageAccount, this.key);
                });
            }
        }

        throw new UserCancelledError();
    }

    // tslint:disable-next-line:promise-function-async // Grandfathered in
    private createFileShare(name: string, quotaGB: number): Promise<azureStorage.FileService.ShareResult> {
        return new Promise((resolve, reject) => {
            let shareService = azureStorage.createFileService(this.storageAccount.name, this.key.value);
            const options = <FileService.CreateShareRequestOptions>{
                quota: quotaGB
            };
            shareService.createShare(name, options, (err?: Error, result?: azureStorage.FileService.ShareResult) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    private static validateFileShareName(name: string): string | undefined | null {
        const validLength = { min: 3, max: 63 };

        if (!name) {
            return "Share name cannot be empty";
        }
        if (name.indexOf(" ") >= 0) {
            return "Share name cannot contain spaces";
        }
        if (name.length < validLength.min || name.length > validLength.max) {
            return `Share name must contain between ${validLength.min} and ${validLength.max} characters`;
        }
        if (!/^[a-z0-9-]+$/.test(name)) {
            return 'Share name can only contain lowercase letters, numbers and hyphens';
        }
        if (/--/.test(name)) {
            return 'Share name cannot contain two hyphens in a row';
        }
        if (/(^-)|(-$)/.test(name)) {
            return 'Share name cannot begin or end with a hyphen';
        }

        return undefined;
    }

    private static validateQuota(input: string): string | undefined {
        try {
            const value = Number(input);
            if (value < minQuotaGB || value > maxQuotaGB) {
                return `Value must be between ${minQuotaGB} and ${maxQuotaGB}`;
            }
        } catch (err) {
            return "Input must be a number";
        }
        return undefined;
    }
}
