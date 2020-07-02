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

/**
 * Generates the .js and .d.ts file bundles from the proto files
 */

const pbjs = require('protobufjs/cli/pbjs');
const pbts = require('protobufjs/cli/pbts');
const { mkdirSync, existsSync } = require('fs');
const { join } = require('path');

/**
 * Compiles protocol buffers to directory
 * @param {string} directory 
 * @param {Array<string>} jsArgs 
 * @param {Array<string>} tsArgs 
 */
const compile = (directory, jsArgs = [], tsArgs = []) => {
  return new Promise((resolve, reject) => {
    const path = join(__dirname, directory);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
    
    pbjs.main([
      ...jsArgs,
      /* Include the entire directory of protofiles in build path */
      '--path', './node_modules/google-proto-files',
      '--target', 'static-module',
      '--wrapper', 'comonjs',
      '--out', `${directory}/proto-bundle.js`,
      /* Files to inclde */
      'google/devtools/cloudtrace/v2/tracing.proto',
      'google/devtools/cloudtrace/v2/trace.proto',
    ], (err, output) => {
      if (err) {
        return reject(new Error(`Proto file generation failed: ${err.message}`));
      }
    });
    
    /**
     * Use the generated js file to produce typescript
     * type declarations
     */
    pbts.main([
      ...tsArgs,
      '--out', `${directory}/proto-bundle.d.ts`,
      /* Path of js bundle to create types from */
      'src/proto-bundle.js'
    ], (err) => {
      if (err) {
        return reject(new Error(`Proto file generation failed: ${err.message}`));
      }
    });
    resolve();
  });
}

Promise.all([
  compile('src'),
  compile('build/src', ['--no-beautify', '--no-comments'], ['--no-comments'])
]).catch(e => {
  process.exitCode = 1;
  console.log(e.message);
});



