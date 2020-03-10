/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { DocumentType, validateDocumentPath } from "../../utils/validateNames";
import { IStaticWebsiteConfigWizardContext } from "./IStaticWebsiteConfigWizardContext";

export class StaticWebsiteIndexDocumentStep extends AzureWizardPromptStep<IStaticWebsiteConfigWizardContext> {
    static readonly defaultIndexDocument: string = 'index.html';
    private oldIndexDocument: string | undefined;

    public constructor(oldIndexDocument?: string) {
        super();
        this.oldIndexDocument = oldIndexDocument;
    }

    public async prompt(wizardContext: IStaticWebsiteConfigWizardContext): Promise<void> {
        wizardContext.indexDocument = await ext.ui.showInputBox({
            prompt: localize('enterTheIndexDocumentName', 'Enter the index document name'),
            value: this.oldIndexDocument || StaticWebsiteIndexDocumentStep.defaultIndexDocument,
            validateInput: (value) => { return validateDocumentPath(value, DocumentType.index); }
        });
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
