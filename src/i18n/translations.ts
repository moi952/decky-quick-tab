import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { pluginToolkitTranslations } from "@moi952/decky-plugin-toolkit";

import enUS from "./locales/en-US.json";
import frFR from "./locales/fr-FR.json";

// The toolkit's own namespaces (plugin_update/other_plugins, and
// whats_new's own fixed strings) merged in first — this plugin's own
// locale files only ever add to them (its own "whats_new" changelog
// entries), never duplicate them. whats_new needs its own nested merge:
// a shallow spread would let this plugin's own `whats_new` key (its own
// version entries) silently replace the toolkit's older/newer/
// support_note instead of adding to them.
const mergeLocale = (toolkit: any, own: any) => ({
  ...toolkit,
  ...own,
  whats_new: { ...toolkit.whats_new, ...own.whats_new },
});

// This plugin only has its own translations for en-US/fr-FR — but the
// toolkit ships 15 locales (same as decky-proton-launch's own), so every
// one of those still needs registering here, or i18next would never know
// e.g. "de-DE" is a real option and would silently fall back to English
// even for the toolkit's own (already-translated-into-German) strings.
// Locales quick-tab has no own file for just get the toolkit's half —
// its own "panel"/"whats_new.v0_1_0" keys then fall back to en-US
// (fallbackLng below), same as any other missing key.
const ownByLocale: Record<string, any> = { "en-US": enUS, "fr-FR": frFR };

const resources: Record<string, any> = Object.fromEntries(
  Object.entries(pluginToolkitTranslations).map(([locale, toolkit]) => [
    locale,
    mergeLocale(toolkit, ownByLocale[locale] ?? {}),
  ]),
);

export const loadTranslations = () => {
  i18n.use(initReactI18next).init({
    resources,
    lng: navigator.language,
    fallbackLng: {
      fr: ["fr-FR"],
      default: ["en-US"],
    },
    load: "languageOnly",
    defaultNS: "common",
    ns: Object.keys(resources["en-US"]),
    interpolation: { escapeValue: false },
  });
};
