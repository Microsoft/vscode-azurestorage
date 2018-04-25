/*
  *  Copyright (c) Microsoft Corporation. All rights reserved.
  *  Licensed under the MIT License. See License.txt in the project root for license information.
  **/

import { StorageAccount, StorageAccountKey } from '../../../node_modules/azure-arm-storage/lib/models';
import * as azureStorage from "azure-storage";
import * as path from 'path';

import { IAzureTreeItem, IAzureNode, UserCancelledError, DialogResponses } from 'vscode-azureextensionui';
import { Uri, window, SaveDialogOptions } from 'vscode';
import { BlobFileHandler } from './blobFileHandler';
import { azureStorageOutputChannel } from '../azureStorageOutputChannel';

export class BlobNode implements IAzureTreeItem {
  constructor(
    public readonly blob: azureStorage.BlobService.BlobResult,
    public readonly container: azureStorage.BlobService.ContainerResult,
    public readonly storageAccount: StorageAccount,
    public readonly key: StorageAccountKey) {
  }

  public label: string = this.blob.name;
  public contextValue: string = 'azureBlob';
  public iconPath: { light: string | Uri; dark: string | Uri } = {
    light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'light', 'document.svg'),
    dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'dark', 'document.svg')
  };

  public commandId: string = 'azureStorage.editBlob';

  public async getUrl(_node: IAzureNode): Promise<void> {
    let blobService = azureStorage.createBlobService(this.storageAccount.name, this.key.value);
    let uri = blobService.getUrl(this.container.name, this.blob.name);

    let accessLevel = await this.getContainerpublicAccessLevel();
    let friendlyAccessLevel: string;
    let canAccessPublicy: boolean;
    switch (accessLevel) {
      case "blob":
        friendlyAccessLevel = "Blob (anonymous read access for blobs only)";
        canAccessPublicy = true;
      case "container":
        friendlyAccessLevel = "Container (anonymous read access for containers and blobs)";
        canAccessPublicy = true;
      default:
        friendlyAccessLevel = "Private (no anonymous access)";
        canAccessPublicy = false;
    }

    azureStorageOutputChannel.show();
    let msg: string;
    if (canAccessPublicy) {
      msg = `The URL for blob '${this.blob.name}' is ${uri}, and it is publicly accessible because the container's public access level is set to '${friendlyAccessLevel}'`;
    } else {
      msg = `The URL for blob '${this.blob.name}' is ${uri}, but it is not publicly accessible because the container's public access level is set to '${friendlyAccessLevel}'`;
    }
    azureStorageOutputChannel.appendLine(msg);
  }

  private async getContainerpublicAccessLevel(): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      let blobService = azureStorage.createBlobService(this.storageAccount.name, this.key.value);
      blobService.getContainerProperties(this.container.name, (err, result) => {
        err ? reject(err) : resolve(result.publicAccessLevel);
      });
    });
  }

  public async deleteTreeItem(_node: IAzureNode): Promise<void> {
    const message: string = `Are you sure you want to delete the blob '${this.label}'?`;
    const result = await window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
    if (result === DialogResponses.deleteResponse) {
      const blobService = azureStorage.createBlobService(this.storageAccount.name, this.key.value);
      await new Promise((resolve, reject) => {
        blobService.deleteBlob(this.container.name, this.blob.name, err => {
          err ? reject(err) : resolve();
        });
      });
    } else {
      throw new UserCancelledError();
    }
  }

  public async download(node: IAzureNode<BlobNode>): Promise<void> {
    const handler = new BlobFileHandler();
    await handler.checkCanDownload(node);

    const extension = path.extname(this.blob.name);
    const filters = {
      "All files": ['*']
    };
    if (extension) {
      // This is needed to ensure the file extension is added in the Save dialog, since the filename will be displayed without it by default on Windows
      filters['*' + extension] = [extension];
    }

    const uri: Uri | undefined = await window.showSaveDialog(<SaveDialogOptions>{
      saveLabel: "Download",
      filters,
      defaultUri: Uri.file(this.blob.name)
    });
    if (uri && uri.scheme === 'file') {
      await handler.downloadFile(node, uri.fsPath);
    }
  }
}
