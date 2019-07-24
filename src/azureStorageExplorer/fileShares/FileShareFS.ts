/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import * as path from 'path';
import * as vscode from 'vscode';
import { AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext } from "vscode-azureextensionui";
import { findRoot } from "../findRoot";
import { parseUri } from "../parseUri";
import { DirectoryTreeItem } from './directoryNode';
import { createDirectory, deleteDirectoryAndContents } from "./directoryUtils";
import { FileTreeItem } from "./fileNode";
import { FileShareGroupTreeItem } from './fileShareGroupNode';
import { FileShareTreeItem } from "./fileShareNode";
import { deleteFile } from "./fileUtils";
import { validateDirectoryName } from "./validateNames";

export type EntryTreeItem = FileShareGroupTreeItem | FileShareTreeItem | FileTreeItem | DirectoryTreeItem;

export class FileShareFS implements vscode.FileSystemProvider {

    private _fileShareString: string = 'File Shares';

    private _emitter: vscode.EventEmitter<vscode.FileChangeEvent[]> = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    // To detect uris that vscode automatically calls so that we do not throw unnecessary errors
    private _configUri: string[] = ['pom.xml', 'node_modules', '.vscode', '.vscode/settings.json', '.vscode/tasks.json', '.vscode/launch.json', '.git/config'];
    private _configRootNames: string[] = ['pom.xml', 'node_modules', '.git', '.vscode'];

    private _readDirChild: Set<string> = new Set<string>();

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        return <vscode.FileStat>await callWithTelemetryAndErrorHandling('fs.stat', async (context) => {
            if (this._readDirChild.has(path.posix.join(uri.path, "1"))) {
                return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 };
            } else if (this._readDirChild.has(path.posix.join(uri.path, "2"))) {
                return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
            }

            let treeItem: EntryTreeItem = await this.lookup(context, uri);

            if (treeItem instanceof DirectoryTreeItem || treeItem instanceof FileShareTreeItem) {
                // creation and modification times as well as size of tree item are intentionally set to 0 for now
                return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
            } else if (treeItem instanceof FileTreeItem) {
                // creation and modification times as well as size of tree item are intentionally set to 0 for now
                return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 };
            } else if (treeItem instanceof FileShareGroupTreeItem) {
                throw new Error('Cannot view multiple File Shares at once.');
            }

