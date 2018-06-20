/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import * as path from 'path';
import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { IAzureNode, IAzureParentTreeItem, IAzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { StorageAccount, StorageAccountKey } from '../../../node_modules/azure-arm-storage/lib/models';
import { BlobContainerNode } from './blobContainerNode';

export class BlobContainerGroupNode implements IAzureParentTreeItem {
    private _continuationToken: azureStorage.common.ContinuationToken;

    constructor(
        public readonly storageAccount: StorageAccount,
        public readonly key: StorageAccountKey) {
    }

    public label: string = "Blob Containers";
    public contextValue: string = 'azureBlobContainerGroup';
    public iconPath: { light: string | Uri; dark: string | Uri } = {
        light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'light', 'AzureBlob_16x.png'),
        dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'dark', 'AzureBlob_16x.png')
    };

    public async loadMoreChildren(_node: IAzureNode, clearCache: boolean): Promise<IAzureTreeItem[]> {
        if (clearCache) {
            this._continuationToken = undefined;
        }

        let containers = await this.listContainers(this._continuationToken);
        let { entries, continuationToken } = containers;
        this._continuationToken = continuationToken;

        return entries.map((container: azureStorage.BlobService.ContainerResult) => {
            return new BlobContainerNode(container, this.storageAccount, this.key);
        });
    }

    public hasMoreChildren(): boolean {
        return !!this._continuationToken;
    }

    // tslint:disable-next-line:promise-function-async // Grandfathered in
    private listContainers(currentToken: azureStorage.common.ContinuationToken): Promise<azureStorage.BlobService.ListContainerResult> {
        return new Promise((resolve, reject) => {
            let blobService = azureStorage.createBlobService(this.storageAccount.name, this.key.value);
            blobService.listContainersSegmented(currentToken, { maxResults: 50 }, (err: Error, result: azureStorage.BlobService.ListContainerResult) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        const containerName = await vscode.window.showInputBox({
            placeHolder: 'Enter a name for the new blob container',
            validateInput: BlobContainerGroupNode.validateContainerName
        });

        if (containerName) {
            return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (progress) => {
                showCreatingNode(containerName);
                progress.report({ message: `Azure Storage: Creating blob container '${containerName}'` });
                const container = await this.createBlobContainer(containerName);
                return new BlobContainerNode(container, this.storageAccount, this.key);
            });
        }

        throw new UserCancelledError();
    }

    // tslint:disable-next-line:promise-function-async // Grandfathered in
    private createBlobContainer(name: string): Promise<azureStorage.BlobService.ContainerResult> {
        return new Promise((resolve, reject) => {
            let blobService = azureStorage.createBlobService(this.storageAccount.name, this.key.value);
            blobService.createContainer(name, (err: Error, result: azureStorage.BlobService.ContainerResult) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    private static validateContainerName(name: string): string | undefined | null {
        const validLength = { min: 3, max: 63 };

        if (!name) {
            return "Container name cannot be empty";
        }
        if (name.indexOf(" ") >= 0) {
            return "Container name cannot contain spaces";
        }
        if (name.length < validLength.min || name.length > validLength.max) {
            return `Container name must contain between ${validLength.min} and ${validLength.max} characters`;
        }
        if (!/^[a-z0-9-]+$/.test(name)) {
            return 'Container name can only contain lowercase letters, numbers and hyphens';
        }
        if (/--/.test(name)) {
            return 'Container name cannot contain two hyphens in a row';
        }
        if (/(^-)|(-$)/.test(name)) {
            return 'Container name cannot begin or end with a hyphen';
        }

        return undefined;
    }
}
