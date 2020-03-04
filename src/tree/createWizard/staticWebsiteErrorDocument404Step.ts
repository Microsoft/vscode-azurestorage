/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { IStaticWebsiteConfigWizardContext } from "./IStaticWebsiteConfigWizardContext";

export class StaticWebsiteErrorDocument404Step extends AzureWizardPromptStep<IStaticWebsiteConfigWizardContext> {
    static readonly defaultErrorDocument404Path: string = 'index.html';

    public constructor(private oldErrorDocument404Path?: string) {
        super();
    }

    public async prompt(wizardContext: IStaticWebsiteConfigWizardContext): Promise<void> {
        wizardContext.errorDocument404Path = await ext.ui.showInputBox({
            prompt: localize('enterThe404ErrorDocumentPath', 'Enter the 404 error document path'),
            value: this.oldErrorDocument404Path || StaticWebsiteErrorDocument404Step.defaultErrorDocument404Path,
            validateInput: this.validateErrorDocumentName
        });
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private validateErrorDocumentName(documentPath: string): undefined | string {
        const minLengthDocumentPath = 3;
        const maxLengthDocumentPath = 255;
        if (documentPath) {
            if (documentPath.startsWith('/') || documentPath.endsWith('/')) {
                return localize('errorDocumentCannotStartOrEndWithForwardSlash', 'The error document path start or end with a "/" character.');
            } else if (documentPath.length < minLengthDocumentPath || documentPath.length > maxLengthDocumentPath) {
                return localize('errorDocumentPathLengthIsInvalid', `The error document path must be between ${minLengthDocumentPath} and ${maxLengthDocumentPath} characters in length.`);
            }
        }
        return undefined;
    }
}
