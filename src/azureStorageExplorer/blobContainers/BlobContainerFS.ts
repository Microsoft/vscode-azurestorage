/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import * as mime from "mime";
import * as path from 'path';
import * as vscode from 'vscode';
import { callWithTelemetryAndErrorHandling, IActionContext } from "vscode-azureextensionui";
import { findRoot } from "../findRoot";
import { IParsedUri, parseUri } from "../parseUri";
import { BlobContainerTreeItem } from './blobContainerNode';
import { BlobDirectoryTreeItem } from "./BlobDirectoryTreeItem";
import { BlobTreeItem } from './blobNode';

export type EntryTreeItem = BlobTreeItem | BlobDirectoryTreeItem | BlobContainerTreeItem;

export class BlobContainerFS implements vscode.FileSystemProvider {
    private _blobContainerString: string = 'Blob Containers';
    private _virtualDirCreatedUri: Set<string> = new Set();

    private _emitter: vscode.EventEmitter<vscode.FileChangeEvent[]> = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    private _configUri: string[] = ['pom.xml', 'node_modules', '.vscode', '.vscode/settings.json', '.vscode/tasks.json', '.vscode/launch.json', '.git/config'];
    private _configRootNames: string[] = ['pom.xml', 'node_modules', '.git', '.vscode'];

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        return <vscode.FileStat>await callWithTelemetryAndErrorHandling('blob.stat', async (context) => {
            if (this._virtualDirCreatedUri.has(uri.path)) {
                return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
            }

            let entry: EntryTreeItem = await this.lookup(context, uri);

            if (entry instanceof BlobDirectoryTreeItem || entry instanceof BlobContainerTreeItem) {
                // creation and modification times as well as size of tree item are intentionally set to 0 for now
                return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
            } else if (entry instanceof BlobTreeItem) {
                // creation and modification times as well as size of tree item are intentionally set to 0 for now
                return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 };
            }

            throw vscode.FileSystemError.FileNotFound(uri);
        });
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        return <[string, vscode.FileType][]>await callWithTelemetryAndErrorHandling('blob.readDirectory', async (context) => {
            let root: BlobContainerTreeItem = await this.getRoot(context, uri);
            let parsedUri = parseUri(uri, this._blobContainerString);

            const blobService = root.root.createBlobService();
            const listBlobResult = await this.listAllChildBlob(blobService, parsedUri.rootName, parsedUri.dirPath);
            const listDirectoryResult = await this.listAllChildDirectory(blobService, parsedUri.rootName, parsedUri.dirPath);

            let directoryChildren: [string, vscode.FileType][] = [];
            listBlobResult.entries.forEach(value => directoryChildren.push([path.basename(value.name), vscode.FileType.File]));
            listDirectoryResult.entries.forEach(value => directoryChildren.push([path.basename(value.name), vscode.FileType.Directory]));

            for (let dirCreated of this._virtualDirCreatedUri) {
                let dirCreatedParsedUri = parseUri(dirCreated, this._blobContainerString);

                let parentPath = path.posix.join(dirCreatedParsedUri.rootPath, dirCreatedParsedUri.parentDirPath);
                if (parentPath.endsWith("/")) {
                    parentPath = parentPath.substring(0, parentPath.length - 1);
                }

                if (uri.path === parentPath) {
                    directoryChildren.push([dirCreatedParsedUri.baseName, vscode.FileType.Directory]);
                }
            }

            return directoryChildren;
        });
    }

    createDirectory(uri: vscode.Uri): void {
        this._virtualDirCreatedUri.add(uri.path);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return <Uint8Array>await callWithTelemetryAndErrorHandling('blob.readFile', async (context) => {
            context.errorHandling.rethrow = true;

            let root: BlobContainerTreeItem = await this.getRoot(context, uri);
            let parsedUri = parseUri(uri, this._blobContainerString);

            let blobService: azureStorage.BlobService = root.root.createBlobService();
            let result = await new Promise<string | undefined>((resolve, reject) => {
                blobService.getBlobToText(parsedUri.rootName, parsedUri.filePath, (error?: Error, text?: string) => {
                    if (!!error) {
                        reject(error);
                    } else {
                        resolve(text);
                    }
                });
            });

            // tslint:disable-next-line: strict-boolean-expressions
            return Buffer.from(result || '');
        });
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
        await callWithTelemetryAndErrorHandling('blob.writeFile', async (context) => {
            if (!options.create && !options.overwrite) {
                throw vscode.FileSystemError.NoPermissions(uri);
            }

            let root: BlobContainerTreeItem = await this.getRoot(context, uri);
            let parsedUri = parseUri(uri, this._blobContainerString);

            const blobService = root.root.createBlobService();
            let blobResultChild = await new Promise<azureStorage.BlobService.BlobResult>((resolve, reject) => {
                blobService.doesBlobExist(parsedUri.rootName, parsedUri.filePath, (error?: Error, result?: azureStorage.BlobService.BlobResult) => {
                    if (!!error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                });
            });

            if (!blobResultChild.exists && !options.create) {
                throw vscode.FileSystemError.FileNotFound(uri);
            } else if (blobResultChild.exists && !options.overwrite) {
                throw vscode.FileSystemError.FileExists(uri);
            } else {
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress) => {
                    if (blobResultChild.exists) {
                        progress.report({ message: `Saving blob ${parsedUri.filePath}` });
                    } else {
                        progress.report({ message: `Creating blob ${parsedUri.filePath}` });
                    }

                    await new Promise<void>((resolve, reject) => {
                        let contentType: string | null = mime.getType(parsedUri.filePath);
                        let temp: string | undefined = contentType === null ? undefined : contentType;
                        blobService.createBlockBlobFromText(parsedUri.rootName, parsedUri.filePath, content.toString(), { contentSettings: { contentType: temp } }, (error?: Error) => {
                            if (!!error) {
                                reject(error);
                            } else {
                                resolve();
                            }
                        });
                    });
                });

                let parentDirPath = parsedUri.parentDirPath;
                while (parentDirPath) {
                    if (parentDirPath.endsWith("/")) {
                        parentDirPath = parentDirPath.substring(0, parentDirPath.length - 1);
                    }

                    let fullPath: string = path.posix.join(parsedUri.rootPath, parentDirPath);
                    if (this._virtualDirCreatedUri.has(fullPath)) {
                        this._virtualDirCreatedUri.delete(fullPath);
                    } else {
                        return;
                    }

                    parentDirPath = parentDirPath.substring(0, parentDirPath.lastIndexOf('/'));
                }
            }
        });
    }

    // tslint:disable-next-line: no-reserved-keywords
    async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
        return await callWithTelemetryAndErrorHandling('blob.delete', async (context) => {
            context.errorHandling.rethrow = true;
            if (!options.recursive) {
                throw new Error('Do not support non recursive deletion of folders or files.');
            }

            let parsedUri = parseUri(uri, this._blobContainerString);
            try {
                let entry: EntryTreeItem = await this.lookup(context, uri);
                const blobService = entry.root.createBlobService();
                if (entry instanceof BlobTreeItem) {
                    await this.deleteBlob(parsedUri.rootName, parsedUri.filePath, blobService);
                } else if (entry instanceof BlobDirectoryTreeItem) {
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress) => {
                        progress.report({ message: `Deleting directory ${parsedUri.filePath}` });
                        await this.deleteFolder(parsedUri, blobService);
                    });
                } else if (entry instanceof BlobContainerTreeItem) {
                    throw new Error('Cannot delete a Blob Container.');
                }
            } catch (err) {
                this._virtualDirCreatedUri.forEach(value => {
                    if (value.startsWith(uri.path)) {
                        this._virtualDirCreatedUri.delete(value);
                    }
                });
            }
        });
    }

    private async deleteFolder(parsedUri: IParsedUri, blobService: azureStorage.BlobService): Promise<void> {
        let dirPaths: string[] = [];
        let dirPath: string | undefined = parsedUri.dirPath;
        while (dirPath) {
            let childBlob = await this.listAllChildBlob(blobService, parsedUri.rootName, dirPath);
            for (const blob of childBlob.entries) {
                await this.deleteBlob(parsedUri.rootName, blob.name, blobService);
            }

            let childDir = await this.listAllChildDirectory(blobService, parsedUri.rootName, dirPath);
            for (const dir of childDir.entries) {
                dirPaths.push(dir.name);
            }

            dirPath = dirPaths.pop();
        }
    }

    private async deleteBlob(containerName: string, prefix: string, blobService: azureStorage.BlobService): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            blobService.deleteBlob(containerName, prefix, (error?: Error) => {
                if (!!error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean; }): void | Thenable<void> {
        throw new Error('Renaming/moving folders or files not supported.');
    }

    private async lookup(context: IActionContext, uri: vscode.Uri): Promise<EntryTreeItem> {
        context.errorHandling.rethrow = true;

        let parsedUri = parseUri(uri, this._blobContainerString);

        if (this._configUri.includes(parsedUri.filePath) || this._configRootNames.includes(parsedUri.rootName)) {
            context.errorHandling.suppressDisplay = true;
        }

        let entry = await this.getRoot(context, uri);
        if (parsedUri.filePath === '') {
            return entry;
        }

        let blobService = entry.root.createBlobService();

        const listBlobDirectoryResult = await this.listAllChildDirectory(blobService, parsedUri.rootName, parsedUri.parentDirPath);
        const directoryResultChild = listBlobDirectoryResult.entries.find(element => element.name === parsedUri.dirPath);
        if (!!directoryResultChild) {
            return new BlobDirectoryTreeItem(entry.root, parsedUri.baseName, parsedUri.parentDirPath, entry.container);
        } else {
            const listBlobResult = await this.listAllChildBlob(blobService, parsedUri.rootName, parsedUri.parentDirPath);
            const blobResultChild = listBlobResult.entries.find(element => element.name === parsedUri.filePath);
            if (!!blobResultChild) {
                return new BlobTreeItem(entry, blobResultChild, entry.container);
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    private async getRoot(context: IActionContext, uri: vscode.Uri): Promise<BlobContainerTreeItem> {
        let root = await findRoot(context, uri, this._blobContainerString);
        if (root instanceof BlobContainerTreeItem) {
            return root;
        } else {
            throw new Error('The root found must be a BlobContainerTreeItem.');
        }
    }

    private async listAllChildDirectory(blobService: azureStorage.BlobService, blobContainerName: string, prefix: string): Promise<azureStorage.BlobService.ListBlobDirectoriesResult> {
        return await new Promise<azureStorage.BlobService.ListBlobDirectoriesResult>((resolve, reject) => {
            // Intentionally passing undefined for token - only supports listing first batch of files for now
            // tslint:disable-next-line: no-non-null-assertion
            blobService.listBlobDirectoriesSegmentedWithPrefix(blobContainerName, prefix, <azureStorage.common.ContinuationToken>undefined!, (error?: Error, result?: azureStorage.BlobService.ListBlobDirectoriesResult) => {
                if (!!error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    }

    private async listAllChildBlob(blobService: azureStorage.BlobService, blobContainerName: string, prefix: string): Promise<azureStorage.BlobService.ListBlobsResult> {
        return await new Promise<azureStorage.BlobService.ListBlobsResult>((resolve, reject) => {
            // Intentionally passing undefined for token - only supports listing first batch of files for now
            // tslint:disable-next-line: no-non-null-assertion
            let options = { delimiter: '/' };
            // tslint:disable-next-line: no-non-null-assertion
            blobService.listBlobsSegmentedWithPrefix(blobContainerName, prefix, <azureStorage.common.ContinuationToken>undefined!, options, (error?: Error, result?: azureStorage.BlobService.ListBlobsResult) => {
                if (!!error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    }
}
