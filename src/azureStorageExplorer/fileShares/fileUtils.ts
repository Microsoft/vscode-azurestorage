/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import { FileService } from "azure-storage";
import { ProgressLocation, window } from "vscode";
import { AzureParentTreeItem, UserCancelledError } from "vscode-azureextensionui";
import { IStorageRoot } from "../IStorageRoot";
import { FileTreeItem } from "./fileNode";
import { validateFileName } from "./validateNames";

// Currently only supports creating block blobs
export async function askAndCreateEmptyTextFile(parent: AzureParentTreeItem<IStorageRoot>, directoryPath: string, share: FileService.ShareResult, showCreatingTreeItem: (label: string) => void): Promise<FileTreeItem> {
    const fileName = await window.showInputBox({
        placeHolder: 'Enter a name for the new file',
        validateInput: validateFileName
    });

    if (fileName) {
        return await window.withProgress({ location: ProgressLocation.Window }, async (progress) => {
            showCreatingTreeItem(fileName);
            progress.report({ message: `Azure Storage: Creating file '${fileName}'` });
            const file = await createFile(directoryPath, fileName, share, parent.root);
            const actualFile = await getFile(directoryPath, file.name, share, parent.root);
            return new FileTreeItem(parent, actualFile, directoryPath, share);
        });
    }

    throw new UserCancelledError();
}

// tslint:disable-next-line:promise-function-async // Grandfathered in
function getFile(directoryPath: string, name: string, share: FileService.ShareResult, root: IStorageRoot): Promise<azureStorage.FileService.FileResult> {
    const fileService = root.createFileService();
    return new Promise((resolve, reject) => {
        fileService.getFileProperties(share.name, directoryPath, name, (err?: Error, result?: azureStorage.FileService.FileResult) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

// tslint:disable-next-line:promise-function-async // Grandfathered in
function createFile(directoryPath: string, name: string, share: FileService.ShareResult, root: IStorageRoot): Promise<azureStorage.FileService.FileResult> {
    return new Promise((resolve, reject) => {
        const fileService = root.createFileService();
        fileService.createFile(share.name, directoryPath, name, 0, (err?: Error, result?: azureStorage.FileService.FileResult) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

export async function deleteFile(directory: string, name: string, share: string, root: IStorageRoot): Promise<void> {
    const fileService = root.createFileService();
    await new Promise((resolve, reject) => {
        // tslint:disable-next-line:no-any
        fileService.deleteFile(share, directory, name, (err?: any) => {
            // tslint:disable-next-line:no-void-expression // Grandfathered in
            err ? reject(err) : resolve();
        });
    });
}
