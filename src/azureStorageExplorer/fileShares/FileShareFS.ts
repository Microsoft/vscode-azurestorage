/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import * as path from 'path';
import * as vscode from 'vscode';
import { callWithTelemetryAndErrorHandling } from "vscode-azureextensionui";
import { findRoot, parseUri } from "../fsp";
import { DirectoryTreeItem } from './directoryNode';
import { FileTreeItem } from "./fileNode";
import { FileShareGroupTreeItem } from './fileShareGroupNode';
import { FileShareTreeItem } from "./fileShareNode";
import { createFile } from "./fileUtils";

export type EntryTreeItem = FileShareGroupTreeItem | FileShareTreeItem | FileTreeItem | DirectoryTreeItem;

export class FileShareFS implements vscode.FileSystemProvider {

    private fileShareString: string = 'File Shares';
    private _rootMap: Map<string, FileShareTreeItem | FileShareGroupTreeItem> = new Map<string, FileShareTreeItem | FileShareGroupTreeItem>();

    // tslint:disable-next-line: typedef
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat | Thenable<vscode.FileStat>> {
        let treeItem: EntryTreeItem = await this.lookup(uri);

        if (treeItem instanceof DirectoryTreeItem || treeItem instanceof FileShareTreeItem || treeItem instanceof FileShareGroupTreeItem) {
            // creation and modification times as well as size of tree item are intentionally set to 0 for now
            return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        } else if (treeItem instanceof FileTreeItem) {
            // creation and modification times as well as size of tree item are intentionally set to 0 for now
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 };
        }

