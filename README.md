# Quick Tab

![GitHub Downloads](https://img.shields.io/github/downloads/moi952/decky-quick-tab/total)
![Downloads latest](https://img.shields.io/github/downloads/moi952/decky-quick-tab/latest/total)
![Stars](https://img.shields.io/github/stars/moi952/decky-quick-tab)

**Pin your own plugins directly into Steam's Quick Access Menu.**

Quick Tab adds each of your installed Decky plugins as its own icon in the Quick Access Menu's native tab bar, instead of going through Decky Loader's own aggregated plugin list. Reorder every tab — native, Decky's own, and pinned plugins alike — and hide the native ones you don't use.

### ✨ New in 0.1.0

- Pin your own plugins directly into Steam's Quick Access Menu tabs
- Reorder and hide native tabs (Notifications, Chat, Help, Music)
- Settings page: plugin self-update, bug report, feature request, support the development

---

## Screenshots

### Every tab in one place

Native tabs, hide/reorder controls, and your installed plugins ready to pin — all from one panel.

![Quick Tab's own panel](quick-tab-overview.jpeg)

### A pinned plugin, opened directly from its tab

Decky Proton Launch running in its own Quick Access Menu tab, no different from a native one.

![Decky Proton Launch open from its pinned tab](pinned-plugin-open.jpeg)

---

## Features

- **Pin any installed plugin** as its own icon in the Quick Access Menu tab bar
- **Reorder every tab** — native, Decky's own, and pinned plugins alike
- **Hide native tabs** you don't use (Notifications, Chat, Help, Music)
- **Settings page**: check for plugin updates and install in one click, report a bug or request a feature via QR code, discover your other plugins, support the development
- **Gamepad navigation**: fully accessible with the Steam Deck controller
- **Multi-language support**: EN, FR, DE, ES, IT, PT-BR, PT-PT, RU, PL, NL, TR, UK, JA, KO, ZH-CN

---

## Installation

> **Not yet on the Decky Store.** Install manually via Developer Mode.

1. Enable **Developer Mode** in Decky - General settings
2. Go to **Developer** in Decky settings
3. Install from URL:
   `https://github.com/moi952/decky-quick-tab/releases/latest/download/decky-quick-tab.zip`
   > ⚠️ Decky Loader 3.3 and newer shows a *Third-Party Plugin Installation* warning here, because the plugin is not from the Decky Store. That is expected: wait 5 seconds and confirm. It only appears once, and updates install by themselves afterwards.

> **A note on automatic updates.** Decky owns the plugin's top-level directory,
> so the built-in updater can rewrite existing files but cannot create new ones.
> A release that adds a file at the top level therefore has to be installed the
> normal way - *Install plugin from URL*, above - rather than through the
> automatic update. The release notes say so whenever that is the case.

---

## Contributing

Contributions are welcome!

- **New language**: add a JSON file in `src/i18n/locales/` following the existing structure and open a PR.
- **Bug or feature idea**: open an issue, or use the QR code shortcuts in the plugin's own Settings page.

---

## License

BSD-3-Clause License
