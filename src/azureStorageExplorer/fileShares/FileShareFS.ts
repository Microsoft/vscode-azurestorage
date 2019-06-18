/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import * as path from 'path';
import * as vscode from 'vscode';
import { callWithTelemetryAndErrorHandling } from "vscode-azureextensionui";
import { ext } from '../../extensionVariables';
import { DirectoryTreeItem } from './directoryNode';
import { FileTreeItem } from "./fileNode";
import { FileShareGroupTreeItem } from './fileShareGroupNode';
import { FileShareTreeItem } from "./fileShareNode";
import { createFile } from "./fileUtils";

export type EntryTreeItem = FileShareGroupTreeItem | FileShareTreeItem | FileTreeItem | DirectoryTreeItem;

class FileStatImpl implements vscode.FileStat {
    // tslint:disable-next-line: no-reserved-keywords
    type: vscode.FileType;
    ctime: number;
    mtime: number;
    size: number;

    constructor(
        // tslint:disable-next-line: no-reserved-keywords
        type: vscode.FileType,
        ctime: number,
        mtime: number,
        size: number
    ) {
        this.type = type;
        this.ctime = ctime;
        this.mtime = mtime;
        this.size = size;
    }
}

export class FileShareFS implements vscode.FileSystemProvider {

    root: EntryTreeItem;

