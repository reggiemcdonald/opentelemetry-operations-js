// Copyright 2020 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { ExportResult } from '@opentelemetry/base';
import { NoopLogger } from '@opentelemetry/core';
import { ReadableSpan, SpanExporter } from '@opentelemetry/tracing';
import { Logger } from '@opentelemetry/api';
import * as grpc from 'grpc';
import { GoogleAuth } from 'google-auth-library';
import { TraceExporterOptions } from './external-types';
import { getReadableSpanTransformer } from './transform';
import { cloudtracev2 } from './types';

/**
 * Format and sends span information to Google Cloud Trace.
 */
export class TraceExporter implements SpanExporter {
  private _projectId: string | void | Promise<string | void>;
  private readonly _logger: Logger;
  private readonly _auth: GoogleAuth;
  private _traceServiceClient?: cloudtracev2.TraceService = undefined;

  constructor(options: TraceExporterOptions = {}) {
    this._logger = options.logger || new NoopLogger();

    this._auth = new GoogleAuth({
      credentials: options.credentials,
      keyFile: options.keyFile,
      keyFilename: options.keyFilename,
      projectId: options.projectId,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    // Start this async process as early as possible. It will be
    // awaited on the first export because constructors are synchronous
    this._projectId = this._auth.getProjectId().catch(err => {
      this._logger.error(err);
    });
  }

  /**
   * Publishes a list of spans to Google Cloud Trace.
   * @param spans The list of spans to transmit to Google Cloud Trace
   */
  async export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void
  ): Promise<void> {
    if (this._projectId instanceof Promise) {
      this._projectId = await this._projectId;
    }

    if (!this._projectId) {
      return resultCallback(ExportResult.FAILED_NOT_RETRYABLE);
    }

    this._logger.debug('Google Cloud Trace export');

    const request = cloudtracev2.BatchWriteSpansRequest.create({
      name: `projects/${this._projectId}`,
      spans: spans.map(getReadableSpanTransformer(this._projectId)),
    });

    const result = await this._batchWriteSpans(request);
    resultCallback(result);
  }

  shutdown(): void {}

  /**
   * Sends new spans to new or existing traces in the Google Cloud Trace format to the
   * service.
   * @param spans
   */
  private _batchWriteSpans(request: cloudtracev2.BatchWriteSpansRequest): Promise<ExportResult> {
    this._logger.debug('Google Cloud Trace batch writing traces');
    // Always resolve with the ExportResult code
    return new Promise(async resolve => {
      if (!this._traceServiceClient) {
        try {
          this._traceServiceClient = await this._getClient();
        } catch (err) {
          err.message = `authorize error: ${err.message}`;
          this._logger.error(err.message);
          return resolve(ExportResult.FAILED_NOT_RETRYABLE);
        }
      }
      
      this._traceServiceClient.batchWriteSpans(request, (err: Error | null) => {
        if (err) {
          err.message = `batchWriteSpans error: ${err.message}`;
          this._logger.error(err.message);
          resolve(ExportResult.FAILED_RETRYABLE);
        } else {
          const successMsg = 'batchWriteSpans successfully';
          this._logger.debug(successMsg);
          resolve(ExportResult.SUCCESS);
        }
      });
    });
  }

  /**
   * If the rpc client is not already initialized,
   * authenticates with google credentials and initializes the rpc client
   */
  private async _getClient(): Promise<cloudtracev2.TraceService> {
    this._logger.debug('Google Cloud Trace authenticating');
    const creds = await this._auth.getClient();
    this._logger.debug(
      'Google Cloud Trace got authentication. Initializaing rpc client'
    );
    const sslCreds = grpc.credentials.createSsl();
    const callCreds = grpc.credentials.createFromGoogleCredential(creds);
    const grpcClient = new grpc.Client(
      'cloudtrace.googleapis.com',
      grpc.credentials.combineChannelCredentials(sslCreds, callCreds)  
    );
    const trace = new cloudtracev2.TraceService((method, requestData, callback) => {
      grpcClient.makeUnaryRequest(
        `/google.devtools.cloudtrace.v2.TraceService/${method.name}`,
        arg => Buffer.from(arg),
        arg => arg,
        requestData,
        null,
        null,
        callback
      );
    });
    return trace;
  }
}
