/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StorageAccount } from '@azure/arm-storage/esm/models';
import { HttpOperationResponse, ServiceClient } from '@azure/ms-rest-js';
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { createGenericClient, delay, ext, getRandomHexString, IActionContext, StorageAccountTreeItem } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput } from '../global.test';
import { resourceGroupsToDelete, webSiteClient } from './global.resource.test';

suite('Deploy', function (this: Mocha.Suite): void {
    this.timeout(800 * 1000);

    suiteSetup(function (this: Mocha.Context): void {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
    });

    test("deployStaticWebsite", async () => {
        const resourceName: string = getRandomHexString().toLowerCase();
        resourceGroupsToDelete.push(resourceName);
        const context: IActionContext = { telemetry: { properties: {}, measurements: {} }, errorHandling: { issueProperties: {} }, ui: testUserInput, valuesToMask: [] };
        const testFolderPath: string = getWorkspacePath('html-hello-world');
        await testUserInput.runWithInputs([testFolderPath, /create new storage account/i, resourceName], async () => {
            await vscode.commands.executeCommand('azureStorage.deployStaticWebsite');
        });
        const createdAccount: StorageAccount = await webSiteClient.storageAccounts.getProperties(resourceName, resourceName);
        const webUrl: string | undefined = (<StorageAccountTreeItem>await ext.tree.findTreeItem(<string>createdAccount.id, context)).root.primaryEndpoints?.web;
        const client: ServiceClient = await createGenericClient();
        console.log('00000000000000000000000000');
        console.log(webUrl);
        await validateWebSite(webUrl, client, 600 * 1000, 1000);
    })
});

// The workspace folder that vscode is opened against for tests
function getWorkspacePath(testWorkspaceName: string): string {
    let workspacePath: string = '';
    const workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error("No workspace is open");
    } else {
        for (const projectFolder of workspaceFolders) {
            if (projectFolder.name === testWorkspaceName) {
                workspacePath = projectFolder.uri.fsPath;
            }
        }
        assert.strictEqual(path.basename(workspacePath), testWorkspaceName, "Opened against an unexpected workspace.");
        return workspacePath;
    }
}

// Polling to send the request within the maximum time
async function validateWebSite(webUrl: string | undefined, client: ServiceClient, maximumValidationMs: number, pollingMs: number) {
    const endTime: number = Date.now() + maximumValidationMs;
    let response: HttpOperationResponse;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        response = await client.sendRequest({ method: 'GET', url: webUrl });
        if (response.bodyAsText?.includes('Hello World!')) {
            assert.ok(true);
        } else if (Date.now() > endTime) {
            assert.fail();
        }
        await delay(pollingMs);
    }
}
