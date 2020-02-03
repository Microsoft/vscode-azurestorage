/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BlobGetPropertiesResponse, BlockBlobClient } from '@azure/storage-blob';
import * as fse from 'fs-extra';
import { ProgressLocation, Uri, window } from 'vscode';
import { ext } from "../extensionVariables";
import { TransferProgress } from '../TransferProgress';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { BlobTreeItem } from '../tree/blob/BlobTreeItem';
import { createBlockBlobClient, getExistingProperties } from "../utils/blobUtils";
import { Limits } from '../utils/limits';
import { IRemoteFileHandler } from './IRemoteFileHandler';

export class BlobFileHandler implements IRemoteFileHandler<BlobTreeItem> {
    async getSaveConfirmationText(treeItem: BlobTreeItem): Promise<string> {
        return `Saving '${treeItem.blobName}' will update the blob "${treeItem.blobName}" in Blob Container "${treeItem.container.name}"`;
    }

    async getFilename(treeItem: BlobTreeItem): Promise<string> {
        return treeItem.blobName;
    }

    public async checkCanDownload(treeItem: BlobTreeItem): Promise<void> {
        let message: string | undefined;

        const client: BlockBlobClient = createBlockBlobClient(treeItem.root, treeItem.container.name, treeItem.blobPath);
        let props: BlobGetPropertiesResponse = await client.getProperties();

        if (Number(props.contentLength) > Limits.maxUploadDownloadSizeBytes) {
            message = `Please use Storage Explorer for blobs larger than ${Limits.maxUploadDownloadSizeMB}MB.`;
        } else if (props.blobType && !props.blobType.toLocaleLowerCase().startsWith("block")) {
            message = `Please use Storage Explorer for blobs of type '${props.blobType}'.`;
        }

        if (message) {
            await Limits.askOpenInStorageExplorer(message, treeItem.root.storageAccount.id, treeItem.root.subscriptionId, 'Azure.BlobContainer', treeItem.container.name);
        }
    }

    public async checkCanUpload(treeItem: BlobContainerTreeItem | BlobTreeItem, localPath: string): Promise<void> {
        let size = await this.getLocalFileSize(localPath);
        if (size > Limits.maxUploadDownloadSizeBytes) {
            await Limits.askOpenInStorageExplorer(
                `Please use Storage Explorer to upload files larger than ${Limits.maxUploadDownloadSizeMB}MB.`,
                treeItem.root.storageAccount.id,
                treeItem.root.subscriptionId,
                'Azure.BlobContainer',
                treeItem.container.name);
        }
    }

    private async getLocalFileSize(localPath: string): Promise<number> {
        let stat = await fse.stat(localPath);
        return stat.size;
    }

    public async downloadFile(treeItem: BlobTreeItem, filePath: string): Promise<void> {
        await this.checkCanDownload(treeItem);
        const linkablePath: Uri = Uri.file(filePath); // Allows CTRL+Click in Output panel
        const blockBlobClient: BlockBlobClient = createBlockBlobClient(treeItem.root, treeItem.container.name, treeItem.blobPath);

        // tslint:disable-next-line: strict-boolean-expressions
        const totalBytes: number = (await blockBlobClient.getProperties()).contentLength || 1;

        ext.outputChannel.show();
        ext.outputChannel.appendLine(`Downloading ${treeItem.blobName} to ${filePath}...`);

        await window.withProgress({ title: `Downloading ${treeItem.blobName}`, location: ProgressLocation.Notification }, async (notificationProgress) => {
            const transferProgress: TransferProgress = new TransferProgress(totalBytes, treeItem.blobName);
            await blockBlobClient.downloadToFile(filePath, undefined, undefined, {
                onProgress: (transferProgressEvent) => transferProgress.reportToNotification(transferProgressEvent.loadedBytes, notificationProgress)
            });
        });

        ext.outputChannel.appendLine(`Successfully downloaded ${linkablePath}.`);
    }

    async uploadFile(treeItem: BlobTreeItem, filePath: string): Promise<void> {
        await this.checkCanUpload(treeItem, filePath);
        const blockBlobClient: BlockBlobClient = createBlockBlobClient(treeItem.root, treeItem.container.name, treeItem.blobPath);
        await blockBlobClient.uploadFile(filePath, await getExistingProperties(treeItem, treeItem.blobPath));
    }
}
