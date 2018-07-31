/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import { ext } from '../../extensionVariables';

export class Reporter extends vscode.Disposable {
    constructor(ctx: vscode.ExtensionContext) {
        // tslint:disable-next-line:promise-function-async // Grandfathered in
        super(() => ext.reporter.dispose());

        let packageInfo = getPackageInfo(ctx);
        if (packageInfo) {
            ext.reporter = new TelemetryReporter(packageInfo.name, packageInfo.version, packageInfo.aiKey);
        }
    }
}

interface IPackageInfo {
    name: string;
    version: string;
    aiKey: string;
}

function getPackageInfo(context: vscode.ExtensionContext): IPackageInfo | undefined {
    // tslint:disable-next-line:non-literal-require
    let extensionPackage = <{ [key: string]: string }>require(context.asAbsolutePath('./package.json'));
    return {
        name: extensionPackage.name,
        version: extensionPackage.version,
        aiKey: extensionPackage.aiKey
    };
}
