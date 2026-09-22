# App icon / splash source

`icon-source.svg` is the apple mascot from `FruitAvatar.tsx`'s `Apple()`,
rendered standalone at high resolution as `logo.png` (transparent
background, so the generator can composite it onto both the icon and
Android's adaptive-icon background layer).

To regenerate the native icons/splash screens after changing the logo:

```sh
node -e "
const sharp = require('sharp');
sharp('assets/icon-source.svg', { density: 384 })
  .resize(1536, 1536)
  .png()
  .toFile('assets/logo.png');
"
npx capacitor-assets generate \
  --iconBackgroundColor '#fff8ec' --iconBackgroundColorDark '#fff8ec' \
  --splashBackgroundColor '#fff8ec' --splashBackgroundColorDark '#fff8ec' \
  --ios --android
```

`#fff8ec` is the app's cream theme color (`--color-cream` in
`src/index.css`) — keep it in sync if that ever changes.
