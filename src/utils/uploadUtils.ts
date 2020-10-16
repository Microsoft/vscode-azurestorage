/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FromToOption, ILocalLocation, IRemoteSasLocation } from '@azure-tools/azcopy-node';
import { basename, dirname, posix } from 'path';
import * as readdirp from 'readdirp';
import * as vscode from 'vscode';
import { DialogResponses, IActionContext } from "vscode-azureextensionui";
import { createAzCopyLocalLocation, createAzCopyRemoteLocation } from '../commands/azCopy/azCopyLocations';
import { azCopyTransfer } from '../commands/azCopy/azCopyTransfer';
import { NotificationProgress } from '../constants';
import { ext } from '../extensionVariables';
import { TransferProgress } from '../TransferProgress';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { FileShareTreeItem } from '../tree/fileShare/FileShareTreeItem';
import { doesBlobDirectoryExist, doesBlobExist } from './blobUtils';
import { doesDirectoryExist } from './directoryUtils';
import { doesFileExist } from './fileUtils';
import { localize } from './localize';

export const upload: string = localize('upload', 'Upload');

export enum OverwriteChoice {
    yesToAll,
    yes,
    noToAll,
    no
}

export async function uploadLocalFolder(
    context: IActionContext,
    destTreeItem: BlobContainerTreeItem | FileShareTreeItem,
    sourcePath: string,
    destPath: string,
    notificationProgress: NotificationProgress,
    cancellationToken: vscode.CancellationToken,
    messagePrefix?: string,
    countFoldersAsResources?: boolean,
): Promise<void> {
    const fromTo: FromToOption = destTreeItem instanceof BlobContainerTreeItem ? 'LocalBlob' : 'LocalFile';
    const src: ILocalLocation = createAzCopyLocalLocation(sourcePath, true);
    const dst: IRemoteSasLocation = createAzCopyRemoteLocation(destTreeItem, destPath);
    const totalWork: number = await getNumResourcesInDirectory(sourcePath, countFoldersAsResources);
    const transferProgress: TransferProgress = new TransferProgress('files', totalWork, messagePrefix);
    ext.outputChannel.appendLog(getUploadingMessageWithSource(sourcePath, destTreeItem.label));
    await azCopyTransfer(context, fromTo, src, dst, transferProgress, notificationProgress, cancellationToken);
}

export function getUploadingMessage(treeItemLabel: string): string {
    return localize('uploadingTo', 'Uploading to "{0}"...', treeItemLabel);
}

export function getUploadingMessageWithSource(sourcePath: string, treeItemLabel: string): string {
    return localize('uploadingFromTo', 'Uploading from "{0}" to "{1}"', sourcePath, treeItemLabel);
}

async function showDuplicateResourceWarning(resourceName: string): Promise<OverwriteChoice> {
    const message: string = localize('resourceExists', 'A resource named "{0}" already exists. Do you want to upload and overwrite it?', resourceName);
    const items = [
        { title: localize('yesToAll', 'Yes to all'), data: OverwriteChoice.yesToAll },
        { title: DialogResponses.yes.title, data: OverwriteChoice.yes },
        { title: localize('noToAll', 'No to all'), data: OverwriteChoice.noToAll },
        { title: DialogResponses.no.title, data: OverwriteChoice.no }
    ];
    return (await ext.ui.showWarningMessage(message, { modal: true }, ...items)).data;
}

// Pass `overwriteChoice` as an object to make use of pass by reference.
export async function checkCanOverwrite(
    destPath: string,
    overwriteChoice: { choice: OverwriteChoice | undefined },
    destPathExists: () => Promise<boolean>
): Promise<boolean> {
    if (overwriteChoice.choice === OverwriteChoice.yesToAll) {
        // Always overwrite
        return true;
    }

    if (await destPathExists()) {
        if (overwriteChoice.choice === OverwriteChoice.noToAll) {
            // Resources that already exist shouldn't be overwritten
            return false;
        } else {
            overwriteChoice.choice = await showDuplicateResourceWarning(destPath);
            switch (overwriteChoice.choice) {
                case OverwriteChoice.no:
                case OverwriteChoice.noToAll:
                    return false;

                case OverwriteChoice.yes:
                case OverwriteChoice.yesToAll:
                default:
                    return true;
            }
        }
    } else {
        // This resource doesn't exist yet, so overwriting is OK
        return true;
    }
}

export async function checkCanUpload(
    destPath: string,
    overwriteChoice: { choice: OverwriteChoice | undefined },
    treeItem: BlobContainerTreeItem | FileShareTreeItem
): Promise<boolean> {
    return await checkCanOverwrite(destPath, overwriteChoice, async () => {
        if (treeItem instanceof BlobContainerTreeItem) {
            return await doesBlobExist(treeItem, destPath) || await doesBlobDirectoryExist(treeItem, destPath);
        } else {
            return await doesFileExist(basename(destPath), treeItem, dirname(destPath), treeItem.shareName) || await doesDirectoryExist(treeItem, destPath, treeItem.shareName);
        }
    });
}

export function convertLocalPathToRemotePath(localPath: string, destinationDirectory: string): string {
    let path: string = posix.join(destinationDirectory, basename(localPath));
    if (path.startsWith(posix.sep)) {
        // `BlobClient` and `ShareFileClient` treat resource paths that start with "/" differently from those that don't. So remove the leading "/".
        // This check is done after `posix.join()` because that function removes any duplicate slashes from the beginning of the path.
        path = path.substr(1);
    }
    return path;
}

export async function promptForDestinationDirectory(): Promise<string> {
    return await ext.ui.showInputBox({
        value: posix.sep,
        prompt: localize('destinationDirectory', 'Enter the destination directory for this upload.'),
    });
}

export async function getDestinationDirectory(destinationDirectory?: string): Promise<string> {
    return destinationDirectory !== undefined ? destinationDirectory : await promptForDestinationDirectory();
}

async function getNumResourcesInDirectory(directoryPath: string, countFolders?: boolean): Promise<number> {
    const options: readdirp.ReaddirpOptions = {
        directoryFilter: ['!.git', '!.vscode'],
        type: countFolders ? 'files_directories' : 'files'
    };
    const resources: readdirp.EntryInfo[] = await readdirp.promise(directoryPath, options);
    return resources.length;
}