    // tslint:disable-next-line: typedef
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat | Thenable<vscode.FileStat>> {
        let treeItem: EntryTreeItem = await this.lookup(uri);

        if (treeItem instanceof FileTreeItem) {
            // creation and modification times as well as size of tree item are intentionally set to 0 for now
            return new FileStatImpl(vscode.FileType.File, 0, 0, 0);
        } else if (treeItem instanceof DirectoryTreeItem || treeItem instanceof FileShareTreeItem) {
            // creation and modification times as well as size of tree item are intentionally set to 0 for now
            return new FileStatImpl(vscode.FileType.Directory, 0, 0, 0);
        }

        throw vscode.FileSystemError.FileNotFound(uri);
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        let entry: DirectoryTreeItem | FileShareTreeItem = await this.lookupAsDirectory(uri);

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
        let fileTreeItem: FileTreeItem;

        if (options.create) {
            let dirUri = vscode.Uri.file(path.dirname(uri.path));
            let dirTreeItem: FileShareTreeItem | DirectoryTreeItem = await this.lookupAsDirectory(dirUri);

            // tslint:disable-next-line: no-non-null-assertion
            let listFilesAndDirectoriesResult = await dirTreeItem.listFiles(<azureStorage.common.ContinuationToken>undefined!);
            let fileResultChild = listFilesAndDirectoriesResult.entries.files.find(element => element.name === path.basename(uri.path));

            if (fileResultChild) {
                if (!options.overwrite) {
                    throw vscode.FileSystemError.FileExists(uri);
                }
                // tslint:disable-next-line: restrict-plus-operands
                let parentPath: string = dirTreeItem instanceof DirectoryTreeItem ? dirTreeItem.parentPath + dirTreeItem.directory : '';
                fileTreeItem = new FileTreeItem(dirTreeItem, fileResultChild, parentPath, <azureStorage.FileService.ShareResult>dirTreeItem.share);
            } else {
                if (!options.create) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
                fileTreeItem = await this.createFile(uri, dirTreeItem);
                return;
            }
        } else {
            fileTreeItem = await this.lookupAsFile(uri);
        }

        let fileService = fileTreeItem.root.createFileService();
        // tslint:disable-next-line: no-void-expression
        return await new Promise<void>((resolve, reject) => {
            fileService.createFileFromText(fileTreeItem.share.name, fileTreeItem.directoryPath, fileTreeItem.file.name, content.toString(), (error?: Error) => {
                if (!!error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    private async createFile(uri: vscode.Uri, treeItem: EntryTreeItem): Promise<FileTreeItem> {
        let directoryPath: string = '';
        let fileName: string;

        if (treeItem instanceof FileShareGroupTreeItem) {
            throw RangeError("Cannot create a FileShare folder through File Explorer.");
        } else if (treeItem instanceof FileShareTreeItem) {
            fileName = path.basename(uri.path);
        } else if (treeItem instanceof DirectoryTreeItem) {
            directoryPath = treeItem.parentPath + treeItem.directory.name;
            fileName = path.basename(uri.path);
        } else {
            throw vscode.FileSystemError.FileExists;
        }

        const fileResult = await createFile(directoryPath, fileName, treeItem.share, treeItem.root);
        return new FileTreeItem(treeItem, fileResult, directoryPath, <azureStorage.FileService.ShareResult>treeItem.share);
    }

    // tslint:disable-next-line: no-reserved-keywords
    delete(_uri: vscode.Uri, _options: { recursive: boolean; }): void {
        throw new Error("Method not implemented.");
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

    async lookupAsDirectory(uri: vscode.Uri): Promise<DirectoryTreeItem | FileShareTreeItem> {
        let entry = await this.lookup(uri);
        if (entry instanceof DirectoryTreeItem || entry instanceof FileShareTreeItem) {

            return entry;
        }

        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    private async lookup(uri: vscode.Uri): Promise<EntryTreeItem> {
        return <EntryTreeItem>await callWithTelemetryAndErrorHandling('fs.lookup', async (context) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;

            let parentPath = '/';

            let fileShareName = 'File Shares';
            let endOfRootPathIndx = uri.path.indexOf(fileShareName) + fileShareName.length;

            if (this.root === undefined) {
                await this.findRoot(uri);
            }

            let parts = uri.path.substring(endOfRootPathIndx).split('/').slice(1);

            let entry: EntryTreeItem = this.root;

            for (let part of parts) {
                if (entry instanceof FileShareGroupTreeItem) {
                    // Intentionally passing undefined for token - only supports listing first batch of files for now
                    // tslint:disable-next-line:no-non-null-assertion // currentToken argument typed incorrectly in SDK
                    let listShareResult = await entry.listFileShares(<azureStorage.common.ContinuationToken>undefined!);

                    let fileShareResultChild = listShareResult.entries.find(element => element.name === part);

                    if (fileShareResultChild) {
                        entry = new FileShareTreeItem(entry, fileShareResultChild);
                    }
                } else if (entry instanceof FileShareTreeItem || entry instanceof DirectoryTreeItem) {
                    // Intentionally passing undefined for token - only supports listing first batch of files for now
                    // tslint:disable-next-line:no-non-null-assertion // currentToken argument typed incorrectly in SDK
                    let listFilesAndDirectoriesResult = await entry.listFiles(<azureStorage.common.ContinuationToken>undefined!);

                    let entries = listFilesAndDirectoriesResult.entries;

                    let directoryResultChild = entries.directories.find(element => element.name === part);
                    if (directoryResultChild) {
                        entry = new DirectoryTreeItem(entry, parentPath, directoryResultChild, <azureStorage.FileService.ShareResult>entry.share);
                        // tslint:disable-next-line: prefer-template
                        parentPath = parentPath + part + '/';
                    } else {
                        let fileResultChild = entries.files.find(element => element.name === part);
                        if (fileResultChild) {
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

    private async findRoot(uri: vscode.Uri): Promise<void> {
        await callWithTelemetryAndErrorHandling('fs.findRoot', async (context) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;

            let temp = uri.authority + uri.path;

            let fileShareName = 'File Shares';
            let endOfRootPathIndx = temp.indexOf(fileShareName) + fileShareName.length;
            let rootPath = temp.substring(0, endOfRootPathIndx);
            let rootFound = await ext.tree.findTreeItem(rootPath, context);

            if (rootFound) {
                this.root = <EntryTreeItem>rootFound;
            } else {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
        });
    }
}
