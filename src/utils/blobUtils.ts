/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorageBlob from '@azure/storage-blob';
import * as mime from "mime";
import * as path from 'path';
import * as vscode from 'vscode';
import { AzExtTreeItem, IActionContext, ICreateChildImplContext } from 'vscode-azureextensionui';
import { maxPageSize } from '../constants';
import { ext } from '../extensionVariables';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { BlobDirectoryTreeItem } from '../tree/blob/BlobDirectoryTreeItem';
import { BlobTreeItem } from '../tree/blob/BlobTreeItem';
import { IStorageRoot } from "../tree/IStorageRoot";
import { localize } from './localize';

export interface ILoadMoreBlobChildrenResponse {
    children: AzExtTreeItem[];
    continuationToken?: string;
}

export function createBlobContainerClient(root: IStorageRoot, containerName: string): azureStorageBlob.ContainerClient {
    const blobServiceClient: azureStorageBlob.BlobServiceClient = root.createBlobServiceClient();
    return blobServiceClient.getContainerClient(containerName);
}

export function createBlobClient(root: IStorageRoot, containerName: string, blobName: string): azureStorageBlob.BlobClient {
    const blobContainerClient: azureStorageBlob.ContainerClient = createBlobContainerClient(root, containerName);
    return blobContainerClient.getBlobClient(blobName);
}

export function createBlockBlobClient(root: IStorageRoot, containerName: string, blobName: string): azureStorageBlob.BlockBlobClient {
    const blobContainerClient: azureStorageBlob.ContainerClient = createBlobContainerClient(root, containerName);
    return blobContainerClient.getBlockBlobClient(blobName);
}

async function loadMoreBlobChildren(parent: BlobContainerTreeItem | BlobDirectoryTreeItem, continuationToken?: string): Promise<ILoadMoreBlobChildrenResponse> {
    const prefix: string | undefined = parent instanceof BlobDirectoryTreeItem ? parent.dirPath : undefined;
    const containerClient: azureStorageBlob.ContainerClient = createBlobContainerClient(parent.root, parent.container.name);
    let response: AsyncIterableIterator<azureStorageBlob.ContainerListBlobHierarchySegmentResponse> = containerClient.listBlobsByHierarchy(path.posix.sep, { prefix }).byPage({ continuationToken, maxPageSize: maxPageSize });

    // tslint:disable-next-line: no-unsafe-any
    let responseValue: azureStorageBlob.ListBlobsHierarchySegmentResponse = (await response.next()).value;
    continuationToken = responseValue.continuationToken;

    let children: AzExtTreeItem[] = [];
    for (const blob of responseValue.segment.blobItems) {
        // NOTE: `blob.name` as returned from Azure is actually the blob path in the container
        children.push(new BlobTreeItem(parent, blob.name, parent.container));
    }

    // tslint:disable-next-line: strict-boolean-expressions
    for (const directory of responseValue.segment.blobPrefixes || []) {
        // NOTE: `directory.name` as returned from Azure is actually the directory path in the container
        children.push(new BlobDirectoryTreeItem(parent, directory.name, parent.container));
    }

    return { children, continuationToken };
}

export async function ensureLoadMoreBlobChildren(parent: BlobContainerTreeItem | BlobDirectoryTreeItem, loadedChildren: Set<string>, continuationToken?: string | undefined): Promise<ILoadMoreBlobChildrenResponse> {
    let children: AzExtTreeItem[];
    do {
        const response: ILoadMoreBlobChildrenResponse = await loadMoreBlobChildren(parent, continuationToken);
        children = response.children;
        continuationToken = response.continuationToken;
        if (parent.root.isEmulated) {
            children = filterOutLoadedChildren(children, loadedChildren);
        }
    } while (children.length === 0 && !!continuationToken)
    return { children, continuationToken };
}

function filterOutLoadedChildren(children: AzExtTreeItem[], loadedChildren: Set<string>): AzExtTreeItem[] {
    let result: AzExtTreeItem[] = [];
    for (const child of children) {
        if (!loadedChildren.has(child.fullId)) {
            result.push(child);
            loadedChildren.add(child.fullId);
        }
    }
    return result;
}

