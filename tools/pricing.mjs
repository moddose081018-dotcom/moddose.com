/**
 * Moddose price matching.
 *
 * Every product price in the store must land on an approved price point.
 * At import time each source (Amazon) price is snapped to the closest
 * approved point; the untouched source price is kept as `original_price`
 * in the build-time data only and is never emitted to the client bundle.
 *
 * Rule:
 *   - pick the approved point with the smallest absolute difference
 *   - on an exact tie, round UP to the higher point
 *   - below the lowest point  -> lowest point
 *   - above the highest point -> highest point
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function loadPricePoints(file = join(here, '..', 'data', 'pricing.json')) {
  const { approvedPricePoints } = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(approvedPricePoints) || approvedPricePoints.length === 0) {
    throw new Error('pricing.json: approvedPricePoints must be a non-empty array');
  }
  return [...approvedPricePoints].sort((a, b) => a - b);
}

/**
 * Snap a price to the closest approved price point.
 * @param {number} amount        source price
 * @param {number[]} pricePoints ascending list of approved points
 * @returns {number}             an approved price point
 */
export function snapToApprovedPrice(amount, pricePoints = loadPricePoints()) {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    throw new TypeError(`snapToApprovedPrice: expected a finite number, got ${amount}`);
  }

  const points = [...pricePoints].sort((a, b) => a - b);
  const lowest = points[0];
  const highest = points[points.length - 1];

  if (value <= lowest) return lowest;
  if (value >= highest) return highest;

  let best = points[0];
  let bestDelta = Math.abs(value - best);

  for (const point of points.slice(1)) {
    // Compare in cents so floating point noise can't flip a tie.
    const delta = Math.abs(Math.round(value * 100) - Math.round(point * 100)) / 100;
    if (delta < bestDelta - 1e-9) {
      best = point;
      bestDelta = delta;
    } else if (Math.abs(delta - bestDelta) <= 1e-9 && point > best) {
      // Equally close -> round UP.
      best = point;
      bestDelta = delta;
    }
  }

  return best;
}

/**
 * Apply the rule to a catalog at import time.
 * Returns new objects: `price` snapped, `original_price` preserved.
 */
export function applyPriceMatching(products, pricePoints = loadPricePoints()) {
  return products.map((product) => {
    const source = product.original_price ?? product.amazon_price ?? product.price;
    const price = snapToApprovedPrice(source, pricePoints);
    return { ...product, price, original_price: Number(source) };
  });
}
