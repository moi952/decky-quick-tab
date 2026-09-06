import React from "react";
import { PanelSection, PanelSectionRow } from "@decky/ui";
import { StatusCard, MediaRow, ActionButton, InlineConfirm } from "@moi952/decky-ui-kit";
import { useTranslation } from "react-i18next";
import { FiZap, FiChevronUp, FiChevronDown, FiEye, FiEyeOff, FiTrash2, FiSettings } from "react-icons/fi";
import { call } from "@decky/api";

import { TabRow, TabRowAction } from "../components/TabRow";
import { SettingsView } from "./SettingsView";
import {
  PluginUpdateBanner,
  usePluginUpdate,
  pluginUpdateFocus,
  WhatsNewBanner,
  getWhatsNewVersions,
  OtherPluginsBanner,
  otherPluginsFocus,
  featureRequestFocus,
} from "@moi952/decky-plugin-toolkit";
import {
  setTabSettings,
  getInstalledPlugins,
  getKnownNativeTabs,
  refreshNativeTabsCache,
  pluginTabKey,
  pluginNameFromTabKey,
  QT_KEY_PREFIX,
  HIDEABLE_NATIVE_KEYS,
  PluginInfo,
  TabInfo,
} from "../patches/qamTabPatch";

interface TabSettings {
  order: string[];
  hidden: string[];
}

// A row in the unified "every tab" list: either one of Steam's own native
// tabs (or Decky's own aggregate one), or one of our pinned plugins.
interface TabRowData {
  key: string;
  title: any;
  icon: any;
  isPlugin: boolean;
  hideable: boolean;
}

// Exact same MediaRow look and props for every row, tab manager or plugin
// picker alike.
const ROW_COLOR = "light" as const;
const ICON_BOX = 26;
const ICON_SIZE = 16;
// color fixed, not inherited — otherwise it silently follows whatever
// text color Steam's own DialogButton focus/hover state swaps to (the
// "name turns grey on focus" bug), same fix as the icon below.
const rowTitle = (text: any) => <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{text}</span>;
// Our own plugin icons are react-icons SVGs, which scale from `fontSize`
// (em-based) — but Steam's own native tab icons are its own internal
// elements with their own fixed pixel dimensions that don't respect
// fontSize at all (that's why Perf's rendered huge next to the others).
// Forcing every actual <svg>/<img> inside this fixed box to fill it
// (see the <style> block below) normalizes both kinds to the same size.
const rowIcon = (icon: any) => (
  <div
    className="qt-icon-box"
    style={{
      width: ICON_SIZE,
      height: ICON_SIZE,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      // Fixed, not `currentColor` — otherwise the icon silently follows
      // whatever text color Steam's own DialogButton focus state swaps
      // to (that's the "turns grey on focus" bug).
      color: "#fff",
    }}
  >
    {icon}
  </div>
);

// Steam's own `title` field for a native tab is a whole React element with
// its own styling (sometimes render nothing at all standalone, like
// VoiceChat/Decky's own), not plain text — using it directly is what made
// rows look formatted differently. These translation keys give every
// native/Decky row a plain, fully-controlled label instead, matching
// every other row's formatting exactly.
const NATIVE_TAB_LABEL_KEYS: Record<string, string> = {
  "0": "tab_notifications",
  "1": "tab_remote_play",
  "2": "tab_chat",
  "3": "tab_friends",
  "4": "tab_settings",
  "5": "tab_perf",
  "6": "tab_help",
  "7": "tab_music",
  "999": "tab_decky",
};

