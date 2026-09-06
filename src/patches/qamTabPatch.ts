import {
  Patch,
  afterPatch,
  createReactTreePatcher,
  findInReactTree,
  findModuleByExport,
  getReactRoot,
  staticClasses,
  Focusable,
} from "@decky/ui";
import { call } from "@decky/api";
import * as React from "react";

// Same technique Decky Loader itself uses to inject its own icon into the
// QAM (see decky-loader's frontend/src/tabs-hook.tsx): find the QAM's
// render function by matching a literal string in its *source code* (via
// findModuleByExport), then afterPatch its render output to reach the real
// `tabs` array — no CSS class guessing, no whole-document MutationObserver,
// no manual __reactFiber$ walking of the QAM itself. Those all turned out
// to be dead ends on a real Deck (the "Tabs" static class never matched
// anything real, and the observer never saw the already-mounted tab bar).
const LOG_PREFIX = "[quick-tab][qam-patch]";

// Relayed to the backend (see plugin.py's log_debug) because this
// frontend's own console.log only reaches Steam's CEF devtools, which
// isn't reachable without a remote-debugging session — journalctl is.
const relay = (message: string) => {
  console.log(LOG_PREFIX, message);
  call("log_debug", message).catch(() => undefined);
};

export const QT_KEY_PREFIX = "quick-tab:";
export const pluginTabKey = (name: string) => QT_KEY_PREFIX + name;
export const pluginNameFromTabKey = (key: string) => key.slice(QT_KEY_PREFIX.length);
// Pinning ourselves would just nest this same manager inside itself.
const OWN_PLUGIN_NAME = "decky-quick-tab";
// Steam's own @decky/ui QuickAccessTab enum: Notifications=0,
// RemotePlayTogetherControls=1, VoiceChat=2, Friends=3, Settings=4,
// Perf=5, Help=6, Music=7, Decky=999. Only these four are offered as
// hideable — Friends/Settings/Perf/RemotePlay/Decky stay mandatory (still
// reorderable) so the user can't lock themselves out of anything load-
// bearing purely through this plugin's UI.
export const HIDEABLE_NATIVE_KEYS = new Set(["0", "2", "6", "7"]);
export const DECKY_TAB_KEY = "999";

export interface PluginInfo {
  name: string;
  icon: any;
  content: any;
  titleView: any;
}

export interface TabInfo {
  key: string;
  title: any;
  icon: any;
}

// Every real DOM node React manages carries a fiber reference under a key
// starting with "__reactFiber$" (the random suffix changes per React
// build, hence the prefix search).
const getReactFiber = (domNode: Element): any => {
  const key = Object.keys(domNode).find((k) => k.startsWith("__reactFiber$"));
  return key ? (domNode as unknown as Record<string, unknown>)[key] : null;
};

const toPluginInfo = (plugins: any[]): PluginInfo[] =>
  plugins
    .filter((p) => p?.name && p.name !== OWN_PLUGIN_NAME && p.content)
    .map((p) => ({ name: p.name, icon: p.icon, content: p.content, titleView: p.titleView }));

// One-shot read for the manager UI: climbs up from an already-mounted DOM
// node (guaranteed to sit inside the same tree as Decky's plugin-list
// Context, since our panel is nested inside one of the QAM's own tab
// panels) looking for the installed-plugins Context value. Not
// live/reactive — good enough for a settings list that rarely needs to
// change mid-session, and avoids grabbing React's raw Context object off
// a fiber just to keep it reactive.
//
// Native *tabs* are deliberately NOT read this way — an earlier version
// climbed the same way looking for any ancestor with a `.tabs` prop, but
// Steam's tree has more than one component using that generic a prop name,
// and it latched onto the wrong one (only 2 unrelated icons showed up
// instead of the real 7). getKnownNativeTabs() below reads from the same
// targeted, proven-correct search the actual tab injection itself uses.
export const getInstalledPlugins = (fromNode: Element): PluginInfo[] | null => {
  let fiber = getReactFiber(fromNode);
  for (let depth = 0; fiber && depth < 60; depth++) {
    const plugins = fiber.memoizedProps?.value?.plugins;
    if (Array.isArray(plugins)) return toPluginInfo(plugins);
    fiber = fiber.return;
  }
  return null;
};

