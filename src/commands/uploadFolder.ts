/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IActionContext, IParsedError, parseError } from 'vscode-azureextensionui';
import { NotificationProgress } from '../constants';
import { ext } from '../extensionVariables';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { FileShareTreeItem } from '../tree/fileShare/FileShareTreeItem';
import { isAzCopyError } from '../utils/errorUtils';
import { nonNullValue } from '../utils/nonNull';
import { convertLocalPathToRemotePath, getDestinationDirectory, getUploadingMessageWithSource, shouldUploadUri, upload, uploadLocalFolder } from '../utils/uploadUtils';

export async function uploadFolder(
    actionContext: IActionContext,
    treeItem?: BlobContainerTreeItem | FileShareTreeItem,
    uri?: vscode.Uri,
    notificationProgress?: NotificationProgress,
    cancellationToken?: vscode.CancellationToken,
    destinationDirectory?: string
): Promise<IParsedError[]> {
    const calledFromUploadToAzureStorage: boolean = uri !== undefined;
    if (uri === undefined) {
        uri = (await ext.ui.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri : undefined,
            openLabel: upload
        }))[0];
    }

    // tslint:disable-next-line: strict-boolean-expressions
    treeItem = treeItem || <BlobContainerTreeItem | FileShareTreeItem>(await ext.tree.showTreeItemPicker([BlobContainerTreeItem.contextValue, FileShareTreeItem.contextValue], actionContext));
    destinationDirectory = await getDestinationDirectory(destinationDirectory);

    if (!calledFromUploadToAzureStorage && !(await shouldUploadUri(treeItem, uri, { choice: undefined }, destinationDirectory))) {
        // Don't upload this folder
        return [];
    }

    const sourcePath: string = uri.fsPath;
    const destPath: string = convertLocalPathToRemotePath(sourcePath, destinationDirectory);

    try {
        if (notificationProgress && cancellationToken) {
            // AzCopy recognizes folders as a resource when uploading to file shares. So only set `countFoldersAsResources=true` in that case
            await uploadLocalFolder(actionContext, treeItem, sourcePath, destPath, notificationProgress, cancellationToken, destPath, treeItem instanceof FileShareTreeItem);
        } else {
            const title: string = getUploadingMessageWithSource(sourcePath, treeItem.label);
            await vscode.window.withProgress({ cancellable: true, location: vscode.ProgressLocation.Notification, title }, async (newNotificationProgress, newCancellationToken) => {
                await uploadLocalFolder(actionContext, nonNullValue(treeItem), sourcePath, nonNullValue(destPath), newNotificationProgress, newCancellationToken, destPath, treeItem instanceof FileShareTreeItem);
            });
        }
    } catch (error) {
        const parsedError: IParsedError = parseError(error);
        if (calledFromUploadToAzureStorage && isAzCopyError(parsedError)) {
            // `uploadToAzureStorage` will deal with this error
            return [parsedError];
        } else {
            throw error;
        }
    }

    await ext.tree.refresh(treeItem);
    return [];
}
