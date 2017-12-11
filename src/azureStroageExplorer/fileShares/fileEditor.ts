/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileNode } from './fileNode';
import * as azureStorage from "azure-storage";
import { BaseEditor } from '../../azureServiceExplorer/editors/baseEditor';
import { AzureStorageOutputChanel } from '../azureStorageOutputChannel';

export class FileEditor extends BaseEditor<FileNode> {
    constructor() {
        super("azureStorage.file.showSavePrompt", AzureStorageOutputChanel)
    }

    async getSaveConfirmationText(node: FileNode): Promise<string> {
        return `Saving '${node.file.name}' will update the file "${node.file.name}" in File Share "${node.share.name}"`;
    }

    async getFilename(node: FileNode): Promise<string> {
        return node.file.name;
    }

    async getSize(node: FileNode): Promise<number> {
        return Number(node.file.contentLength)/(1024*1024);
    }

    async getData(node: FileNode): Promise<string> {
        var fileService = azureStorage.createFileService(node.storageAccount.name, node.key.value);
        return await new Promise<string>((resolve, reject) => {
            fileService.getFileToText(node.share.name, node.directory, node.file.name, undefined, (error: Error, text: string, _result: azureStorage.FileService.FileResult, _response: azureStorage.ServiceResponse) => {
                if(!!error) {
                    reject(error)
                } else {
                    resolve(text);
                }
            });
        });
    }

    async updateData(node: FileNode, data: string): Promise<string> {
        var fileService = azureStorage.createFileService(node.storageAccount.name, node.key.value);
        var fileProperties = await this.getProperties(node);
        var createOptions: azureStorage.FileService.CreateFileRequestOptions = {};
        
        if(fileProperties && fileProperties.contentSettings && fileProperties.contentSettings.contentType){
            createOptions.contentSettings = { contentType: fileProperties.contentSettings.contentType };
        }

        await new Promise<string>((resolve, reject) => {
            fileService.createFileFromText(node.share.name, node.directory, node.file.name, data, createOptions, async (error: Error, _result: azureStorage.FileService.FileResult, _response: azureStorage.ServiceResponse) => {
                if(!!error) {
                    var errorAny = <any>error;                
                    if(!!errorAny.code) {
                        var humanReadableMessage = `Unable to save '${node.file.name}' file service returned error code "${errorAny.code}"`;
                        switch(errorAny.code) {
                            case "ENOTFOUND":
                                humanReadableMessage += " - Please check connection."
                            break;
                        }
                        reject(humanReadableMessage);
                    } else {
                        reject(error);
                    }     
                } else {
                    resolve();
                }
            });
        });

        return await this.getData(node);
    }

    private async getProperties(node: FileNode): Promise<azureStorage.FileService.FileResult> {
        var fileService = azureStorage.createFileService(node.storageAccount.name, node.key.value);

        return await new Promise<azureStorage.FileService.FileResult>((resolve, reject) => {
            fileService.getFileProperties(node.share.name, node.directory, node.file.name, (error: Error, result: azureStorage.FileService.FileResult, _response: azureStorage.ServiceResponse) => {
                if(!!error) {
                    var errorAny = <any>error;                
                    if(!!errorAny.code) {
                        var humanReadableMessage = `Unable to retrieve properties for '${node.file.name}' file service returned error code "${errorAny.code}"`;
                        switch(errorAny.code) {
                            case "ENOTFOUND":
                                humanReadableMessage += " - Please check connection."
                            break;
                        }
                        reject(humanReadableMessage);
                    } else {
                        reject(error);
                    }     
                } else {
                    resolve(result);
                }
            });
        });
    }
}