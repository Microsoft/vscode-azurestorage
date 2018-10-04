/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import * as path from 'path';
import { Uri, window } from 'vscode';
import { AzureParentTreeItem, AzureTreeItem, DialogResponses, UserCancelledError } from 'vscode-azureextensionui';
import { StorageAccountKeyWrapper, StorageAccountWrapper } from "../../components/storageWrappers";

export class TableTreeItem extends AzureTreeItem {
    constructor(
        parent: AzureParentTreeItem,
        public readonly tableName: string,
        public readonly storageAccount: StorageAccountWrapper,
        public readonly key: StorageAccountKeyWrapper) {
        super(parent);
    }

    public label: string = this.tableName;
    public contextValue: string = 'azureTable';
    public iconPath: { light: string | Uri; dark: string | Uri } = {
        light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'light', 'AzureTable_16x.png'),
        dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'dark', 'AzureTable_16x.png')
    };

    public async deleteTreeItemImpl(): Promise<void> {
        const message: string = `Are you sure you want to delete table '${this.label}' and all its contents?`;
        const result = await window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const tableService = azureStorage.createTableService(this.storageAccount.name, this.key.value);
            await new Promise((resolve, reject) => {
                // tslint:disable-next-line:no-any
                tableService.deleteTable(this.tableName, (err?: any) => {
                    // tslint:disable-next-line:no-void-expression // Grandfathered in
                    err ? reject(err) : resolve();
                });
            });
        } else {
            throw new UserCancelledError();
        }
    }
}
