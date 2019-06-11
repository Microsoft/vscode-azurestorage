/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as vscode from 'vscode';
import { DirectoryTreeItem } from './directoryNode';
import { callWithTelemetryAndErrorHandling } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { FileShareGroupTreeItem } from './fileShareGroupNode';
import { FileShareTreeItem2 } from './fileShareNode2';
import { FileTreeItem2 } from './fileNode2';

export type EntryTreeItem = FileShareGroupTreeItem | FileShareTreeItem2 | FileTreeItem2 | DirectoryTreeItem;

class FileStatImpl implements vscode.FileStat {
    type: vscode.FileType;
    ctime: number;
    mtime: number;
    size: number;

    constructor(
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

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat | Thenable<vscode.FileStat>> {
        let entry: EntryTreeItem | undefined = await this.lookup(uri, false);

        if (!!entry) {
            if (entry instanceof FileTreeItem2) {
                // creation and modification times as well as size of tree item are intentionally set to 0 for now
                return new FileStatImpl(vscode.FileType.File, 0, 0, 0);
            }
            else if (entry instanceof DirectoryTreeItem || entry instanceof FileShareTreeItem2) {
                // creation and modification times as well as size of tree item are intentionally set to 0 for now
                return new FileStatImpl(vscode.FileType.Directory, 0, 0, 0);
            }
        }

        throw vscode.FileSystemError.FileNotFound(uri);
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        let entry: DirectoryTreeItem | FileShareTreeItem2 = await this.lookupAsDirectory(uri, false);

        let listFilesandDirectoryResult = await entry.listFiles(undefined);
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

    readFile(_uri: vscode.Uri): Promise<Uint8Array> {
        throw new Error("Method not implemented.");
    }

    writeFile(_uri: vscode.Uri, _content: Uint8Array, _options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }

    async delete(uri: vscode.Uri, _options: { recursive: boolean; }): Promise<void> {
        let fileFound: FileTreeItem2 = await this.lookupAsFile(uri, false);

        if (!!fileFound) {
            return fileFound.deleteTreeItemImpl();
        }

        throw vscode.FileSystemError.FileNotFound(uri);
    }

    rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean; }): Promise<void> {
        throw new Error("Method not implemented.");
    }

    private async lookupAsFile(uri: vscode.Uri, silent: boolean): Promise<FileTreeItem2> {
        let entry = await this.lookup(uri, silent);
        if (entry instanceof FileTreeItem2) {
            return entry;
        }
        throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    private async lookupAsDirectory(uri: vscode.Uri, silent: boolean): Promise<DirectoryTreeItem | FileShareTreeItem2> {
        let entry = await this.lookup(uri, silent);
        if (entry instanceof DirectoryTreeItem || entry instanceof FileShareTreeItem2) {
            return entry;
        }
        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    private async lookup(uri: vscode.Uri, silent: boolean): Promise<EntryTreeItem | undefined> {
        return <EntryTreeItem>await callWithTelemetryAndErrorHandling('fs.readDirectory', async (context) => {
            var parentPath = '/';

            var temp = uri.authority + uri.path;

            var endOfRootPath = temp.indexOf('File Shares')
            var rootPath = temp.substring(0, endOfRootPath + 11);
            var root: EntryTreeItem = <EntryTreeItem>await ext.tree.findTreeItem(rootPath, context);

            var branchPath = temp.substring(endOfRootPath + 11);
            var parts = branchPath.split('/').slice(1);

            var entry: EntryTreeItem = root;

            var shareResult;

            for (const part of parts) {
                if (entry instanceof FileShareGroupTreeItem) {

                    var continuationToken;

                    do {
                        let listShareResult = await entry.listFileShares(continuationToken);

                        continuationToken = listShareResult.continuationToken;

                        let entries = listShareResult.entries;
                        let fileShareResultChild = entries.find(element => element.name === part);
                        shareResult = fileShareResultChild;

                        if (fileShareResultChild) {
                            entry = new FileShareTreeItem2(entry, shareResult);
                            break;
                        }
                    } while (continuationToken != undefined)
                }
                else if (entry instanceof FileShareTreeItem2 || entry instanceof DirectoryTreeItem) {

                    var continuationToken;

                    do {
                        let listFilesAndDirectoriesResult = await entry.listFiles(continuationToken);

                        continuationToken = listFilesAndDirectoriesResult.continuationToken;

                        let entries = listFilesAndDirectoriesResult.entries;

                        let directoryResultChild = entries.directories.find(element => element.name === part);
                        let fileResultChild = entries.files.find(element => element.name === part);

                        if (directoryResultChild) {
                            entry = new DirectoryTreeItem(entry, parentPath, directoryResultChild, shareResult);
                            parentPath = parentPath + part + '/';
                            break;
                        }
                        if (fileResultChild) {
                            entry = new FileTreeItem2(entry, fileResultChild, parentPath, shareResult);
                            break;
                        }
                    } while (continuationToken != undefined)
                }
                else {
                    if (!silent) {
                        throw vscode.FileSystemError.FileNotFound(uri);
                    }
                    else {
                        return undefined;
                    }
                }
            }

            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;
            return entry;
        });
    }
}
