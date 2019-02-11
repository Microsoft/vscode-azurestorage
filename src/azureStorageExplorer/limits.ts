/*
  *  Copyright (c) Microsoft Corporation. All rights reserved.
  *  Licensed under the MIT License. See License.md in the project root for license information.
  **/

import { window } from "vscode";
import { UserCancelledError } from "vscode-azureextensionui";
import { ResourceType } from "../storageExplorerLauncher/ResourceType";
import { storageExplorerLauncher } from "../storageExplorerLauncher/storageExplorerLauncher";

export namespace Limits {
    //  VS Code currently supports at least 256MB, but not 512MB. But it won't open anything larger than 4MB through the APIs.
    export const maxUploadDownloadSizeMB = 4;
    export const maxUploadDownloadSizeBytes = maxUploadDownloadSizeMB * 1000 * 1000;

    export async function askOpenInStorageExplorer(errorMessage: string, resourceId: string, subscriptionId: string, resourceType: ResourceType, resourceName: string): Promise<void> {
        const message = "Open container in Storage Explorer";
        if (message === await window.showErrorMessage(errorMessage, message)) {
            await storageExplorerLauncher.openResource(resourceId, subscriptionId, resourceType, resourceName);
        }

        // Either way, throw canceled error
        throw new UserCancelledError(message);
    }
}
