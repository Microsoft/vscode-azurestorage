
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import * as path from 'path';
import * as vscode from 'vscode';
import { callWithTelemetryAndErrorHandling } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { FileStatImpl } from "../fileShares/FileShareFS";
import { BlobContainerGroupTreeItem } from './blobContainerGroupNode';
import { BlobContainerTreeItem } from './blobContainerNode';
import { BlobDirectoryTreeItem } from "./blobDirectoryNode";
import { BlobTreeItem } from './blobNode';

export type EntryTreeItem = BlobContainerGroupTreeItem | BlobContainerTreeItem | BlobDirectoryTreeItem | BlobTreeItem;

export class BlobContainerFS implements vscode.FileSystemProvider {

    private rootMap: Map<string, BlobContainerTreeItem> = new Map<string, BlobContainerTreeItem>();

    // tslint:disable-next-line: typedef
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        let entry: EntryTreeItem = await this.lookup(uri);

        if (entry instanceof BlobContainerGroupTreeItem || entry instanceof BlobContainerTreeItem || entry instanceof BlobDirectoryTreeItem) {
            // creation and modification times as well as size of tree item are intentionally set to 0 for now
            return new FileStatImpl(vscode.FileType.Directory, 0, 0, 0);
        } else if (entry instanceof BlobTreeItem) {
            // creation and modification times as well as size of tree item are intentionally set to 0 for now
            return new FileStatImpl(vscode.FileType.File, 0, 0, 0);
        }

        throw vscode.FileSystemError.FileNotFound(uri);
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        let entry: EntryTreeItem = await this.lookup(uri);
        let directoryChildren: [string, vscode.FileType][] = [];

        if (entry instanceof BlobTreeItem) {
            throw vscode.FileSystemError.FileNotADirectory(uri);
        } else if (entry instanceof BlobContainerGroupTreeItem) {
            let containerList: azureStorage.BlobService.ListContainerResult = await entry.listContainers(undefined);

            for (let con of containerList.entries) {
                directoryChildren.push([con.name, vscode.FileType.Directory]);
            }
        } else {
            let parsedUri = this.parseUri(uri);
            let prefix = `${parsedUri.prefix}${parsedUri.basename}`;
            prefix = prefix === '' ? prefix : `${prefix}/`;
            const blobContainerName = parsedUri.containerName;

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

        let parsedUri = this.parseUri(uri);
        let blobSerivce: azureStorage.BlobService = treeItem.root.createBlobService();

        const result = await new Promise<string | undefined>((resolve, reject) => {
            blobSerivce.getBlobToText(parsedUri.containerName, `${parsedUri.prefix}${parsedUri.basename}`, (error?: Error, text?: string) => {
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
    async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
        if (!options.recursive) {
            throw new RangeError('Do not support non recursive deletion of folders or files???'); // TODO better error
        }

        let entry: EntryTreeItem = await this.lookup(uri);
        let parsedUri = this.parseUri(uri);

        if (entry instanceof BlobTreeItem) {
            const blobSerivce = entry.root.createBlobService();

            await new Promise<void>((resolve, reject) => {
                blobSerivce.deleteBlob(parsedUri.containerName, `${parsedUri.prefix}${parsedUri.basename}`, (error?: Error) => {
                    if (!!error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
        } else if (entry instanceof BlobDirectoryTreeItem) {
            await this.recursiveDeleteFolder(entry);
        }
    }

    private async recursiveDeleteFolder(entry: BlobDirectoryTreeItem): Promise<void> {
        const blobSerivce = entry.root.createBlobService();
        let parsedUri = this.parseUri(vscode.Uri.file(entry.fullId));

        let prefix = `${parsedUri.prefix}${parsedUri.basename}`;
        prefix = prefix === '' || prefix[prefix.length - 1] === '/' ? prefix : `${prefix}/`;

        let childBlob = await this.listAllChildBlob(blobSerivce, parsedUri.containerName, prefix);

        for (const blob of childBlob.entries) {
            await new Promise<void>((resolve, reject) => {
                blobSerivce.deleteBlob(parsedUri.containerName, blob.name, (error?: Error) => {
                    if (!!error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
        }

        let childDir = await this.listAllChildDirectory(blobSerivce, parsedUri.containerName, prefix);

        for (const dir of childDir.entries) {
            let temp = dir.name.substring(0, dir.name.length - 1);
            let basename = temp.substring(temp.lastIndexOf('/') + 1);
            let dirTreeItem = new BlobDirectoryTreeItem(entry, basename, '', entry.container);
            await this.recursiveDeleteFolder(dirTreeItem);
        }
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

            let parsedUri = this.parseUri(uri);
            let parts = (`${parsedUri.prefix}${parsedUri.basename}`).split('/');
            const blobContainerName = parsedUri.containerName;

            const foundRoot = this.rootMap.get(blobContainerName);
            let entry: EntryTreeItem = !!foundRoot ? foundRoot : await this.findRoot(uri);

            if (!entry) {
                throw new RangeError('Could not find Blob Container.');
            }

            let prefix = '';
            let blobSerivce = entry.root.createBlobService();

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
                    entry = new BlobDirectoryTreeItem(entry, part, prefix, entry.container);
                } else {
                    const listBlobResult = await this.listAllChildBlob(blobSerivce, blobContainerName, prefix);
                    const blobResultChild = listBlobResult.entries.find(element => element.name === prefix);
                    if (!blobResultChild) {
                        throw vscode.FileSystemError.FileNotFound(uri);
                    }
                    entry = new BlobTreeItem(entry, blobResultChild, entry.container);
                }
            }
            return entry;
        });
    }

    private async findRoot(uri: vscode.Uri): Promise<BlobContainerTreeItem> {
        return <BlobContainerTreeItem>await callWithTelemetryAndErrorHandling('blob.lookup', async (context) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;

            const blobContainerString = 'Blob Containers';
            let endOfBlobContainerIndx = uri.path.indexOf(blobContainerString) + blobContainerString.length + 1;
            let endOfBlobContainerName = uri.path.indexOf('/', endOfBlobContainerIndx) === -1 ? uri.path.length : uri.path.indexOf('/', endOfBlobContainerIndx);

            let rootPath: string = uri.path.substring(0, endOfBlobContainerName);
            let rootFound: BlobContainerTreeItem | undefined = await ext.tree.findTreeItem(rootPath, context);

            if (!rootFound) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }

            let fileBlobContainerName = uri.path.substring(endOfBlobContainerIndx, endOfBlobContainerName);
            this.rootMap.set(fileBlobContainerName, rootFound);
            return rootFound;
        });
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

    // returns [container name, prefix (post container name), basename]
    private parseUri(uri: vscode.Uri): { containerName: string, prefix: string, basename: string } {
        const blobContainerString = 'Blob Containers';
        let uriPath = uri.path.substring(uri.path.indexOf(blobContainerString) + blobContainerString.length + 1);
        uriPath = uriPath[uriPath.length - 1] === '/' ? uriPath.substring(0, uriPath.length - 1) : uriPath;

        let firstSlashIndex = uriPath.indexOf('/');
        let lastSlashIndex = uriPath.lastIndexOf('/');

        let containerName = firstSlashIndex !== -1 ? uriPath.substring(0, firstSlashIndex) : uriPath;
        let basename = firstSlashIndex !== -1 ? uriPath.substring(lastSlashIndex + 1) : '';
        let prefix = firstSlashIndex !== lastSlashIndex ? uriPath.substring(firstSlashIndex + 1, lastSlashIndex + 1) : '';

        return { containerName, prefix, basename };
    }

}
