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
import * as types from '@opentelemetry/api';
import { TraceFlags } from '@opentelemetry/api';
import { VERSION as CORE_VERSION } from '@opentelemetry/core';
import { Resource } from '@opentelemetry/resources';
import { ReadableSpan } from '@opentelemetry/tracing';
import * as assert from 'assert';
import { getReadableSpanTransformer } from '../src/transform';
import { 
  cloudtracev2,
  protobuf,
  rpc,
} from '../src/types';
import { VERSION } from '../src/version';

describe('transform', () => {
  let readableSpan: ReadableSpan;
  let transformer: (readableSpan: ReadableSpan) => cloudtracev2.Span;
  let spanContext: types.SpanContext;

  beforeEach(() => {
    spanContext = {
      traceId: 'd4cda95b652f4a1592b449d5929fda1b',
      spanId: '6e0c63257de34c92',
      traceFlags: TraceFlags.NONE,
      isRemote: true,
    };

    transformer = getReadableSpanTransformer('project-id');

    readableSpan = {
      attributes: {},
      duration: [32, 800000000],
      startTime: [1566156729, 709],
      endTime: [1566156731, 709],
      ended: true,
      events: [],
      kind: types.SpanKind.CLIENT,
      links: [],
      name: 'my-span',
      spanContext,
      status: { code: types.CanonicalCode.OK },
      resource: new Resource({
        service: 'ui',
        version: 1,
        cost: 112.12,
      }),
    };
  });

  it('should transform spans', () => {
    const result = transformer(readableSpan);
    const attributes = cloudtracev2.Span.Attributes.create({
      attributeMap: {
        project_id: cloudtracev2.AttributeValue.create({
          stringValue: cloudtracev2.TruncatableString.create({
            value: 'project-id',
          }),
        }),
        'g.co/agent': cloudtracev2.AttributeValue.create({
          stringValue: cloudtracev2.TruncatableString.create({
            value: `opentelemetry-js ${CORE_VERSION}; google-cloud-trace-exporter ${VERSION}`,
          }),
        }),
        cost: cloudtracev2.AttributeValue.create({
          intValue: 112,
        }),
        service: cloudtracev2.AttributeValue.create({
          stringValue: cloudtracev2.TruncatableString.create({
            value: 'ui',
          }),
        }),
        version: cloudtracev2.AttributeValue.create({
          intValue: 1,
        }),
      },
      droppedAttributesCount: 0,
    });
    const expectedSpan = cloudtracev2.Span.create({
      attributes,
      displayName: cloudtracev2.TruncatableString.create({
        value: 'my-span',
      }),
      links: cloudtracev2.Span.Links.create(),
      endTime: protobuf.Timestamp.create({ seconds: 1566156731, nanos: 709 }),
      startTime: protobuf.Timestamp.create({ seconds: 1566156729, nanos: 709 }),
      name: 'projects/project-id/traces/d4cda95b652f4a1592b449d5929fda1b/spans/6e0c63257de34c92',
      spanId: '6e0c63257de34c92',
      status: rpc.Status.create({
        code: 0,
      }),
      timeEvents: cloudtracev2.Span.TimeEvents.create(),
      sameProcessAsParentSpan: protobuf.BoolValue.create({ value: false }),
    });

    assert.deepStrictEqual(result, expectedSpan);
  });

  it('should transform spans with parent', () => {
    /* tslint:disable-next-line:no-any */
    (readableSpan as any).parentSpanId = '3e0c63257de34c92';
    const result = transformer(readableSpan);
    assert.deepStrictEqual(result.parentSpanId, '3e0c63257de34c92');
  });

  it('should transform spans without parent', () => {
    const result = transformer(readableSpan);
    assert.deepStrictEqual(result.parentSpanId, '');
  });

  it('should transform remote spans', () => {
    const remote = transformer(readableSpan);
    assert.deepStrictEqual(remote.sameProcessAsParentSpan, protobuf.BoolValue.create({
      value: false,
    }));
  });

  it('should transform local spans', () => {
    readableSpan.spanContext.isRemote = false;
    const local = transformer(readableSpan);
    assert.deepStrictEqual(local.sameProcessAsParentSpan, protobuf.BoolValue.create({
      value: true,
    }));
  });

  it('should transform attributes', () => {
    readableSpan.attributes.testBool = true;
    readableSpan.attributes.testInt = 3;
    readableSpan.attributes.testString = 'str';

    const result = transformer(readableSpan);
    const attributeMap = result.attributes!.attributeMap!;

    assert.deepStrictEqual(attributeMap.testBool, cloudtracev2.AttributeValue.create({
      boolValue: true,
    }));
    assert.deepStrictEqual(attributeMap.testInt, cloudtracev2.AttributeValue.create({
      intValue: 3,
    }));
    assert.deepStrictEqual(attributeMap.testString, cloudtracev2.AttributeValue.create({
      stringValue: cloudtracev2.TruncatableString.create({ value: 'str' }),
    }));
    assert.deepStrictEqual(result.attributes!.droppedAttributesCount, 0);
  });

  it('should drop unknown attribute types', () => {
    readableSpan.attributes.testUnknownType = { message: 'dropped' };
    const result = transformer(readableSpan);
    assert.deepStrictEqual(result.attributes!.droppedAttributesCount, 1);
    assert.deepStrictEqual(
      Object.keys(result.attributes!.attributeMap!).length,
      5
    );
  });

  it('should transform links', () => {
    readableSpan.links.push({
      context: {
        traceId: 'a4cda95b652f4a1592b449d5929fda1b',
        spanId: '3e0c63257de34c92',
      },
    });

    const result = transformer(readableSpan);
    
    const expectedLink = cloudtracev2.Span.Link.create({
      attributes: cloudtracev2.Span.Attributes.create({
        attributeMap: {},
        droppedAttributesCount: 0,
      }),
      traceId: 'a4cda95b652f4a1592b449d5929fda1b',
      spanId: '3e0c63257de34c92',
      type: cloudtracev2.Span.Link.Type.TYPE_UNSPECIFIED,
    });
    const expectedLinks = cloudtracev2.Span.Links.create({
      link: [expectedLink]
    });
    assert.deepStrictEqual(result.links, expectedLinks);
  });

  it('should transform links with attributes', () => {
    readableSpan.links.push({
      context: {
        traceId: 'a4cda95b652f4a1592b449d5929fda1b',
        spanId: '3e0c63257de34c92',
      },
      attributes: {
        testAttr: 'value',
        droppedAttr: {},
      },
    });

    const result = transformer(readableSpan);
    const expectedLink = cloudtracev2.Span.Link.create({
      attributes: cloudtracev2.Span.Attributes.create({
        attributeMap: {
          testAttr: cloudtracev2.AttributeValue.create({
            stringValue: cloudtracev2.TruncatableString.create({value: 'value'})
          }),
        },
        droppedAttributesCount: 1,
      }),
      traceId: 'a4cda95b652f4a1592b449d5929fda1b',
      spanId: '3e0c63257de34c92',
      type: cloudtracev2.Span.Link.Type.TYPE_UNSPECIFIED,
    });
    const expectedLinks = cloudtracev2.Span.Links.create({
      link: [expectedLink],
    })
    

    assert.deepStrictEqual(result.links, expectedLinks);
  });

  it('should transform events', () => {
    readableSpan.events.push({
      name: 'something happened',
      time: [1566156729, 809],
    });

    const result = transformer(readableSpan);
    const expectedTimeEvent = cloudtracev2.Span.TimeEvent.create({
      annotation: cloudtracev2.Span.TimeEvent.Annotation.create({
        attributes: cloudtracev2.Span.Attributes.create({
          attributeMap: {},
          droppedAttributesCount: 0,
        }),
        description: cloudtracev2.TruncatableString.create({
          value: 'something happened',
        })
      }),
      time: protobuf.Timestamp.create({
        seconds: 1566156729,
        nanos: 809,
      }) 
    });
    const expectedTimeEvents = cloudtracev2.Span.TimeEvents.create({
      timeEvent: [expectedTimeEvent],
    });

    assert.deepStrictEqual(result.timeEvents, expectedTimeEvents);
  });

  it('should transform events with attributes', () => {
    readableSpan.events.push({
      name: 'something happened',
      attributes: {
        error: true,
        dropped: {},
      },
      time: [1566156729, 809],
    });

    const result = transformer(readableSpan);
    const expectedTimeEvent = cloudtracev2.Span.TimeEvent.create({
      annotation: cloudtracev2.Span.TimeEvent.Annotation.create({
        attributes: cloudtracev2.Span.Attributes.create({
          attributeMap: {
            error: cloudtracev2.AttributeValue.create({
              boolValue: true,
            }),
          },
          droppedAttributesCount: 1,
        }),
        description: cloudtracev2.TruncatableString.create({
          value: 'something happened',
        }),
      }),
      time: protobuf.Timestamp.create({
        seconds: 1566156729,
        nanos: 809,
      }),
    });
    const expectedTimeEvents = cloudtracev2.Span.TimeEvents.create({
      timeEvent: [expectedTimeEvent],
    });

    assert.deepStrictEqual(result.timeEvents, expectedTimeEvents);
  });
});
