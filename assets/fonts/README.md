# Choosing the portfolio font

Open `/fonts.html` on the local preview server. Select a family to preview it on the real homepage, Projects carousel, About page, or project details. The choice is stored in this browser and is shared by the portfolio pages. **Use site default** clears the browser override.

To change the default for all visitors, use **Download default settings** and replace `assets/js/font-settings.js` with the downloaded file. Alternatively, edit the first setting in that file:

```js
window.PORTFOLIO_DEFAULT_FONT = "oblata-display";
```

The main font is Oblata Display. Sandana is the accent font for the Projects and About headings and project-detail section headings; it is set by `--accent` in `assets/css/styles.css`. Navigation, project titles, and body text use the main font. Font previews are stored per site default, so publishing a new default clears the effect of earlier experiments while keeping the chooser available.

| Family | Setting ID |
| --- | --- |
| Alice Yotsuba Inc. | `alice-yotsuba-inc` |
| Derma | `derma` |
| Ichigaya Mincho | `ichigaya-mincho` |
| Lowball Neue | `lowball-neue` |
| Oblata Display | `oblata-display` |
| Odida | `odida` |
| Regencie | `regencie` |
| Regencie Alt | `regencie-alt` |
| Rondal | `rondal` |
| Sandana | `sandana` |
| Super Golden | `super-golden` |
| Zurich | `zurich` |

All 11 supplied archives are unpacked into their corresponding folders here, including 30 original font files and their included notices. `assets/css/fonts.css` registers their supplied weights and italics. Fonts load when used; the main portfolio does not download all families at once. The font chooser intentionally loads a specimen from each family.

The chooser controls portfolio typography. The robot viewer retains its own aero branding and interface typography.
