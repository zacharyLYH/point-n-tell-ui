# Recording cut selection

Keep one cut per meaningful visual state, plus every click.

## Candidates

- Sample the viewport every 150ms while recording.
- Capture each click as a forced candidate after a 150ms settle. Pause periodic samples while a click is settling.
- Stop flushes pending captures and closes CDP before the processing UI appears. No screenshot is taken after capture closes.
- The last captured candidate is always kept.

## Selection

Candidates run in capture order against one benchmark: the last kept cut.

1. Keep the first candidate.
2. Keep every click candidate, even when pixels are unchanged.
3. Keep any other candidate when more than 10% of pixels differ from the benchmark.
4. A kept candidate becomes the next benchmark.
5. Keep the final candidate.

## Pixel difference

- Crop the reserved 64px top band.
- Downscale the app area to 96x96 RGB.
- A pixel changed when any channel differs by more than 16 levels.
- `diffScore` is changed pixels divided by total pixels; a non-click cut requires `diffScore > 0.1`.
- `diffScore` for a cut is measured against the previous kept cut. The first cut scores `0`.

## Output

- Tags are `first`, `click`, and `last`; a cut can have more than one.
- Cut images are cropped JPEGs; scratch frames are deleted after processing.
