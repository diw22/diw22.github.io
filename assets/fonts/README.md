# Choosing the portfolio font

Open `/fonts.html` on the local preview server. Select a family to preview it on the real homepage, Projects carousel, About page, or project details. The choice is stored in this browser and is shared by the portfolio pages. **Use site default** clears the browser override.

To change the default for all visitors, use **Download default settings** and replace `assets/js/font-settings.js` with the downloaded file. Alternatively, edit the first setting in that file:

```js
window.PORTFOLIO_DEFAULT_FONT = "nunito-sans";
```

The main font is Nunito Sans, a self-hosted variable webfont under the SIL Open Font License 1.1. Its licence and source details are in `nunito-sans/`. The Projects heading also uses Nunito Sans. Sandana is the accent font for the About heading and project-detail section headings; it is set by `--accent` in `assets/css/styles.css`. Navigation, project titles, and body text use the main font. Font previews are stored per site default, so publishing a new default clears the effect of earlier experiments while keeping the chooser available.

| Family | Setting ID |
| --- | --- |
| Nunito Sans | `nunito-sans` |
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

The chooser controls portfolio typography. The robot viewer and market-making demo retain their own branding and interface typography.
