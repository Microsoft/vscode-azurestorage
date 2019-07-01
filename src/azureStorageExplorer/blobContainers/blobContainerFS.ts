
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import * as path from 'path';
import * as vscode from 'vscode';
import { callWithTelemetryAndErrorHandling } from "vscode-azureextensionui";
import { findRoot, parseUri } from "../fsp";
import { IStorageRoot } from "../IStorageRoot";
import { BlobContainerGroupTreeItem } from './blobContainerGroupNode';
import { BlobContainerTreeItem } from './blobContainerNode';
import { BlobDirectoryTreeItem } from "./BlobDirectoryTreeItem";
import { BlobTreeItem } from './blobNode';

export type EntryTreeItem = BlobContainerGroupTreeItem | BlobContainerTreeItem | BlobDirectoryTreeItem | BlobTreeItem;

export class BlobContainerFS implements vscode.FileSystemProvider {

    private rootMap: Map<[string, string], BlobContainerTreeItem> = new Map<[string, string], BlobContainerTreeItem>();

    private _emitter: vscode.EventEmitter<vscode.FileChangeEvent[]> = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        let entry: EntryTreeItem = await this.lookup(uri);

        if (entry instanceof BlobContainerGroupTreeItem || entry instanceof BlobContainerTreeItem || entry instanceof BlobDirectoryTreeItem) {
            // creation and modification times as well as size of tree item are intentionally set to 0 for now
            return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        } else if (entry instanceof BlobTreeItem) {
            // creation and modification times as well as size of tree item are intentionally set to 0 for now
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 };
        }

        throw vscode.FileSystemError.FileNotFound(uri);
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        let entry: EntryTreeItem = await this.lookup(uri);
        let directoryChildren: [string, vscode.FileType][] = [];

        if (entry instanceof BlobContainerGroupTreeItem) {
            throw new Error('Cannot view multiple blob containers at once.');
        } else if (entry instanceof BlobTreeItem) {
            throw vscode.FileSystemError.FileNotADirectory(uri);
        } else {
            let parsedUri = parseUri(uri, 'Blob Containers');
            let prefix = parsedUri.parentPath === '' && parsedUri.baseName === '' ? '' : `${path.join(parsedUri.parentPath, parsedUri.baseName)}/`;
            const blobContainerName = parsedUri.groupTreeItemName;

            const blobSerivce = entry.root.createBlobService();

            const listBlobResult = await this.listAllChildBlob(blobSerivce, blobContainerName, prefix);
            const listDirectoryResult = await this.listAllChildDirectory(blobSerivce, blobContainerName, prefix);

            for (let blobRes of listBlobResult.entries) {
                let blobName = path.basename(blobRes.name);
                directoryChildren.push([blobName, vscode.FileType.File]);
            }

            for (let dirRes of listDirectoryResult.entries) {
                let dirName = entry instanceof BlobContainerTreeItem ? dirRes.name : dirRes.name.substring(dirRes.name.indexOf('/') + 1);
                directoryChildren.push([dirName, vscode.FileType.Directory]);
            }
        }

        return directoryChildren;
    }

    createDirectory(_uri: vscode.Uri): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        let treeItem: BlobTreeItem = await this.lookupAsBlob(uri);

        let parsedUri = parseUri(uri, 'Blob Containers');
        const blobContainerName = parsedUri.groupTreeItemName;
        const blobName = path.join(parsedUri.parentPath, parsedUri.baseName);

        let blobSerivce: azureStorage.BlobService = treeItem.root.createBlobService();

        const result = await new Promise<string | undefined>((resolve, reject) => {
            blobSerivce.getBlobToText(blobContainerName, blobName, (error?: Error, text?: string) => {
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

    writeFile(_uri: vscode.Uri, _content: Uint8Array, _options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }

    // tslint:disable-next-line: no-reserved-keywords
    delete(_uri: vscode.Uri, _options: { recursive: boolean; }): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }

    rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean; }): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }

    private async lookupAsBlob(uri: vscode.Uri): Promise<BlobTreeItem> {
        const entry = await this.lookup(uri);
        if (entry instanceof BlobTreeItem) {
            return entry;
        }
        throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    private async lookup(uri: vscode.Uri): Promise<EntryTreeItem> {
        return <EntryTreeItem>await callWithTelemetryAndErrorHandling('blob.lookup', async (context) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;

            let parsedUri = parseUri(uri, 'Blob Containers');
            let parts = (parsedUri.parentPath === '' && parsedUri.baseName === '' ? '' : path.join(parsedUri.parentPath, parsedUri.baseName)).split('/');
            const blobContainerName = parsedUri.groupTreeItemName;

            const foundRoot = this.rootMap.get([parsedUri.accountName, blobContainerName]);
            let entry: EntryTreeItem | undefined = !!foundRoot ? foundRoot : await this.updateRootMap(uri);

            if (!entry) {
                throw new RangeError('Could not find Blob Container.');
            }

            let prefix = '';
            let blobSerivce = entry.root.createBlobService();
            let root: IStorageRoot = entry.root;
            const firstEntry = entry;

            for (let part of parts) {
                if (part === '') {
                    return entry;
                }
                if (entry instanceof BlobContainerGroupTreeItem || entry instanceof BlobTreeItem) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }

                prefix = path.join(prefix, part);

                const listBlobDirectoryResult = await this.listAllChildDirectory(blobSerivce, blobContainerName, prefix);
                const directoryResultChild = listBlobDirectoryResult.entries.find(element => element.name === `${prefix}/`);
                if (!!directoryResultChild) {
                    entry = new BlobDirectoryTreeItem(root, part, prefix, entry.container);
                } else {
                    const listBlobResult = await this.listAllChildBlob(blobSerivce, blobContainerName, prefix);
                    const blobResultChild = listBlobResult.entries.find(element => element.name === prefix);
                    if (!blobResultChild) {
                        throw vscode.FileSystemError.FileNotFound(uri);
                    }
                    entry = new BlobTreeItem(firstEntry, blobResultChild, entry.container);
                }
            }
            return entry;
        });
    }

    private async updateRootMap(uri: vscode.Uri): Promise<BlobContainerTreeItem | undefined> {
        let root = await findRoot(uri, 'Blob Containers');
        let parsedUri = parseUri(uri, 'Blob Containers');

        if (!root) {
            throw vscode.FileSystemError.FileNotFound(uri);
        } else if (root instanceof BlobContainerTreeItem) {
            let fileBlobContainerName = parsedUri.groupTreeItemName;
            this.rootMap.set([parsedUri.accountName, fileBlobContainerName], root);
            return root;
        } else {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    private async listAllChildDirectory(blobSerivce: azureStorage.BlobService, blobContainerName: string, prefix: string): Promise<azureStorage.BlobService.ListBlobDirectoriesResult> {
        return await new Promise<azureStorage.BlobService.ListBlobDirectoriesResult>((resolve, reject) => {
            // Intentionally passing undefined for token - only supports listing first batch of files for now
            // tslint:disable-next-line: no-non-null-assertion
            blobSerivce.listBlobDirectoriesSegmentedWithPrefix(blobContainerName, prefix, <azureStorage.common.ContinuationToken>undefined!, (error?: Error, result?: azureStorage.BlobService.ListBlobDirectoriesResult) => {
                if (!!error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    }

    private async listAllChildBlob(blobSerivce: azureStorage.BlobService, blobContainerName: string, prefix: string): Promise<azureStorage.BlobService.ListBlobsResult> {
        return await new Promise<azureStorage.BlobService.ListBlobsResult>((resolve, reject) => {
            // Intentionally passing undefined for token - only supports listing first batch of files for now
            // tslint:disable-next-line: no-non-null-assertion
            let options = { delimiter: '/' };
            // tslint:disable-next-line: no-non-null-assertion
            blobSerivce.listBlobsSegmentedWithPrefix(blobContainerName, prefix, <azureStorage.common.ContinuationToken>undefined!, options, (error?: Error, result?: azureStorage.BlobService.ListBlobsResult) => {
                if (!!error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    }
}
