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

import * as ot from '@opentelemetry/api';
import { VERSION as CORE_VERSION } from '@opentelemetry/core';
import { Resource } from '@opentelemetry/resources';
import { ReadableSpan } from '@opentelemetry/tracing';
import {
  cloudtracev2,
  protobuf,
  rpc,
} from './types';
import { VERSION } from './version';


const AGENT_LABEL_KEY = 'g.co/agent';
const AGENT_LABEL_VALUE = `opentelemetry-js ${CORE_VERSION}; google-cloud-trace-exporter ${VERSION}`;

export function getReadableSpanTransformer(
  projectId: string
): (span: ReadableSpan) => cloudtracev2.Span {
  return span => {
    const attributes = transformAttributes(
      span.attributes,
      {
        project_id: projectId,
        [AGENT_LABEL_KEY]: AGENT_LABEL_VALUE,
      },
      span.resource
    );

    const out = cloudtracev2.Span.create({
      attributes,
      displayName: stringToTruncatableString(span.name),
      links: transformLinks(span.links),
      endTime: transformTime(span.endTime),
      startTime: transformTime(span.startTime),
      name: `projects/${projectId}/traces/${span.spanContext.traceId}/spans/${span.spanContext.spanId}`,
      spanId: span.spanContext.spanId,
      sameProcessAsParentSpan: transformBool(!span.spanContext.isRemote),
      status: transformStatus(span.status),
      timeEvents: transformTimeEvents(span.events),
    });

    if (span.parentSpanId) {
      out.parentSpanId = span.parentSpanId;
    }

    return out;
  };
}

function transformBool(value: boolean): protobuf.BoolValue {
  return protobuf.BoolValue.create({
    value,
  });
}

function transformTime(time: ot.HrTime): protobuf.Timestamp {
  return protobuf.Timestamp.create({
    seconds: time[0],
    nanos: time[1],
  });
}

function transformStatus(status: ot.Status): rpc.Status {
  return rpc.Status.create({
    code: status.code,
    message: status.message,
  });
}

function transformLinks(links: ot.Link[]): cloudtracev2.Span.Links {
  return cloudtracev2.Span.Links.create({
    link: links.map(transformLink),
  });
}

function transformLink(link: ot.Link): cloudtracev2.Span.Link {
  return cloudtracev2.Span.Link.create({
    attributes: transformAttributes(link.attributes),
    spanId: link.context.spanId,
    traceId: link.context.traceId,
    type: cloudtracev2.Span.Link.Type.TYPE_UNSPECIFIED,
  });
}

function transformAttributes(
  requestAttributes: ot.Attributes = {},
  serviceAttributes: ot.Attributes = {},
  resource: Resource = Resource.empty()
): cloudtracev2.Span.Attributes {
  const attributes = Object.assign(
    {},
    requestAttributes,
    serviceAttributes,
    resource.labels
  );

  const attributeMap = transformAttributeValues(attributes);
  return cloudtracev2.Span.Attributes.create({
    attributeMap,
    // @todo get dropped attribute count from sdk ReadableSpan
    droppedAttributesCount:
      Object.keys(attributes).length - Object.keys(attributeMap).length,
  });
}

function transformAttributeValues(attributes: ot.Attributes): {[key: string]: cloudtracev2.AttributeValue} {
  const out: {[key: string]: cloudtracev2.AttributeValue} = {};
  for (const [key, value] of Object.entries(attributes)) {
    switch (typeof value) {
      case 'number':
      case 'boolean':
      case 'string':
        out[key] = valueToAttributeValue(value);
        break;
      default:
        break;
    }
  }
  return out;
}

function stringToTruncatableString(value: string): cloudtracev2.TruncatableString {
  return cloudtracev2.TruncatableString.create({
    value,
  });
}

function valueToAttributeValue(
  value: string | number | boolean
): cloudtracev2.AttributeValue {
  const attributeValue = cloudtracev2.AttributeValue.create();
  switch (typeof value) {
    case 'number':
      // TODO: Consider to change to doubleValue when available in V2 API.
      attributeValue.intValue = Math.round(value);
      break;
    case 'boolean':
      attributeValue.boolValue = value;
      break;
    case 'string':
      attributeValue.stringValue = stringToTruncatableString(value);
  }
  return attributeValue;
}

function transformTimeEvents(events: ot.TimedEvent[]): cloudtracev2.Span.TimeEvents {
  return cloudtracev2.Span.TimeEvents.create({
    timeEvent: events.map(transformTimeEvent),
  });
}

function transformTimeEvent(event: ot.TimedEvent): cloudtracev2.Span.TimeEvent {
  return cloudtracev2.Span.TimeEvent.create({
    time: transformTime(event.time),
    annotation: cloudtracev2.Span.TimeEvent.Annotation.create({
      attributes: transformAttributes(event.attributes),
      description: stringToTruncatableString(event.name),
    }),
  });
}