// Decky's own installed-plugins list lives in a React Context whose
// Provider wraps the whole app — an *ancestor* of the QAM, not a
// descendant. findInReactTree only walks downward (props/children/child/
// sibling, see @decky/ui's react.js — no `.return`), so searching inside a
// patched render's own output (a descendant-only subtree) can never reach
// it. This instead starts from the real, already-committed app root fiber
// (an ancestor of everything, Provider included) and searches down from
// there. Fiber nodes expose memoizedProps, not props — plain React
// elements (like a render's return value) are the other shape
// findInReactTree is meant for.
const findPluginsFromRoot = (): PluginInfo[] | null => {
  const root = getReactRoot(document.getElementById("root") as any);
  if (!root) return null;
  const node = findInReactTree(root, (n: any) => Array.isArray(n?.memoizedProps?.value?.plugins));
  return node ? toPluginInfo(node.memoizedProps.value.plugins) : null;
};

// A broken pinned plugin's content must not be able to take down the
// whole QAM just because we put it there.
class QuickTabErrorBoundary extends React.Component<{ children: any }, { hasError: boolean }> {
  constructor(props: { children: any }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    relay(`pinned plugin panel threw: ${error}`);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

// DEBUG: comparing our own added title bar's computed left-side spacing
// against a native tab's own outside label (the one Steam itself renders
// for e.g. Notifications, before that tab's own panel div) — the two
// live in structurally different places (native: a sibling *before* the
// tabpanel div; ours: the first child *inside* our own tabpanel), so
// there's no single shared class to copy — comparing the actual computed
// numbers is what actually tells us how much to adjust.
//
// Also answers a separate question: are other tabs' panels (e.g.
// Notifications, or Decky's own aggregate one) still fully rendered with
// real content while a *different* tab (ours) is the active one, or does
// Steam only mount the active tab's panel? If every `quickaccess_content_*`
// div already has real content regardless of which is active, that means
// a pinned plugin's own background work (intervals, sockets, polling) runs
// for as long as the QAM patch is installed, independent of whether this
// specific tab is the one currently open — and if the *same* plugin is
// ever also opened through Decky Loader's own aggregate list at the same
// time, that's a second, fully independent instance of the same
// component, each running its own copy of that background work.
let sniffedTitleMargins = false;
class QamDomSniffer extends React.Component<{ children: any }> {
  private ref = React.createRef<HTMLDivElement>();

  private sniff() {
    if (sniffedTitleMargins) return;
    sniffedTitleMargins = true;

    // Ours: Fragment[titleBar, contentDiv] means titleBar is contentDiv's
    // previous sibling, and contentDiv is our sniffer's own parent.
    const ownContentDiv = this.ref.current?.parentElement ?? null;
    const ownTitleBar = ownContentDiv?.previousElementSibling as HTMLElement | null;
    if (ownTitleBar) {
      const cs = getComputedStyle(ownTitleBar);
      relay(
        `[sniff] our own title bar computed: paddingLeft=${cs.paddingLeft} marginLeft=${cs.marginLeft} fontSize=${cs.fontSize} | outerHTML (first 400 chars): ${ownTitleBar.outerHTML.slice(0, 400)}`,
      );
    } else {
      relay("[sniff] could not find our own title bar (contentDiv.previousElementSibling)");
    }

    // Notifications (key 0) is always present — its own outside label is
    // the sibling right before its own tabpanel div.
    const nativeTabPanel = document.getElementById("quickaccess_content_0");
    const nativeTitle = nativeTabPanel?.previousElementSibling as HTMLElement | null;
    if (nativeTitle) {
      const cs = getComputedStyle(nativeTitle);
      relay(
        `[sniff] native (Notifications) outside title computed: paddingLeft=${cs.paddingLeft} marginLeft=${cs.marginLeft} fontSize=${cs.fontSize} | outerHTML (first 400 chars): ${nativeTitle.outerHTML.slice(0, 400)}`,
      );
    } else {
      relay("[sniff] could not find native Notifications title (quickaccess_content_0.previousElementSibling)");
    }

    // Are inactive tabpanels still fully rendered with real content? The
    // `quickaccess_content_*` id a tab's own aria-controls *claims* to
    // point at turned out not to exist anywhere in the real DOM (a prior
    // version of this probe always found 0 of them, including for our own
    // panel we were running inside of at that very moment) — so instead of
    // guessing the id scheme, walk up from our own known-mounted node to
    // whatever ARIA actually marks as its enclosing tabpanel, then count
    // how many such elements exist at once.
    const ownTabPanel = this.ref.current?.closest('[role="tabpanel"]') as HTMLElement | null;
    relay(
      `[sniff] closest [role="tabpanel"] ancestor of our own node: ${ownTabPanel ? `id=${ownTabPanel.id || "(none)"} aria-labelledby=${ownTabPanel.getAttribute("aria-labelledby") ?? "(none)"}` : "NOT FOUND"}`,
    );
    // A prior version of this probe queried `document.querySelectorAll`
    // directly and always came back with 0 results — even for the very
    // panel `closest()` above just found us sitting inside of. Plugin code
    // apparently gets a `document` that doesn't see the same tree real DOM
    // refs do (some kind of sandboxing), so this never touches `document`
    // at all: it walks sideways from the one real node already in hand
    // (ownTabPanel) to its siblings under the same parent instead.
    const siblingPanels = ownTabPanel?.parentElement
      ? Array.from(ownTabPanel.parentElement.children).filter(
          (el) => el.getAttribute("role") === "tabpanel",
        )
      : [];
    relay(`[sniff] found ${siblingPanels.length} sibling [role="tabpanel"] element(s) under the same parent`);
    siblingPanels.forEach((panel, i) => {
      const el = panel as HTMLElement;
      relay(
        `[sniff] sibling tabpanel[${i}] id=${el.id || "(none)"} aria-labelledby=${el.getAttribute("aria-labelledby") ?? "(none)"} innerHTML.length=${el.innerHTML.length} display=${getComputedStyle(el).display} hidden=${el.hidden}`,
      );
    });
  }

  componentDidMount() {
    this.sniff();
  }
  render() {
    return React.createElement("div", { ref: this.ref }, this.props.children);
  }
}

// A real DOM sniff of `role="tab"` icons settled this: every native tab
// (and Decky Loader's own, and Hydra's — all untouched by us) computes to
// the same ~24px, meaning Steam's own CSS already sizes *any* tab icon
// uniformly on its own, via a class rule. Apps Manager's and Decky Proton
// Launch's icons came out smaller (~16px) specifically because their own
// elements already carry an inline `style="width:1em;height:1em"` — and an
// earlier version of this function made that worse by *forcing* the same
// inline 1em (inline style beats a class rule regardless of what value it
// sets), rather than removing it. Stripping any inline size the icon
// brought with it — not replacing it with a different one — is what lets
// Steam's own rule apply the same to every tab, official or not.
const buildTabIcon = (icon: any) => {
  if (!React.isValidElement(icon)) return icon;
  const el = icon as React.ReactElement<{ style?: React.CSSProperties; size?: unknown }>;
  return React.cloneElement(el, {
    style: { ...el.props.style, width: undefined, height: undefined },
    size: undefined,
  });
};

// No paddingLeft: decky-loader's own TitleView.tsx (which this otherwise
// mirrors exactly) doesn't have one either — its left-side spacing comes
// from the back-arrow DialogButton it renders before the title, which we
// don't have here (no "back to a list" to go to). Adding one ourselves is
// what pushed the name further right than every native tab's own title.
const PLUGIN_TITLE_BAR_STYLE: React.CSSProperties = {
  display: "flex",
  paddingRight: "16px",
  position: "sticky",
  top: "0px",
};

// Mirrors decky-loader's own TitleView.tsx exactly: it renders
// `activePlugin.titleView` *raw*, with no extra class of its own — a
// plugin's own titleView is documented to already wrap itself in
// staticClasses.Title (that's the whole convention), so it arrives fully
// styled. A sniff of our own rendered title bar caught this the hard way:
// Apps Manager's titleView already carries staticClasses.Title itself,
// and our own wrapper was adding the *same* class again around it —
// nesting two elements that each contribute that class's own left
// padding, doubling it (32px instead of 16px). staticClasses.Title only
// belongs here ourselves for the fallback (no titleView at all, just
// plugin.name as plain text) — never around an already-styled titleView.
const buildPluginPanel = (plugin: PluginInfo) =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(Focusable, {
      style: PLUGIN_TITLE_BAR_STYLE,
      children:
        plugin.titleView ??
        React.createElement("div", { className: staticClasses.Title, style: { flex: 0.9 } }, plugin.name),
    }),
    React.createElement(
      "div",
      { style: { height: "100%", paddingTop: "16px" } },
      React.createElement(
        QuickTabErrorBoundary,
        null,
        React.createElement(QamDomSniffer, null, plugin.content),
      ),
    ),
  );

let order: string[] = [];
let hidden: Set<string> = new Set();

// Called by the manager UI whenever the user reorders, hides, pins or
// unpins something. Only updates in-memory state consumed on the *next*
// QAM render (see syncQamTabs) — there's no safe way from here to force
// Steam's own QAM component to re-render immediately, so a change shows up
// next time the QAM is closed and reopened, same as Decky's own tab-list
// changes.
export const setTabSettings = (next: { order: string[]; hidden: string[] }) => {
  order = [...next.order];
  hidden = new Set(next.hidden);
};

// Reconciles the real QAM tabs array against the saved order/hidden state:
// native and Decky's own entries are kept as the *same* live objects
// (preserving identity/mounted state) and just filtered/reordered; any of
// our own previously-injected pinned-plugin entries are dropped and
// rebuilt fresh from the current plugin list. Skips the mutation entirely
// when the result would be identical, so this is cheap to run on every
// QAM render.
// Hiding a native tab means removing it from the live array — but once
// removed, it's gone from `tabs` on every later call, and we have no way
// to construct a real Notifications/Music/etc. tab object ourselves. This
// cache remembers every native/Decky object this session has ever seen,
// updated *before* any filtering below, so hiding one and later un-hiding
// it re-inserts the very same object instead of losing it for good.
//
// Stashed on `window`, not a plain module-level variable: installing an
// update (loader/reload_plugin) re-fetches and re-executes this whole
// script, which would otherwise reset this to empty — but Steam's own QAM
// component and its live `tabs` array are untouched by that (only our own
// script reloads), so that array still reflects every earlier hide, with
// no way left to relearn what was removed. `window` survives a plugin
// reload (only a real Steam restart clears it), so the cache does too.
const NATIVE_TAB_CACHE_KEY = "__decky_quick_tab_native_cache__";
const nativeTabCache: Map<string, any> =
  (window as any)[NATIVE_TAB_CACHE_KEY] ?? ((window as any)[NATIVE_TAB_CACHE_KEY] = new Map());

// Which PluginInfo object each currently-pinned tab's panel was last built
// from — a plugin reload gives Decky's own Context a brand-new PluginInfo
// (new content/icon, same name/key), and the key-list check below can't
// see that (the key doesn't change). Without this, a reloaded plugin's
// pinned tab kept rendering the pre-reload module forever: two fully
// separate instances of "the same" plugin, one fresh (Decky's own
// aggregate list) and one stuck on old code (ours), confirmed by a real
// reload on-device (icon change didn't show up in the pinned tab).
const pluginRefCache = new Map<string, PluginInfo>();

// Read-only snapshot for the manager UI — every native/Decky tab seen so
// far this session (hidden ones included, so the UI can still show/toggle
// them), each reduced to just what a row needs to display.
export const getKnownNativeTabs = (): TabInfo[] =>
  Array.from(nativeTabCache.entries()).map(([key, t]) => ({ key, title: t.title, icon: t.tab }));

const syncQamTabs = (tabs: any[], pluginsByName: Map<string, PluginInfo>) => {
  for (const t of tabs) {
    const key = String(t?.key);
    if (!key.startsWith(QT_KEY_PREFIX)) nativeTabCache.set(key, t);
  }

  // First run (nothing saved yet): every currently-visible native/Decky
  // tab, in whatever order Steam itself has them, nothing hidden, nothing
  // pinned — matches "leave every official tab shown on first install".
  const baseOrder = order.length > 0 ? order : Array.from(nativeTabCache.keys());

  const finalKeys: string[] = [];
  for (const key of baseOrder) {
    if (key !== DECKY_TAB_KEY && hidden.has(key)) continue;
    if (nativeTabCache.has(key) || (key.startsWith(QT_KEY_PREFIX) && pluginsByName.has(pluginNameFromTabKey(key)))) {
      finalKeys.push(key);
    }
  }
  // Anything live right now but missing from baseOrder (a new Steam tab
  // type, or the very first time a transient one like VoiceChat appears)
  // joins at the end rather than silently vanishing.
  for (const key of nativeTabCache.keys()) {
    if (!finalKeys.includes(key) && !hidden.has(key)) finalKeys.push(key);
  }

  const currentKeys = tabs.map((t: any) => String(t?.key));
  const keysUnchanged =
    currentKeys.length === finalKeys.length && currentKeys.every((k, i) => k === finalKeys[i]);
  const pinnedPluginsUnchanged = finalKeys
    .filter((k) => k.startsWith(QT_KEY_PREFIX))
    .every((k) => pluginRefCache.get(k) === pluginsByName.get(pluginNameFromTabKey(k)));
  if (keysUnchanged && pinnedPluginsUnchanged) {
    return;
  }

  const finalTabs = finalKeys.map((key) => {
    if (nativeTabCache.has(key)) return nativeTabCache.get(key);
    const plugin = pluginsByName.get(pluginNameFromTabKey(key))!;
    pluginRefCache.set(key, plugin);
    return {
      key,
      // Steam renders this raw, unstyled, directly above the panel
      // content (confirmed via a real DOM sniff: a native tab's title is
      // its own styled component, Decky Loader's own injected tab passes
      // `title: null` for exactly this reason) — matching Decky Loader's
      // own convention here instead of a plain string avoids adding an
      // unstyled "ghost" copy of the name above the plugin's content.
      title: null,
      tab: buildTabIcon(plugin.icon),
      panel: buildPluginPanel(plugin),
    };
  });
  // Drop stale entries for plugins no longer pinned, so a later re-pin
  // starts fresh instead of comparing against a long-gone reload.
  for (const key of Array.from(pluginRefCache.keys())) {
    if (!finalKeys.includes(key)) pluginRefCache.delete(key);
  }

  tabs.length = 0;
  tabs.push(...finalTabs);
  relay(`synced tabs: ${finalKeys.join(", ")}`);
};

let qamBrowserViewPatch: Patch | undefined;
let qamEmbeddedPatch: Patch | undefined;
let qamBrowserViewRenderer: any;
let qamEmbeddedRenderer: any;

// Seeds nativeTabCache from whatever the QAM's own fiber currently holds,
// without waiting for its next render — searches *down* from the QAM's
// own fiber (real, already-committed) for the descendant actually holding
// `.tabs`, targeted at the confirmed QAM node itself, unlike a generic
// climb from anywhere (which previously latched onto some other
// component's unrelated `.tabs` prop). Safe to call repeatedly: it just
// refreshes the same cache, e.g. once more from the settings panel's own
// mount in case the QAM hadn't rendered even once yet when the patch was
// first installed (it only exists in the DOM while actually open, and
// installation now happens at plugin load, not panel open).
export const refreshNativeTabsCache = () => {
  if (!qamBrowserViewRenderer) {
    relay("refreshNativeTabsCache: no renderer reference yet");
    return;
  }
  const root = getReactRoot(document.getElementById("root") as any);
  const qamNode =
    root &&
    findInReactTree(
      root,
      (n: any) =>
        n.elementType == qamBrowserViewRenderer ||
        (qamEmbeddedRenderer != null && n.elementType == qamEmbeddedRenderer),
    );
  if (!qamNode) {
    relay("refreshNativeTabsCache: qamNode not found (QAM not mounted?)");
    return;
  }

  // afterPatch only takes effect on *future* calls to `.type` — but the QAM
  // stays mounted for the whole session (just shown/hidden), so its fiber
  // already holds a reference to the original, unpatched render function
  // and will never call the patched one on its own. Forcing this existing
  // fiber's `.type` to point at the (now patched) elementType.type is what
  // makes it actually pick up the patch without waiting for a fresh mount.
  qamNode.type = qamNode.elementType.type;
  if (qamNode.alternate) {
    qamNode.alternate.type = qamNode.type;
  }

  const tabsFiberNode = findInReactTree(qamNode, (n: any) => Array.isArray(n?.memoizedProps?.tabs));
  if (!tabsFiberNode) {
    relay("refreshNativeTabsCache: no tabs prop found under qamNode");
    return;
  }
  relay(
    `refreshNativeTabsCache: found tabs=[${tabsFiberNode.memoizedProps.tabs.map((t: any) => String(t?.key)).join(",")}]`,
  );
  for (const t of tabsFiberNode.memoizedProps.tabs) {
    const key = String(t?.key);
    if (!key.startsWith(QT_KEY_PREFIX)) nativeTabCache.set(key, t);
  }
};

export const addQamTabDiscovery = async () => {
  relay("Quick Tab plugin loaded, installing QAM patch");

  try {
    const saved = await call<[], { order: string[]; hidden: string[] }>("get_tab_settings");
    setTabSettings({ order: saved?.order ?? [], hidden: saved?.hidden ?? [] });
  } catch (e) {
    relay(`failed to load saved tab settings: ${e}`);
  }

  const qamModule = findModuleByExport((e) =>
    e?.type?.toString?.()?.includes("QuickAccessMenuBrowserView"),
  );
  if (!qamModule) {
    relay("QAM module not found — Steam's UI internals may have changed.");
    return;
  }

  qamBrowserViewRenderer = Object.values(qamModule).find((e: any) =>
    e?.type?.toString?.()?.includes("QuickAccessMenuBrowserView"),
  );
  qamEmbeddedRenderer = Object.values(qamModule).find((e: any) =>
    e?.type?.toString?.()?.includes("QuickAccessMenuEmbedded"),
  );
  if (!qamBrowserViewRenderer) {
    relay("QuickAccessMenuBrowserView renderer not found in module.");
    return;
  }
  relay("QAM renderer(s) found, patching render output...");

  const patchHandler = createReactTreePatcher(
    [(tree) => findInReactTree(tree, (node) => node?.props?.onFocusNavDeactivated)],
    (_args, ret) => {
      const tabsNode = findInReactTree(ret, (x) => x?.props?.tabs);
      if (!tabsNode) return ret;
      const plugins = findPluginsFromRoot();
      if (!plugins) {
        relay("render patch fired, but the plugins list Provider wasn't found from root.");
        return ret;
      }
      const byName = new Map(plugins.map((p) => [p.name, p]));
      syncQamTabs(tabsNode.props.tabs, byName);
      return ret;
    },
    "QuickTabInject",
  );

  qamBrowserViewPatch = afterPatch(qamBrowserViewRenderer, "type", patchHandler);
  if (qamEmbeddedRenderer) {
    qamEmbeddedPatch = afterPatch(qamEmbeddedRenderer, "type", patchHandler);
  }

  // The QAM only exists in the DOM while actually open — at plugin-load
  // time (now, rather than waiting for the settings panel's own mount)
  // that's often not the case yet, so this may not find anything. See
  // refreshNativeTabsCache's own comment for why that's fine: it's called
  // again from the settings panel's mount, and the very next real QAM
  // render (the normal, already-installed patch above) seeds it anyway.
  refreshNativeTabsCache();
};

export const removeQamTabDiscovery = () => {
  qamBrowserViewPatch?.unpatch();
  qamEmbeddedPatch?.unpatch();
  qamBrowserViewPatch = undefined;
  qamEmbeddedPatch = undefined;
};
