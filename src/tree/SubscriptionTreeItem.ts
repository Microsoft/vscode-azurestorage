/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StorageManagementClient } from 'azure-arm-storage';
import { StorageAccount } from 'azure-arm-storage/lib/models';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureTreeItem, AzureWizard, AzureWizardExecuteStep, AzureWizardPromptStep, createAzureClient, ICreateChildImplContext, IStorageAccountWizardContext, LocationListStep, ResourceGroupCreateStep, ResourceGroupListStep, StorageAccountKind, StorageAccountPerformance, StorageAccountReplication, SubscriptionTreeItemBase } from 'vscode-azureextensionui';
import { nonNull, StorageAccountWrapper } from '../utils/storageWrappers';
import { StorageAccountCreateStep } from './createWizard/storageAccountCreateStep';
import { StorageAccountNameStep } from './createWizard/storageAccountNameStep';
import { StorageAccountTreeItem } from './StorageAccountTreeItem';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public childTypeLabel: string = "Storage Account";

    async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        let storageManagementClient = createAzureClient(this.root, StorageManagementClient);
        let accounts = await storageManagementClient.storageAccounts.list();
        return this.createTreeItemsWithErrorHandling(
            accounts,
            'invalidStorageAccount',
            async (sa: StorageAccount) => await StorageAccountTreeItem.createStorageAccountTreeItem(this, new StorageAccountWrapper(sa), storageManagementClient),
            (sa: StorageAccount) => {
                return sa.name;
            }
        );
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<AzureTreeItem> {
        let storageManagementClient = createAzureClient(this.root, StorageManagementClient);
        const defaultLocation = 'westus';
        const wizardContext: IStorageAccountWizardContext = Object.assign(context, this.root);
        const promptSteps: AzureWizardPromptStep<IStorageAccountWizardContext>[] = [new StorageAccountNameStep()];
        const executeSteps: AzureWizardExecuteStep<IStorageAccountWizardContext>[] = [new StorageAccountCreateStep({ kind: StorageAccountKind.StorageV2, performance: StorageAccountPerformance.Standard, replication: StorageAccountReplication.LRS })];

        if (context.advancedCreation) {
            promptSteps.push(new ResourceGroupListStep());
            LocationListStep.addStep(wizardContext, promptSteps);
        } else {
            executeSteps.push(new ResourceGroupCreateStep());
            await LocationListStep.setLocation(wizardContext, defaultLocation);
        }

        const wizard = new AzureWizard(wizardContext, {
            title: "Create storage account",
            promptSteps,
            executeSteps
        });

        await wizard.prompt();

        if (!context.advancedCreation) {
            wizardContext.newResourceGroupName = await wizardContext.relatedNameTask;
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (progress) => {
            context.showCreatingTreeItem(nonNull(wizardContext.newStorageAccountName));
            progress.report({ message: `Creating storage account '${wizardContext.newStorageAccountName}'` });
            await wizard.execute();
        });
        return await StorageAccountTreeItem.createStorageAccountTreeItem(this, new StorageAccountWrapper(<StorageAccount>nonNull(wizardContext.storageAccount)), storageManagementClient);
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }
}
