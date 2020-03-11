/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorageBlob from "@azure/storage-blob";
import * as azureStorageShare from "@azure/storage-file-share";
import { Endpoints } from "azure-arm-storage/lib/models";
import * as azureStorage from "azure-storage";
import { ISubscriptionContext } from "vscode-azureextensionui";

export interface IStorageRoot extends ISubscriptionContext {
    storageAccountName: string;
    storageAccountId: string;
    isEmulated: boolean;
    primaryEndpoints?: Endpoints;
    createBlobServiceClient(): azureStorageBlob.BlobServiceClient;
    createFileService(): azureStorage.FileService;
    createShareServiceClient(): azureStorageShare.ShareServiceClient;
    createQueueService(): azureStorage.QueueService;
    createTableService(): azureStorage.TableService;
}
