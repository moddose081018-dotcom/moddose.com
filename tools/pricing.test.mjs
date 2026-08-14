import test from 'node:test';
import assert from 'node:assert/strict';
import { snapToApprovedPrice, loadPricePoints, applyPriceMatching } from './pricing.mjs';

const points = loadPricePoints();

test('worked examples from the price matching spec', () => {
  const cases = [
    [317, 318.00],
    [745, 790.00],
    [25,   29.90],
    [55,   49.80],
    [120, 109.00],
    [260, 249.00],
    [600, 445.00],
    [850, 890.00]
  ];
  for (const [input, expected] of cases) {
    assert.equal(snapToApprovedPrice(input, points), expected, `${input} should snap to ${expected}`);
  }
});

test('clamps outside the ladder', () => {
  assert.equal(snapToApprovedPrice(0, points), 29.90);
  assert.equal(snapToApprovedPrice(29.89, points), 29.90);
  assert.equal(snapToApprovedPrice(5000, points), 890.00);
});

test('exact ladder prices are left alone', () => {
  for (const point of points) {
    assert.equal(snapToApprovedPrice(point, points), point);
  }
});

test('ties round up', () => {
  // midpoint of 29.90 and 49.80
  assert.equal(snapToApprovedPrice(39.85, points), 49.80);
  // midpoint of 248.00 and 249.00
  assert.equal(snapToApprovedPrice(248.50, points), 249.00);
  // just below a midpoint still rounds down
  assert.equal(snapToApprovedPrice(39.84, points), 29.90);
});

test('the near-degenerate 248/249 band resolves correctly', () => {
  assert.equal(snapToApprovedPrice(248.4, points), 248.00);
  assert.equal(snapToApprovedPrice(248.6, points), 249.00);
  assert.equal(snapToApprovedPrice(249.99, points), 249.00);
});

test('applyPriceMatching preserves the source price as original_price', () => {
  const out = applyPriceMatching([{ slug: 'x', price: 122.5 }], points);
  assert.equal(out[0].price, 109.00);
  assert.equal(out[0].original_price, 122.5);
});

test('rejects non-numeric input', () => {
  assert.throws(() => snapToApprovedPrice('abc', points), TypeError);
});
