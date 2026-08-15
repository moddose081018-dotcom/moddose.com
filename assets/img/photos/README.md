# Product photography

Drop real product photos here, then reference them from `data/products.json`:

```json
{
  "slug": "focus-starter",
  "photos": [
    "/assets/img/photos/focus-starter-1.jpg",
    "/assets/img/photos/focus-starter-2.jpg"
  ]
}
```

Run `npm run build`. Any product with photos uses them; any product without
falls back to the generated SVG art. A path that does not resolve prints a
build warning and falls back rather than shipping a broken image.

## Specification

| | |
|---|---|
| Aspect ratio | **1:1 square** — cards and the product page both crop to square |
| Size | 1600×1600 minimum (retina on a 800px display) |
| Format | `.jpg` for photographs, `.webp` if you have it, `.png` only for transparency |
| Weight | under 300 KB each after compression |
| Background | consistent across the range — plain white or a single neutral |
| Naming | `<slug>-1.jpg`, `<slug>-2.jpg`, … first image is the one used on cards |

## What to shoot

The first image is the one customers judge in the grid, so it should be the
product alone, filling most of the frame, on the same background as every
other product. Additional angles then earn their place: the supplement facts
panel (legible enough to read), the product in hand for scale, and what
arrives in the box.

Keep the panel shot honest — it is the one customers zoom into, and a label
that does not match what ships is a labelling problem, not a photo problem.
