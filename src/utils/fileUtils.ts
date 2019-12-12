/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import { FileService } from "azure-storage";
import { ProgressLocation, window } from "vscode";
import { AzureParentTreeItem, ICreateChildImplContext, UserCancelledError } from "vscode-azureextensionui";
import { ext } from "../extensionVariables";
import { IFileShareCreateChildContext } from "../tree/fileShare/FileShareTreeItem";
import { FileTreeItem } from "../tree/fileShare/FileTreeItem";
import { IStorageRoot } from "../tree/IStorageRoot";
import { validateFileName } from "./validateNames";

// Currently only supports creating block blobs
export async function askAndCreateEmptyTextFile(parent: AzureParentTreeItem<IStorageRoot>, directoryPath: string, share: FileService.ShareResult, context: ICreateChildImplContext & IFileShareCreateChildContext): Promise<FileTreeItem> {
    let fileName = context.childName || await ext.ui.showInputBox({
        placeHolder: 'Enter a name for the new file',
        validateInput: async (name: string) => {
            let nameError = validateFileName(name);
            if (nameError) {
                return nameError;
            } else if (await doesFileExist(name, parent, directoryPath, share)) {
                return "A file with this path and name already exists";
            }
            return undefined;
        }
    });

    if (fileName) {
        return await window.withProgress({ location: ProgressLocation.Window }, async (progress) => {
            context.showCreatingTreeItem(fileName);
            progress.report({ message: `Azure Storage: Creating file '${fileName}'` });
            const file = await createFile(directoryPath, fileName, share, parent.root);
            const actualFile = await getFile(directoryPath, file.name, share, parent.root);
            return new FileTreeItem(parent, actualFile, directoryPath, share);
        });
    }

    throw new UserCancelledError();
}

export async function doesFileExist(fileName: string, parent: AzureParentTreeItem<IStorageRoot>, directoryPath: string, share: FileService.ShareResult): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        const fileService = parent.root.createFileService();
        fileService.doesFileExist(share.name, directoryPath, fileName, (err?: Error, result?: FileService.FileResult) => {
            if (err) {
                reject(err);
            } else {
                resolve(result && result.exists === true);
            }
        });
    });

}

export async function getFile(directoryPath: string, name: string, share: FileService.ShareResult, root: IStorageRoot): Promise<azureStorage.FileService.FileResult> {
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

export async function createFile(directoryPath: string, name: string, share: FileService.ShareResult, root: IStorageRoot, text?: string | Buffer, options?: azureStorage.FileService.CreateFileRequestOptions): Promise<azureStorage.FileService.FileResult> {
    return new Promise((resolve, reject) => {
        const fileService = root.createFileService();
        fileService.createFileFromText(share.name, directoryPath, name, text ? text : '', options ? options : {}, (err?: Error, result?: azureStorage.FileService.FileResult) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

export async function createFileFromLocalFile(directoryPath: string, name: string, share: FileService.ShareResult, root: IStorageRoot, filePath: string, options?: azureStorage.FileService.CreateFileRequestOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const fileService = root.createFileService();
        fileService.createFileFromLocalFile(share.name, directoryPath, name, filePath, options ? options : {}, async (err?: Error) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

export async function updateFileFromText(directoryPath: string, name: string, share: FileService.ShareResult, root: IStorageRoot, text: string | Buffer): Promise<azureStorage.FileService.FileResult> {
    const options = await getExistingCreateOptions(directoryPath, name, share, root);
    return await createFile(directoryPath, name, share, root, text, options);
}

export async function updateFileFromLocalFile(directoryPath: string, name: string, share: FileService.ShareResult, root: IStorageRoot, filePath: string): Promise<void> {
    const options = await getExistingCreateOptions(directoryPath, name, share, root);
    await createFileFromLocalFile(directoryPath, name, share, root, filePath, options);
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

async function getExistingCreateOptions(directoryPath: string, name: string, share: FileService.ShareResult, root: IStorageRoot): Promise<azureStorage.FileService.CreateFileRequestOptions> {
    const fileService = root.createFileService();

    const propertiesResult: azureStorage.FileService.FileResult = await new Promise((resolve, reject) => {
        fileService.getFileProperties(share.name, directoryPath, name, (err?: Error, result?: azureStorage.FileService.FileResult) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });

    if (propertiesResult.contentSettings) {
        // Don't allow the existing MD5 hash to be used for the updated file
        propertiesResult.contentSettings.contentMD5 = '';
    }

    const metadataResult: azureStorage.FileService.FileResult = await new Promise((resolve, reject) => {
        fileService.getFileMetadata(share.name, directoryPath, name, (err?: Error, result?: azureStorage.FileService.FileResult) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });

    return {
        contentSettings: propertiesResult.contentSettings,
        metadata: metadataResult.metadata
    };
}
