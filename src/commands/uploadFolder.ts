/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IActionContext } from 'vscode-azureextensionui';
import { NotificationProgress } from '../constants';
import { ext } from '../extensionVariables';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { FileShareTreeItem } from '../tree/fileShare/FileShareTreeItem';
import { getRemoteResourceName, getUploadingMessageWithSource, upload, uploadLocalFolder } from '../utils/uploadUtils';

export async function uploadFolder(
    actionContext: IActionContext,
    treeItem?: BlobContainerTreeItem | FileShareTreeItem,
    uri?: vscode.Uri,
    destPath?: string,
    notificationProgress?: NotificationProgress,
    cancellationToken?: vscode.CancellationToken,
): Promise<void> {
    // tslint:disable: strict-boolean-expressions
    uri = uri || (await ext.ui.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri : undefined,
        openLabel: upload
    }))[0];

    treeItem = treeItem || <BlobContainerTreeItem | FileShareTreeItem>(await ext.tree.showTreeItemPicker([BlobContainerTreeItem.contextValue, FileShareTreeItem.contextValue], actionContext));
    destPath = destPath || await getRemoteResourceName(treeItem, uri, { choice: undefined });
    const sourcePath: string = uri.fsPath;

    if (notificationProgress && cancellationToken) {
        // AzCopy recognizes folders as a resource when uploading to file shares. So only set `countFoldersAsResources=true` in that case
        await uploadLocalFolder(actionContext, treeItem, sourcePath, destPath, notificationProgress, cancellationToken, destPath, treeItem instanceof FileShareTreeItem);
    } else {
        const title: string = getUploadingMessageWithSource(sourcePath, treeItem.label);
        await vscode.window.withProgress({ cancellable: true, location: vscode.ProgressLocation.Notification, title }, async (newNotificationProgress, newCancellationToken) => {
            // tslint:disable-next-line:no-non-null-assertion
            await uploadLocalFolder(actionContext, treeItem!, sourcePath, destPath!, newNotificationProgress, newCancellationToken, destPath, treeItem instanceof FileShareTreeItem);
        });
    }
}
