/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as gulp from 'gulp';
import * as path from 'path';
import { gulp_installAzureAccount, gulp_installResourceGroups, gulp_webpack } from 'vscode-azureextensiondev';
import { workspaceFsUtils } from './src/utils/workspaceFsUtils';

async function prepareForWebpack(): Promise<void> {
    const mainJsPath: string = path.join(__dirname, 'main.js');
    let contents: string = (await workspaceFsUtils.readFile(mainJsPath)).toString();
    contents = contents
        .replace('out/src/extension', 'dist/extension.bundle')
        .replace(', true /* ignoreBundle */', '');
    await workspaceFsUtils.writeFile(mainJsPath, contents);
}

async function cleanReadme(): Promise<void> {
    const readmePath: string = path.join(__dirname, 'README.md');
    let data: string = (await workspaceFsUtils.readFile(readmePath)).toString();
    data = data.replace(/<!-- region exclude-from-marketplace -->.*?<!-- endregion exclude-from-marketplace -->/gis, '');
    await workspaceFsUtils.writeFile(readmePath, data);
}

async function setAzCopyExePermissions(): Promise<void> {
    if (process.platform === 'darwin') {
        cp.exec(`chmod u+x ${path.join(__dirname, 'node_modules/@azure-tools/azcopy-darwin/dist/bin/azcopy_darwin_amd64')}`);
    } else if (process.platform === 'linux') {
        cp.exec(`chmod u+x ${path.join(__dirname, 'node_modules/@azure-tools/azcopy-linux/dist/bin/azcopy_linux_amd64')}`);
    }
}

exports['webpack-dev'] = gulp.series(prepareForWebpack, () => gulp_webpack('development'));
exports['webpack-prod'] = gulp.series(prepareForWebpack, () => gulp_webpack('production'));
exports.preTest = gulp.series(gulp_installAzureAccount, gulp_installResourceGroups);
exports.cleanReadme = cleanReadme;
exports.setAzCopyExePermissions = setAzCopyExePermissions;
