/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FromToOption, ILocalLocation, IRemoteSasLocation } from '@azure-tools/azcopy-node';
import { basename } from 'path';
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
    const transferProgress: TransferProgress = new TransferProgress(totalWork, messagePrefix, 'files');
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
export async function shouldUploadUri(treeItem: BlobContainerTreeItem | FileShareTreeItem, uri: vscode.Uri, overwriteChoice: { choice: OverwriteChoice | undefined }): Promise<boolean> {
    if (overwriteChoice.choice === OverwriteChoice.yesToAll) {
        // Always upload
        return true;
    }

    const localResourcePath: string = uri.fsPath;
    const remoteResourceName: string = convertLocalPathToRemotePath(localResourcePath);
    let resourceExists: boolean;
    if (treeItem instanceof BlobContainerTreeItem) {
        resourceExists = await doesBlobExist(treeItem, remoteResourceName) || await doesBlobDirectoryExist(treeItem, remoteResourceName);
    } else {
        resourceExists = await doesFileExist(remoteResourceName, treeItem, '', treeItem.shareName) || await doesDirectoryExist(treeItem, remoteResourceName, treeItem.shareName);
    }

    if (resourceExists) {
        if (overwriteChoice.choice === OverwriteChoice.noToAll) {
            // Resources that already exist shouldn't be uploaded
            return false;
        } else {
            overwriteChoice.choice = await showDuplicateResourceWarning(remoteResourceName);
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
        // This resource doesn't exist, so upload
        return true;
    }
}

export function convertLocalPathToRemotePath(localPath: string): string {
    return basename(localPath);
}

async function getNumResourcesInDirectory(directoryPath: string, countFolders?: boolean): Promise<number> {
    const options: readdirp.ReaddirpOptions = {
        directoryFilter: ['!.git', '!.vscode'],
        type: countFolders ? 'files_directories' : 'files'
    };
    const resources: readdirp.EntryInfo[] = await readdirp.promise(directoryPath, options);
    return resources.length;
}
