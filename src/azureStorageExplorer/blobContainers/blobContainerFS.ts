
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
import { BlobTreeItem } from './blobNode';

export type EntryTreeItem = BlobContainerGroupTreeItem | BlobContainerTreeItem | BlobTreeItem;

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

        // tslint:disable-next-line: strict-boolean-expressions
        if (!!entry) {
            if (entry instanceof BlobContainerGroupTreeItem || entry instanceof BlobContainerTreeItem) {
                // creation and modification times as well as size of tree item are intentionally set to 0 for now
                // console.log('DIRECTORY' + uri.path);
                return new FileStatImpl(vscode.FileType.Directory, 0, 0, 0);
            } else if (entry instanceof BlobTreeItem) {
                // console.log('FILE' + uri.path);
                // creation and modification times as well as size of tree item are intentionally set to 0 for now
                return new FileStatImpl(vscode.FileType.File, 0, 0, 0);
            }
        }

        throw vscode.FileSystemError.FileNotFound(uri);
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        let entry: EntryTreeItem = await this.lookup(uri);

        let result: [string, vscode.FileType][] = [];
        if (entry instanceof BlobContainerGroupTreeItem) {
            let containerList: azureStorage.BlobService.ListContainerResult = await entry.listContainers(undefined);

            for (let con of containerList.entries) {
                result.push([con.name, vscode.FileType.Directory]);
            }
        } else if (entry instanceof BlobContainerTreeItem) {
            // tslint:disable-next-line: no-non-null-assertion
            let containerList: azureStorage.BlobService.ListBlobsResult = await entry.listBlobs(<azureStorage.common.ContinuationToken>undefined!);

            for (let con of containerList.entries) {
                result.push([con.name, vscode.FileType.File]);
            }
        }

        return result;
    }

    createDirectory(_uri: vscode.Uri): void | Thenable<void> {
        throw new Error("Method not implemented.");
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        let treeItem: BlobTreeItem = await this.lookupAsBlob(uri);

        let blobSerivce: azureStorage.BlobService = treeItem.root.createBlobService();
        let blobName: string = path.basename(uri.path);

        const result = await new Promise<string | undefined>((resolve, reject) => {
            blobSerivce.getBlobToText(treeItem.container.name, blobName, (error?: Error, text?: string, _blockBlob?: azureStorage.BlobService.BlobResult, _response?: azureStorage.ServiceResponse) => {
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

    private async findRoot(uri: vscode.Uri): Promise<void> {
        return <void>await callWithTelemetryAndErrorHandling('fs.lookup', async (context) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;

            const blobContainerString = 'Blob Containers';
            let endOfBlobContainerIndx = uri.path.indexOf(blobContainerString) + blobContainerString.length + 1;
            let endOfBlobContainerName = uri.path.indexOf('/', endOfBlobContainerIndx) === -1 ? uri.path.length : uri.path.indexOf('/', endOfBlobContainerIndx);

            let rootPath: string = uri.path.substring(0, endOfBlobContainerName);

            let rootFound: BlobContainerTreeItem = <BlobContainerTreeItem>await ext.tree.findTreeItem(rootPath, context);

            let fileBlobContainerName = uri.path.substring(endOfBlobContainerIndx, endOfBlobContainerName);

            // tslint:disable-next-line: strict-boolean-expressions
            if (!!rootFound) {
                this.rootMap.set(fileBlobContainerName, rootFound);
            } else {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
        });
    }

    private async lookupAsBlob(uri: vscode.Uri): Promise<BlobTreeItem> {
        let entry = await this.lookup(uri);
        if (entry instanceof BlobTreeItem) {
            return entry;
        }
        throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    private async lookup(uri: vscode.Uri): Promise<EntryTreeItem> {
        return <EntryTreeItem>await callWithTelemetryAndErrorHandling('fs.lookup', async (context) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;

            const blobContainerString = 'Blob Containers';
            let endOfBlobContainerIndx = uri.path.indexOf(blobContainerString) + blobContainerString.length + 1;
            let parts = uri.path.substring(endOfBlobContainerIndx).split('/');

            let blobContainerName: string = parts[0] ? parts[0] : '';

            if (!this.rootMap.get(blobContainerName)) {
                await this.findRoot(uri);
            }

            let entry: EntryTreeItem;
            let root = this.rootMap.get(blobContainerName);

            if (root === undefined) {
                throw new RangeError('Could not find Blob Container.');
            } else {
                entry = root;
            }

            let parentPath = blobContainerName;

            for (let part of parts.slice(1)) {
                if (entry instanceof BlobContainerGroupTreeItem || entry instanceof BlobTreeItem) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }

                // tslint:disable-next-line: prefer-template
                // parentPath = parentPath + '/' + part;
                let prefix: string = uri.path.substring(0, endOfBlobContainerIndx) + parentPath;
                let blobSerivce = entry.root.createBlobService();

                const listBlobDirectoryResult = await new Promise<azureStorage.BlobService.ListBlobDirectoriesResult>((resolve, reject) => {
                    // Intentionally passing undefined for token - only supports listing first batch of files for now
                    // tslint:disable-next-line: no-non-null-assertion
                    blobSerivce.listBlobDirectoriesSegmentedWithPrefix(blobContainerName, prefix, <azureStorage.common.ContinuationToken>undefined!, (error?: Error, result?: azureStorage.BlobService.ListBlobDirectoriesResult, _response?: azureStorage.ServiceResponse) => {
                        if (!!error) {
                            reject(error);
                        } else {
                            resolve(result);
                        }
                    });
                });

                let directoryResultChild = listBlobDirectoryResult.entries.find(element => element.name === part);

                if (!directoryResultChild) {
                    // const listBlobsResult = await new Promise<azureStorage.BlobService.ListBlobsResult>((resolve, reject) => {
                    //     // Intentionally passing undefined for token - only supports listing first batch of files for now
                    //     // tslint:disable-next-line: no-non-null-assertion
                    //     let options = { delimiter: '/' };
                    //     // tslint:disable-next-line: no-non-null-assertion
                    //     blobSerivce.listBlobsSegmentedWithPrefix(blobContainerName, prefix, <azureStorage.common.ContinuationToken>undefined!, options, (error?: Error, result?: azureStorage.BlobService.ListBlobsResult, _response?: azureStorage.ServiceResponse) => {
                    //         if (!!error) {
                    //             reject(error);
                    //         } else {
                    //             resolve(result);
                    //         }
                    //     });
                    // });

                    let listBlobsResult: azureStorage.BlobService.ListBlobsResult = await entry.listBlobs(<azureStorage.common.ContinuationToken>undefined!);

                    let blobResultChild = listBlobsResult.entries.find(element => element.name === part);

                    if (!blobResultChild) {
                        throw vscode.FileSystemError.FileNotFound(uri);
                    }
                    entry = new BlobTreeItem(entry, blobResultChild, <azureStorage.BlobService.ContainerResult>entry.container);
                }
            }
            return entry;
        });
    }

}