        throw vscode.FileSystemError.FileNotFound(uri);
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        return <[string, vscode.FileType][]>await callWithTelemetryAndErrorHandling('fs.lookup', async (context) => {
            context.errorHandling.rethrow = true;

            let entry: DirectoryTreeItem | FileShareTreeItem | FileShareGroupTreeItem = await this.lookupAsDirectory(uri);

            if (entry instanceof FileShareGroupTreeItem) {
                throw new Error('Cannot view multiple file shares simultaneously.');
            }

            // Intentionally passing undefined for token - only supports listing first batch of files for now
            // tslint:disable-next-line:no-non-null-assertion // currentToken argument typed incorrectly in SDK
            let listFilesandDirectoryResult = await entry.listFiles(<azureStorage.common.ContinuationToken>undefined!);
            let entries = listFilesandDirectoryResult.entries;

            let result: [string, vscode.FileType][] = [];
            for (const directory of entries.directories) {
                result.push([directory.name, vscode.FileType.Directory]);
            }
            for (const file of entries.files) {
                result.push([file.name, vscode.FileType.File]);
            }

            return result;
        });
    }

    createDirectory(_uri: vscode.Uri): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        let treeItem: FileTreeItem = await this.lookupAsFile(uri);

        let fileService = treeItem.root.createFileService();

        const result = await new Promise<string | undefined>((resolve, reject) => {
            fileService.getFileToText(treeItem.share.name, treeItem.directoryPath, treeItem.file.name, (error?: Error, text?: string) => {
                if (!!error) {
                    reject(error);
                } else {
                    resolve(text);
                }
            });
        });

        // tslint:disable-next-line: strict-boolean-expressions
        return Buffer.from(result || '');
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
        if (!options.create && !options.overwrite) {
            throw vscode.FileSystemError.NoPermissions(uri);
        }

        let dirUri = vscode.Uri.file(path.dirname(uri.path));
        let dirTreeItem: DirectoryTreeItem | FileShareTreeItem | FileShareGroupTreeItem = await this.lookupAsDirectory(dirUri);

        if (dirTreeItem instanceof FileShareGroupTreeItem) {
            throw new Error('Cannot write or create a File Share.');
        }

        const parentPath: string = dirTreeItem instanceof DirectoryTreeItem ? path.join(dirTreeItem.parentPath, dirTreeItem.directory.name) : '';
        let dir = <DirectoryTreeItem | FileShareTreeItem>dirTreeItem;
        let fileResultChild = await new Promise<azureStorage.FileService.FileResult>((resolve, reject) => {
            const fileService = dir.root.createFileService();
            fileService.doesFileExist(dir.share.name, parentPath, path.basename(uri.path), (error?: Error, result?: azureStorage.FileService.FileResult) => {
                if (!!error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });

        if (!fileResultChild.exists && !options.create) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        if (fileResultChild.exists && !options.overwrite) {
            throw vscode.FileSystemError.FileExists(uri);
        }

        if (!fileResultChild.exists && options.create) {
            const fileName: string = path.basename(uri.path);
            fileResultChild = await createFile(parentPath, fileName, dirTreeItem.share, dirTreeItem.root);
        }

        if (options.overwrite) {
            let fileTreeItem: FileTreeItem = new FileTreeItem(dirTreeItem, fileResultChild, parentPath, <azureStorage.FileService.ShareResult>dirTreeItem.share);
            await this.updateFileContent(fileTreeItem, content);
        }
    }

    private async updateFileContent(fileTreeItem: FileTreeItem, content: Uint8Array): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const fileService = fileTreeItem.root.createFileService();
            fileService.createFileFromText(fileTreeItem.share.name, fileTreeItem.directoryPath, fileTreeItem.file.name, content.toString(), (error?: Error) => {
                if (!!error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    // tslint:disable-next-line: no-reserved-keywords
    async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
        await callWithTelemetryAndErrorHandling('fs.delete', async (context) => {
            context.errorHandling.rethrow = true;

            if (!options.recursive) {
                throw new Error("Azure storage does not support nonrecursive deletion of folders.");
            }

            let fileFound: EntryTreeItem = await this.lookup(uri);

            if (fileFound instanceof FileTreeItem || fileFound instanceof DirectoryTreeItem) {
                await fileFound.deleteTreeItem(context);
            } else {
                throw new RangeError("Tried to delete a FileShare or the folder of FileShares.");
            }
        });
    }

    rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean; }): void {
        throw new Error("Method not implemented.");
    }

    private async lookupAsFile(uri: vscode.Uri): Promise<FileTreeItem> {
        let entry = await this.lookup(uri);
        if (entry instanceof FileTreeItem) {
            return entry;
        }
        throw vscode.FileSystemError.FileNotFound(uri);
    }

    private async lookupAsDirectory(uri: vscode.Uri): Promise<DirectoryTreeItem | FileShareTreeItem | FileShareGroupTreeItem> {
        let entry = await this.lookup(uri);
        if (entry instanceof DirectoryTreeItem || entry instanceof FileShareTreeItem || entry instanceof FileShareGroupTreeItem) {
            return entry;
        }
        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    private async lookup(uri: vscode.Uri): Promise<EntryTreeItem> {
        return <EntryTreeItem>await callWithTelemetryAndErrorHandling('fs.lookup', async (context) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;

            let parsedUri = parseUri(uri, this.fileShareString);
            let parts = path.join(parsedUri.groupTreeItemName, parsedUri.parentPath, parsedUri.baseName).split('/');
            const foundRoot = this._rootMap.get(path.join(parsedUri.rootPath, parsedUri.groupTreeItemName));
            let entry: EntryTreeItem = !!foundRoot ? foundRoot : await this.updateRootMap(uri);

            if (`${parsedUri.parentPath}${parsedUri.baseName}` === '') {
                return entry;
            }

            if (entry instanceof FileShareGroupTreeItem) {
                throw new RangeError('Looking into nonexistent File Share.');
            }

            let parentPath = '';
            for (let part of parts.slice(1)) {
                if (entry instanceof FileShareTreeItem || entry instanceof DirectoryTreeItem) {
                    // Intentionally passing undefined for token - only supports listing first batch of files for now
                    // tslint:disable-next-line:no-non-null-assertion // currentToken argument typed incorrectly in SDK
                    let listFilesAndDirectoriesResult: azureStorage.FileService.ListFilesAndDirectoriesResult = await entry.listFiles(<azureStorage.common.ContinuationToken>undefined!);
                    let entries = listFilesAndDirectoriesResult.entries;

                    let directoryResultChild = entries.directories.find(element => element.name === part);
                    if (!!directoryResultChild) {
                        entry = new DirectoryTreeItem(entry, parentPath, directoryResultChild, <azureStorage.FileService.ShareResult>entry.share);
                        parentPath = path.join(parentPath, part);
                    } else {
                        let fileResultChild = entries.files.find(element => element.name === part);
                        if (!!fileResultChild) {
                            entry = new FileTreeItem(entry, fileResultChild, parentPath, <azureStorage.FileService.ShareResult>entry.share);
                        } else {
                            throw vscode.FileSystemError.FileNotFound(uri);
                        }
                    }
                } else {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
            }

            return entry;
        });
    }

    private async updateRootMap(uri: vscode.Uri): Promise<FileShareTreeItem | FileShareGroupTreeItem> {
        let root = await findRoot(uri, this.fileShareString);
        let parsedUri = parseUri(uri, this.fileShareString);

        if (root instanceof FileShareGroupTreeItem) {
            this._rootMap.set(path.join(parsedUri.rootPath, parsedUri.groupTreeItemName), <FileShareGroupTreeItem>root);
            return <FileShareGroupTreeItem>root;
        } else if (root instanceof FileShareTreeItem) {
            this._rootMap.set(path.join(parsedUri.rootPath, parsedUri.groupTreeItemName), <FileShareTreeItem>root);
            return <FileShareTreeItem>root;
        } else {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }
}
