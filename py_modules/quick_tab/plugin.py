import json
import subprocess
import traceback
from pathlib import Path
from typing import Any, Dict, List

import decky
from decky_plugin_toolkit import PluginUpdaterMixin, WhatsNewSeenMixin, OtherPluginsSeenMixin


class Plugin(PluginUpdaterMixin, WhatsNewSeenMixin, OtherPluginsSeenMixin):
    async def _main(self):
        decky.logger.info("Quick Tab plugin loaded")
        try:
            update_info = await self.check_plugin_update_on_load()
            if update_info:
                decky.logger.info(f"[_main] update available: {update_info['latest_version']}")
                await decky.emit("plugin_update_available", update_info)
        except Exception:
            decky.logger.error(f"[_main] update check failed:\n{traceback.format_exc()}")

    # Relays frontend discovery output into journalctl — the frontend's own
    # console.log only reaches Steam's CEF devtools, which isn't reachable
    # without a remote-debugging session, unlike this plugin's own backend
    # logs.
    async def log_debug(self, message: str):
        decky.logger.info(f"[quick-tab] {message}")

    # ── QAM tab settings (backend-persisted so it survives a Steam restart)
    # `order` is the full desired order of every tab key the user has ever
    # arranged: Steam's own native tabs (their numeric QuickAccessTab id, as
    # a string), Decky's own aggregate tab ("999"), and pinned plugins
    # ("quick-tab:<plugin name>"). Empty means "no explicit order yet" — the
    # frontend then falls back to Steam's own current natural order, all
    # visible, per the "leave every official tab shown on first install"
    # requirement. `hidden` holds native tab keys the user chose to hide
    # (only Notifications/VoiceChat/Help/Music are offered for that).

    def _tab_settings_path(self) -> Path:
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "tab_settings.json"

    async def get_tab_settings(self) -> Dict[str, Any]:
        try:
            path = self._tab_settings_path()
            if path.is_file():
                return json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            decky.logger.error(f"[get_tab_settings] {e}")
        return {"order": [], "hidden": []}

    async def set_tab_settings(self, order: List[str], hidden: List[str]) -> bool:
        try:
            path = self._tab_settings_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            data = {"order": order, "hidden": hidden}
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            decky.logger.info(f"[set_tab_settings] saved {data}")
            return True
        except Exception as e:
            decky.logger.error(f"[set_tab_settings] {e}")
            return False

    # `-shutdown` is Steam's own graceful-restart request — under a
    # gamescope/Big Picture session (this plugin's only real target),
    # the session itself relaunches Steam once it exits this way, rather
    # than dropping to the desktop or ending the session outright.
    async def restart_steam(self) -> bool:
        try:
            subprocess.Popen(["steam", "-shutdown"])
            decky.logger.info("[restart_steam] requested")
            return True
        except Exception as e:
            decky.logger.error(f"[restart_steam] {e}")
            return False

    async def _unload(self):
        decky.logger.info("Quick Tab plugin unloaded")

    async def _uninstall(self):
        pass