// Currently only supports creating block blobs
export async function createChildAsNewBlockBlob(parent: BlobContainerTreeItem | BlobDirectoryTreeItem, context: ICreateChildImplContext & IBlobContainerCreateChildContext): Promise<BlobTreeItem> {
    let blobPath: string = context.childName || await getBlobPath(parent);

    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (progress) => {
        context.showCreatingTreeItem(blobPath);
        progress.report({ message: `Azure Storage: Creating block blob '${blobPath}'` });
        await createOrUpdateBlockBlob(parent, blobPath);
        return new BlobTreeItem(parent, blobPath, parent.container);
    });
}

export async function createOrUpdateBlockBlob(parent: BlobContainerTreeItem | BlobDirectoryTreeItem, name: string, text?: string | Buffer): Promise<void> {
    text = text ? text : '';
    const contentLength: number = text instanceof Buffer ? text.byteLength : text.length;
    const containerClient: azureStorageBlob.ContainerClient = createBlobContainerClient(parent.root, parent.container.name);

    let properties: azureStorageBlob.BlockBlobUploadOptions | undefined = await getExistingProperties(parent, name);
    // tslint:disable: strict-boolean-expressions
    properties = properties || {};
    properties.blobHTTPHeaders = properties.blobHTTPHeaders || {};
    properties.blobHTTPHeaders.blobContentType = properties.blobHTTPHeaders.blobContentType || mime.getType(name) || undefined;
    // tslint:enable: strict-boolean-expressions

    await containerClient.uploadBlockBlob(name, text, contentLength, properties);
}

export async function doesBlobExist(treeItem: BlobContainerTreeItem | BlobDirectoryTreeItem, blobPath: string): Promise<boolean> {
    const blobClient: azureStorageBlob.BlobClient = createBlobClient(treeItem.root, treeItem.container.name, blobPath);
    return blobClient.exists();
}

export async function doesBlobDirectoryExist(treeItem: BlobContainerTreeItem | BlobDirectoryTreeItem, blobDirectoryName: string): Promise<boolean> {
    const sep: string = path.posix.sep;
    if (!blobDirectoryName.endsWith(sep)) {
        blobDirectoryName = `${blobDirectoryName}${sep}`;
    }

    const containerClient: azureStorageBlob.ContainerClient = createBlobContainerClient(treeItem.root, treeItem.container.name);
    const response: AsyncIterableIterator<azureStorageBlob.ContainerListBlobHierarchySegmentResponse> = containerClient.listBlobsByHierarchy(sep, { prefix: blobDirectoryName }).byPage({ maxPageSize: 1 });

    for await (const responseValue of response) {
        if (responseValue.segment.blobItems.length || responseValue.segment.blobPrefixes?.length) {
            return true;
        }
    }

    return false;
}

export async function getExistingProperties(parent: BlobTreeItem | BlobContainerTreeItem | BlobDirectoryTreeItem, blobPath: string): Promise<azureStorageBlob.BlockBlobUploadOptions | undefined> {
    const blockBlobClient: azureStorageBlob.BlockBlobClient = createBlockBlobClient(parent.root, parent.container.name, blobPath);
    if (await blockBlobClient.exists()) {
        let existingProperties: azureStorageBlob.BlobGetPropertiesResponse = await blockBlobClient.getProperties();
        return {
            metadata: existingProperties.metadata,
            blobHTTPHeaders: {
                blobCacheControl: existingProperties.cacheControl,
                blobContentType: existingProperties.contentType,
                blobContentEncoding: existingProperties.contentEncoding,
                blobContentLanguage: existingProperties.contentLanguage,
                blobContentDisposition: existingProperties.contentDisposition,
                blobContentMD5: undefined // Needs to be filled in by SDK
            }
        };
    }

    return undefined;
}

export async function getBlobPath(parent: BlobContainerTreeItem | BlobDirectoryTreeItem, value?: string): Promise<string> {
    return await ext.ui.showInputBox({
        value,
        placeHolder: localize('enterNameForNewBlockBlob', 'Enter a name for the new block blob'),
        validateInput: async (name: string) => {
            let nameError = BlobContainerTreeItem.validateBlobName(name);
            if (nameError) {
                return nameError;
            } else if (await doesBlobExist(parent, name)) {
                return localize('aBlobWithThisPathAndNameAlreadyExists', 'A blob with this path and name already exists');
            }

            return undefined;
        }
    });
}

export interface IBlobContainerCreateChildContext extends IActionContext {
    childType: string;
    childName: string;
}
