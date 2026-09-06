import { definePlugin, staticClasses } from "@decky/ui";
import { addEventListener, removeEventListener, toaster } from "@decky/api";
import i18n from "i18next";
import { FiZap } from "react-icons/fi";
import {
  PluginUpdateProvider,
  OtherPluginsProvider,
  WhatsNewProvider,
  PluginUpdateInfo,
} from "@moi952/decky-plugin-toolkit";

import { loadTranslations } from "./i18n";
import { QuickTabPanel } from "./views/QuickTabPanel";
import { addQamTabDiscovery, removeQamTabDiscovery } from "./patches/qamTabPatch";
import { SELF_PLUGIN_ID } from "./utils/otherPlugins";
import { CURRENT_VERSION } from "./utils/githubReleases";
import projectConfig from "./project.config.json";

export default definePlugin(() => {
  loadTranslations();
  // Installed once here rather than deferred to QuickTabPanel's own mount
  // (as it used to be) — this factory runs for every installed plugin as
  // soon as Decky loads, regardless of whether the user ever opens this
  // plugin's own panel, so saved tab order/hidden settings actually apply
  // from plugin load instead of only after the panel's been opened once.
  addQamTabDiscovery();

  // Fired by Plugin._main() on the Python side (see decky-plugin-toolkit's
  // PluginUpdaterMixin) as soon as Decky loads this plugin — not gated
  // behind the user ever opening its panel, unlike PluginUpdateProvider's
  // own on-mount check.
  const updateListener = addEventListener(
    "plugin_update_available",
    (info: PluginUpdateInfo) => {
      toaster.toast({
        title: i18n.t("settings:settings_title"),
        body: i18n.t("settings:update_available", { version: info?.latest_version }),
      });
    },
  );

  return {
    name: projectConfig.pluginName,
    titleView: <div className={staticClasses.Title}>{projectConfig.displayName}</div>,
    content: (
      <PluginUpdateProvider>
        <OtherPluginsProvider selfPluginId={SELF_PLUGIN_ID}>
          <WhatsNewProvider currentVersion={CURRENT_VERSION}>
            <QuickTabPanel />
          </WhatsNewProvider>
        </OtherPluginsProvider>
      </PluginUpdateProvider>
    ),
    icon: <FiZap />,
    onDismount() {
      removeQamTabDiscovery();
      removeEventListener("plugin_update_available", updateListener);
    },
  };
});
