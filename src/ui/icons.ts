/**
 * Masked interface icons.
 *
 * The art is a white shape with an alpha channel, used as a CSS `mask-image`,
 * so the icon takes its colour from `background-color`. That is what lets one
 * asset serve the amber accent, the ink-on-warmth parcel indicator and a dimmed
 * disabled state without three separate files.
 *
 * See `tools/slice-icons.mjs` for how they are cut, and
 * `tools/icon-preview.html` for the review sheet.
 */

/** Every mask in `public/assets/ui/icons`. */
export type IconName =
  | 'parcel'
  | 'shard'
  | 'compass'
  | 'letter'
  | 'lantern'
  | 'star'
  | 'corner'
  | 'divider'
  | 'bullet';

/**
 * Publish the ornament masks to CSS as custom properties.
 *
 * Panel decoration belongs in the stylesheet — it applies to every `.lp-panel`
 * without a single screen having to know about it — but a stylesheet cannot
 * read `BASE_URL`, and a hard-coded `/assets/...` breaks the moment the game is
 * served from a sub-path. A whole `url(...)` handed over as a custom property
 * solves both: CSS owns the layout, script owns the path.
 *
 * Called once, at UI construction.
 */
export function publishOrnaments(): void {
  const root = document.documentElement.style;
  for (const name of ['corner', 'divider', 'bullet'] as const) {
    root.setProperty(`--lp-orn-${name}`, `url(${import.meta.env.BASE_URL}assets/ui/icons/${name}.png)`);
  }
}

/**
 * Build an icon element.
 *
 * The mask URL is assigned here rather than in the stylesheet because it
 * depends on `BASE_URL`: a hard-coded `/assets/...` works in dev and silently
 * resolves to the wrong place once the game is served from a sub-path.
 *
 * `-webkit-mask-image` is set first because Safari still needs the prefix, and
 * without it the element renders as a solid coloured square rather than an
 * icon — a failure that is far louder than a missing icon would be.
 */
export function icon(name: IconName, size: number, colour = 'currentColor'): HTMLElement {
  const element = document.createElement('span');
  element.className = 'lp-icon';
  element.setAttribute('aria-hidden', 'true');
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  element.style.backgroundColor = colour;

  const url = `url(${import.meta.env.BASE_URL}assets/ui/icons/${name}.png)`;
  element.style.setProperty('-webkit-mask-image', url);
  element.style.setProperty('mask-image', url);
  return element;
}