            throw vscode.FileSystemError.FileNotFound(uri);
        });
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        return <[string, vscode.FileType][]>await callWithTelemetryAndErrorHandling('fs.readDirectory', async (context) => {
            let entry: DirectoryTreeItem | FileShareTreeItem = await this.lookupAsDirectory(context, uri);

            let children: AzExtTreeItem[] = [];
            if (entry.hasMoreChildrenImpl()) {
                children = await entry.loadMoreChildrenImpl(false);
            }

            let previousChildren: AzExtTreeItem[] = await entry.getCachedChildren(context);
            let allChildren: AzExtTreeItem[] = previousChildren.concat(children);

            let result: [string, vscode.FileType][] = [];
            for (const child of allChildren) {
                if (child instanceof FileTreeItem) {
                    let baseName: string = path.basename(child.label);

                    result.push([baseName, vscode.FileType.File]);

                    let childUri: string = path.posix.join(uri.path, baseName, "1");
                    this._readDirChild.add(childUri);
                } else if (child instanceof DirectoryTreeItem) {
                    let baseName: string = path.basename(child.label);

                    result.push([baseName, vscode.FileType.Directory]);

                    let childUri: string = path.posix.join(uri.path, baseName, "2");
                    this._readDirChild.add(childUri);
                }
            }

            return result;
        });
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        return await callWithTelemetryAndErrorHandling('fs.createDirectory', async (context) => {
            context.errorHandling.rethrow = true;

            let parsedUri = parseUri(uri, this._fileShareString);
            let root: FileShareTreeItem = await this.getRoot(context, uri);

            let response: string | undefined | null = validateDirectoryName(parsedUri.baseName);
            if (response) {
                throw new Error(response);
            }

            await createDirectory(root.share, root.root, parsedUri.parentDirPath, parsedUri.baseName);
        });
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return <Uint8Array>await callWithTelemetryAndErrorHandling('fs.readFile', async (context) => {
            context.errorHandling.rethrow = true;
            let parsedUri = parseUri(uri, this._fileShareString);

            if (this._configUri.includes(parsedUri.filePath) || this._configRootNames.includes(parsedUri.rootName)) {
                context.errorHandling.suppressDisplay = true;
            }

            let treeItem: FileShareTreeItem = await this.getRoot(context, uri);
            let fileService = treeItem.root.createFileService();
            const result = await new Promise<string | undefined>((resolve, reject) => {
                fileService.getFileToText(treeItem.share.name, parsedUri.parentDirPath, parsedUri.baseName, (error?: Error, text?: string) => {
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
        await callWithTelemetryAndErrorHandling('fs.writeFile', async (context) => {
            if (!options.create && !options.overwrite) {
                throw vscode.FileSystemError.NoPermissions(uri);
            }

            let parsedUri = parseUri(uri, this._fileShareString);
            let root: FileShareTreeItem = await this.getRoot(context, uri);

            const fileService = root.root.createFileService();
            let fileResultChild = await new Promise<azureStorage.FileService.FileResult>((resolve, reject) => {
                fileService.doesFileExist(parsedUri.rootName, parsedUri.parentDirPath, parsedUri.baseName, (error?: Error, result?: azureStorage.FileService.FileResult) => {
                    if (!!error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                });
            });

            if (!fileResultChild.exists && !options.create) {
                throw vscode.FileSystemError.FileNotFound(uri);
            } else if (fileResultChild.exists && !options.overwrite) {
                throw vscode.FileSystemError.FileExists(uri);
            } else {
                await new Promise<void>((resolve, reject) => {
                    fileService.createFileFromText(parsedUri.rootName, parsedUri.parentDirPath, parsedUri.baseName, content.toString(), (error?: Error) => {
                        if (!!error) {
                            reject(error);
                        } else {
                            resolve();
                        }
                    });
                });
            }
        });
    }

    // tslint:disable-next-line: no-reserved-keywords
    async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
        await callWithTelemetryAndErrorHandling('fs.delete', async (context) => {
            context.errorHandling.rethrow = true;

            if (!options.recursive) {
                throw new Error("Azure storage does not support nonrecursive deletion of folders.");
            }

            let parsedUri = parseUri(uri, this._fileShareString);
            let fileFound: EntryTreeItem = await this.lookup(context, uri);
            if (fileFound instanceof FileTreeItem) {
                await deleteFile(fileFound.directoryPath, fileFound.file.name, fileFound.share.name, fileFound.root);
            } else if (fileFound instanceof DirectoryTreeItem) {
                await deleteDirectoryAndContents(parsedUri.filePath, fileFound.share.name, fileFound.root);
            } else {
                throw new RangeError("Tried to delete a FileShare or the folder of FileShares.");
            }
        });
    }

    async rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean; }): Promise<void> {
        return await callWithTelemetryAndErrorHandling('fs.rename', async (context) => {
            context.errorHandling.rethrow = true;
            throw new Error('Renaming/moving folders or files not supported.');
        });
    }

    private async lookupAsDirectory(context: IActionContext, uri: vscode.Uri): Promise<DirectoryTreeItem | FileShareTreeItem> {
        let entry = await this.lookup(context, uri);
        if (entry instanceof DirectoryTreeItem || entry instanceof FileShareTreeItem) {
            return entry;
        }
        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    private async lookup(context: IActionContext, uri: vscode.Uri): Promise<EntryTreeItem> {
        context.errorHandling.rethrow = true;

        let parsedUri = parseUri(uri, this._fileShareString);

        if (this._configUri.includes(parsedUri.filePath) || this._configRootNames.includes(parsedUri.rootName)) {
            context.errorHandling.suppressDisplay = true;
        }

        let entry: EntryTreeItem = await this.getRoot(context, uri);
        if (parsedUri.filePath === '') {
            return entry;
        }

        let parentPath = '';
        let parts = parsedUri.filePath.split('/');
        for (let part of parts) {
            if (entry instanceof FileTreeItem) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
            // Intentionally passing undefined for token - only supports listing first batch of files for now
            // tslint:disable-next-line:no-non-null-assertion // currentToken argument typed incorrectly in SDK
            let listFilesAndDirectoriesResult: azureStorage.FileService.ListFilesAndDirectoriesResult = await entry.listFiles(<azureStorage.common.ContinuationToken>undefined!);
            let entries = listFilesAndDirectoriesResult.entries;

            let directoryResultChild = entries.directories.find(element => element.name === part);
            if (!!directoryResultChild) {
                entry = new DirectoryTreeItem(entry, parentPath, directoryResultChild, <azureStorage.FileService.ShareResult>entry.share);
                parentPath = path.posix.join(parentPath, part);
            } else {
                let fileResultChild = entries.files.find(element => element.name === part);
                if (!!fileResultChild) {
                    entry = new FileTreeItem(entry, fileResultChild, parentPath, <azureStorage.FileService.ShareResult>entry.share);
                } else {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
            }
        }

        return entry;
    }

    private async getRoot(context: IActionContext, uri: vscode.Uri): Promise<FileShareTreeItem> {
        let root = await findRoot(context, uri, this._fileShareString);

        if (root instanceof FileShareTreeItem) {
            return root;
        } else {
            throw new RangeError('The root found must be a FileShareTreeItem.');
        }
    }
}
