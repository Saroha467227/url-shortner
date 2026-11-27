import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseLink } from '../src/links.js';

test('valid links keep their path, query and fragment', () => {
  assert.deepEqual(parseLink({ url: 'https://example.org/learn?a=1#intro' }), {
    destination: 'https://example.org/learn?a=1#intro', seconds: null
  });
});

test('only web addresses and integer lifetimes are accepted', () => {
  for (const url of ['hello', 'file:///example', 'https://name:pass@example.org', 10]) {
    assert.throws(() => parseLink({ url }));
  }
  for (const seconds of [0, -2, 1.5, '60', 31536001]) {
    assert.throws(() => parseLink({ url: 'http://example.org', expiresInSeconds: seconds }));
  }
});
