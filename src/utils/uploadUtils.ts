/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { parseError, TelemetryProperties } from "vscode-azureextensionui";
import { ext } from '../extensionVariables';
import { TransferProgress } from '../TransferProgress';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { FileShareTreeItem } from '../tree/fileShare/FileShareTreeItem';
import { throwIfCanceled } from './errorUtils';

export async function uploadFiles(
    destTreeItem: BlobContainerTreeItem | FileShareTreeItem,
    sourceFolder: string,
    destFolder: string,
    filePathsToUpload: string[],
    properties: TelemetryProperties,
    transferProgress: TransferProgress,
    notificationProgress: vscode.Progress<{
        message?: string | undefined;
        increment?: number | undefined;
    }>,
    cancellationToken: vscode.CancellationToken
): Promise<void> {
    for (const sourceFileIndex of filePathsToUpload.keys()) {
        throwIfCanceled(cancellationToken, properties, "uploadFiles");
        let sourceFilePath: string = filePathsToUpload[sourceFileIndex];
        let relativeFile: string = path.relative(sourceFolder, sourceFilePath);
        let destFilePath: string = path.join(destFolder, relativeFile);
        ext.outputChannel.appendLine(`Uploading ${sourceFilePath}...`);

        try {
            await destTreeItem.uploadLocalFile(sourceFilePath, destFilePath, true /* suppressLogs */);
        } catch (error) {
            throw new Error(`Error uploading "${sourceFilePath}": ${parseError(error).message} `);
        }

        transferProgress.reportToNotification(sourceFileIndex, notificationProgress);
    }
}
