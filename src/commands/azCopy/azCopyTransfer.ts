/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzCopyClient, AzCopyLocation, FromToOption, ICopyOptions, ILocalLocation, IRemoteSasLocation, TransferStatus } from "@azure-tools/azcopy-node";
import { IJobInfo } from "@azure-tools/azcopy-node/dist/src/IJobInfo";
import { ExitJobStatus, ITransferStatus, ProgressJobStatus } from "@azure-tools/azcopy-node/dist/src/Output/TransferStatus";
import { CancellationToken, Uri } from 'vscode';
import { IActionContext } from "vscode-azureextensionui";
import { NotificationProgress } from "../../constants";
import { ext } from '../../extensionVariables';
import { TransferProgress } from "../../TransferProgress";
import { delay } from "../../utils/delay";
import { throwIfCanceled } from "../../utils/errorUtils";
import { localize } from "../../utils/localize";

interface ITransferLocation {
    src: AzCopyLocation;
    dst: AzCopyLocation;
}

type AzCopyTransferStatus = ITransferStatus<"Progress", ProgressJobStatus> | ITransferStatus<"EndOfJob", ExitJobStatus> | undefined;

export async function azCopyTransfer(
    context: IActionContext,
    fromTo: FromToOption,
    src: ILocalLocation | IRemoteSasLocation,
    dst: ILocalLocation | IRemoteSasLocation,
    transferProgress: TransferProgress,
    notificationProgress?: NotificationProgress,
    cancellationToken?: CancellationToken
): Promise<void> {
    // `followSymLinks: true` causes downloads to fail (which is expected) but it currently doesn't work as expected for uploads: https://github.com/Azure/azure-storage-azcopy/issues/1174
    // So it's omitted from `copyOptions` for now
    const copyOptions: ICopyOptions = { fromTo, overwriteExisting: "true", recursive: true, excludePath: '.git/;.vscode/' };
    const jobInfo: IJobInfo = await startAndWaitForTransfer(context, { src, dst }, copyOptions, transferProgress, notificationProgress, cancellationToken);
    await handleJob(context, jobInfo, src.path);
}

async function handleJob(context: IActionContext, jobInfo: IJobInfo, transferLabel: string): Promise<void> {
    const finalTransferStatus: AzCopyTransferStatus = jobInfo.latestStatus;
    context.telemetry.properties.jobStatus = finalTransferStatus?.JobStatus;
    if (!finalTransferStatus || finalTransferStatus.JobStatus !== 'Completed') {
        // tslint:disable-next-line: strict-boolean-expressions
        let message: string = jobInfo.errorMessage || localize('azCopyTransfer', 'AzCopy Transfer: "{0}". ', finalTransferStatus?.JobStatus || 'Failed');
        if (finalTransferStatus?.FailedTransfers?.length || finalTransferStatus?.SkippedTransfers?.length) {
            message += localize('checkOutputWindow', ' Check the [output window](command:{0}) for a list of incomplete transfers.', `${ext.prefix}.showOutputChannel`);

            if (finalTransferStatus.FailedTransfers?.length) {
                ext.outputChannel.appendLog(localize('failedTransfers', 'Failed transfer(s):'));
                for (let failedTransfer of finalTransferStatus.FailedTransfers) {
                    ext.outputChannel.appendLog(`\t${failedTransfer.Dst}`);
                }
            }
            if (finalTransferStatus.SkippedTransfers?.length) {
                ext.outputChannel.appendLog(localize('skippedTransfers', 'Skipped transfer(s):'));
                for (let skippedTransfer of finalTransferStatus.SkippedTransfers) {
                    ext.outputChannel.appendLog(`\t${skippedTransfer.Dst}`);
                }
            }
        } else {
            // Add an additional error log since we don't have any more info about the failure
            ext.outputChannel.appendLog(localize('couldNotTransfer', 'Could not transfer "{0}"', transferLabel));
        }

        if (jobInfo.logFileLocation) {
            const uri: Uri = Uri.file(jobInfo.logFileLocation);
            ext.outputChannel.appendLog(localize('logFile', 'Log file: {0}', uri.toString()));
        }

        message += finalTransferStatus?.ErrorMsg ? ` ${finalTransferStatus.ErrorMsg}` : '';

        if (finalTransferStatus?.JobStatus && /CompletedWith*/gi.test(finalTransferStatus.JobStatus)) {
            void ext.ui.showWarningMessage(message);
        } else {
            throw new Error(message);
        }
    }
}

async function startAndWaitForTransfer(
    context: IActionContext,
    location: ITransferLocation,
    options: ICopyOptions,
    transferProgress: TransferProgress,
    notificationProgress?: NotificationProgress,
    cancellationToken?: CancellationToken
): Promise<IJobInfo> {
    const copyClient: AzCopyClient = new AzCopyClient();
    const jobId: string = await copyClient.copy(location.src, location.dst, options);

    // Directory transfers always have `useWildCard` set
    const displayWorkAsTotalTransfers: boolean = location.src.useWildCard;

    let status: TransferStatus | undefined;
    let finishedWork: number;
    let totalWork: number | undefined;
    while (!status || status.StatusType !== 'EndOfJob') {
        throwIfCanceled(cancellationToken, context.telemetry.properties, 'startAndWaitForTransfer');
        status = (await copyClient.getJobInfo(jobId)).latestStatus;

        // tslint:disable: strict-boolean-expressions
        totalWork = (displayWorkAsTotalTransfers ? status?.TotalTransfers : status?.TotalBytesEnumerated) || undefined;
        finishedWork = (displayWorkAsTotalTransfers ? status?.TransfersCompleted : status?.BytesOverWire) || 0;
        // tslint:enable: strict-boolean-expressions

        if (totalWork || transferProgress.totalWork) {
            // Only report progress if we have `totalWork`
            transferProgress.reportToOutputWindow(finishedWork, totalWork);
            if (!!notificationProgress) {
                transferProgress.reportToNotification(finishedWork, notificationProgress);
            }
        }
        await delay(1000);
    }

    return await copyClient.getJobInfo(jobId);
}