export const QuickTabPanel: React.FC = () => {
  const { t } = useTranslation("panel");
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [plugins, setPlugins] = React.useState<PluginInfo[] | null>(null);
  const [nativeTabs, setNativeTabs] = React.useState<TabInfo[]>([]);
  const [settings, setSettings] = React.useState<TabSettings>({ order: [], hidden: [] });
  // Only true once the user has actually changed something this session —
  // the "close/reopen to apply" note has nothing useful to say before that.
  const [changed, setChanged] = React.useState(false);
  const [confirmingRestart, setConfirmingRestart] = React.useState(false);
  const [view, setView] = React.useState<"main" | "settings">("main");
  const { info: pluginUpdateInfo } = usePluginUpdate();

  const goToSettings = () => {
    setView("settings");
  };

  // The QAM patch itself is installed once from index.tsx's plugin factory
  // (not here) so saved settings apply from plugin load, not only once
  // this panel has been opened — but the QAM might not have existed in
  // the DOM yet at that point (it only exists while actually open), so
  // this refreshes the native tabs snapshot again now that it definitely
  // does (our own panel can't be open otherwise).
  React.useEffect(() => {
    refreshNativeTabsCache();
    setNativeTabs(getKnownNativeTabs());

    call<[], TabSettings>("get_tab_settings")
      .then((saved) => setSettings({ order: saved?.order ?? [], hidden: saved?.hidden ?? [] }))
      .catch(() => undefined);

    // One-shot: see getInstalledPlugins' own comment for why this doesn't
    // stay live-reactive.
    if (rootRef.current) {
      setPlugins(getInstalledPlugins(rootRef.current));
    }
  }, []);

  React.useEffect(() => {
    setTabSettings(settings);
  }, [settings]);

  const persist = (next: TabSettings) => {
    setSettings(next);
    setChanged(true);
    call("set_tab_settings", next.order, next.hidden).catch(() => undefined);
  };

  const restartSteam = () => {
    setConfirmingRestart(false);
    call("restart_steam").catch(() => undefined);
  };

  const nativeByKey = new Map(nativeTabs.map((tab) => [tab.key, tab]));
  const pluginsByName = new Map((plugins ?? []).map((p) => [p.name, p]));

  // Same default the patch itself falls back to: nothing saved yet means
  // every currently-visible native/Decky tab, Steam's own order, nothing
  // hidden, nothing pinned.
  const effectiveOrder: string[] =
    settings.order.length > 0 ? settings.order : Array.from(nativeByKey.keys());

  const rows: TabRowData[] = effectiveOrder
    .map((key): TabRowData | null => {
      if (key.startsWith(QT_KEY_PREFIX)) {
        const plugin = pluginsByName.get(pluginNameFromTabKey(key));
        return plugin ? { key, title: plugin.name, icon: plugin.icon, isPlugin: true, hideable: false } : null;
      }
      const native = nativeByKey.get(key);
      if (!native) return null;
      const labelKey = NATIVE_TAB_LABEL_KEYS[key];
      return {
        key,
        title: labelKey ? t(labelKey) : native.title,
        icon: native.icon,
        isPlugin: false,
        hideable: HIDEABLE_NATIVE_KEYS.has(key),
      };
    })
    .filter((row): row is TabRowData => row !== null);

  const pinnedNames = new Set(
    effectiveOrder.filter((k) => k.startsWith(QT_KEY_PREFIX)).map(pluginNameFromTabKey),
  );
  const availablePlugins = (plugins ?? []).filter((p) => !pinnedNames.has(p.name));

  const move = (key: string, direction: -1 | 1) => {
    const i = effectiveOrder.indexOf(key);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= effectiveOrder.length) return;
    const next = [...effectiveOrder];
    [next[i], next[j]] = [next[j], next[i]];
    persist({ ...settings, order: next });
  };

  const toggleHidden = (key: string) => {
    const next = new Set(settings.hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist({ ...settings, hidden: Array.from(next), order: effectiveOrder });
  };

  const addPlugin = (name: string) => {
    persist({ ...settings, order: [...effectiveOrder, pluginTabKey(name)] });
    // The new row only exists in the DOM once this re-renders — two rAFs
    // (one for React's own render, one for TabRow's header to actually
    // mount as a focusable DialogButton) before focusing it, same fix as
    // TabRow's own confirm-focus timing.
    const key = pluginTabKey(name);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-row-key="${key}"] button`)?.focus();
      });
    });
  };

  const removePlugin = (name: string) => {
    persist({ ...settings, order: effectiveOrder.filter((k) => k !== pluginTabKey(name)) });
  };

  const ready = plugins !== null && nativeTabs.length > 0;

  if (view === "settings") {
    return <SettingsView onBack={() => setView("main")} />;
  }

  return (
    <div ref={rootRef}>
      {/* 80%, not 100%: react-icons SVGs are cropped tight to their glyph,
          Steam's own native tab icons carry built-in padding — filling the
          box completely made ours look bigger than the natives right next
          to them. */}
      <style>{`.qt-icon-box svg, .qt-icon-box img { width: 80% !important; height: 80% !important; }`}</style>

      <PanelSection>
        <ActionButton onClick={goToSettings} width="100%">
          <FiSettings size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          {t("open_settings")}
        </ActionButton>
      </PanelSection>

      <PluginUpdateBanner
        info={pluginUpdateInfo}
        onClick={() => {
          pluginUpdateFocus.markExpanded();
          goToSettings();
        }}
      />
      <WhatsNewBanner
        versions={getWhatsNewVersions()}
        onFeatureRequest={() => {
          featureRequestFocus.markExpanded();
          goToSettings();
        }}
      />
      <OtherPluginsBanner
        onOpenSettings={() => {
          otherPluginsFocus.markExpanded();
          goToSettings();
        }}
      />

      {!ready && (
        <PanelSection>
          <PanelSectionRow>
            <StatusCard variant="info" icon={<FiZap />} title={t("title")}>
              <div style={{ fontSize: 11, opacity: 0.8, textAlign: "left" }}>
                {t("plugins_unavailable")}
              </div>
            </StatusCard>
          </PanelSectionRow>
        </PanelSection>
      )}

      {ready && changed && (
        <PanelSection>
          <PanelSectionRow>
            <StatusCard variant="info" icon={<FiZap />} title={t("apply_note_title")}>
              <div style={{ fontSize: 11, opacity: 0.8, textAlign: "left", marginBottom: 10 }}>
                {t("apply_note_description")}
              </div>
              {confirmingRestart ? (
                <InlineConfirm
                  description={t("confirm_restart_description")}
                  confirmLabel={t("action_restart_steam")}
                  cancelLabel={t("action_cancel")}
                  variant="primary"
                  onCancel={() => setConfirmingRestart(false)}
                  onConfirm={restartSteam}
                />
              ) : (
                <div style={{ width: "100%" }}>
                  <ActionButton variant="primary" width="100%" onClick={() => setConfirmingRestart(true)}>
                    {t("action_restart_steam")}
                  </ActionButton>
                </div>
              )}
            </StatusCard>
          </PanelSectionRow>
        </PanelSection>
      )}

      {ready && (
        <PanelSection title={t("tabs_title")}>
          {rows.map((row, i) => {
            const isHidden = row.hideable && settings.hidden.includes(row.key);
            const rowActions: TabRowAction[] = [
              { key: "up", icon: <FiChevronUp />, disabled: i === 0, onClick: () => move(row.key, -1) },
              {
                key: "down",
                icon: <FiChevronDown />,
                disabled: i === rows.length - 1,
                onClick: () => move(row.key, 1),
              },
              ...(row.hideable
                ? [{ key: "hide", icon: isHidden ? <FiEye /> : <FiEyeOff />, onClick: () => toggleHidden(row.key) }]
                : []),
              ...(row.isPlugin
                ? [
                    {
                      key: "remove",
                      icon: <FiTrash2 />,
                      variant: "danger" as const,
                      onClick: () => removePlugin(pluginNameFromTabKey(row.key)),
                      confirm: {
                        description: t("confirm_remove_description", { name: row.title }),
                        confirmLabel: t("action_remove"),
                        cancelLabel: t("action_cancel"),
                      },
                    },
                  ]
                : []),
            ];
            return (
              <PanelSectionRow key={row.key}>
                <TabRow
                  rowKey={row.key}
                  media={<div style={{ opacity: isHidden ? 0.4 : 1 }}>{rowIcon(row.icon)}</div>}
                  title={<div style={{ opacity: isHidden ? 0.4 : 1 }}>{rowTitle(row.title)}</div>}
                  actions={rowActions}
                  optionsActionKey={row.isPlugin ? "remove" : row.hideable ? "hide" : undefined}
                  onOptionsActionDescription={
                    row.isPlugin
                      ? t("action_remove")
                      : row.hideable
                        ? isHidden
                          ? t("action_show")
                          : t("action_hide")
                        : undefined
                  }
                />
              </PanelSectionRow>
            );
          })}
        </PanelSection>
      )}

      <PanelSection title={t("available_title")}>
        {ready && availablePlugins.length === 0 && <PanelSectionRow>{t("no_more_plugins")}</PanelSectionRow>}
        {availablePlugins.map((plugin) => (
          <PanelSectionRow key={plugin.name}>
            <MediaRow
              color={ROW_COLOR}
              spacing={4}
              media={rowIcon(plugin.icon)}
              mediaWidth={ICON_BOX}
              title={rowTitle(plugin.name)}
              onPress={() => addPlugin(plugin.name)}
            />
          </PanelSectionRow>
        ))}
      </PanelSection>
    </div>
  );
};
