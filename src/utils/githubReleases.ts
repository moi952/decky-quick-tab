// @ts-ignore — replaced at build time by rollup with the content of plugin.json
import manifest from "@decky/manifest";
import { fetchPluginReleases as fetchReleasesForRepo, PluginRelease } from "@moi952/decky-plugin-toolkit";

import projectConfig from "../project.config.json";

export const CURRENT_VERSION: string = manifest?.version ?? "0.0.0";

const REPO = `${projectConfig.githubOwner}/${projectConfig.githubRepo}`;

// Passed as GitHubSection's `fetchReleases` prop — only this plugin's own
// repo is specific to quick-tab, the actual fetch/parse logic lives in
// the toolkit (fetchPluginReleases).
export const fetchPluginReleases = (): Promise<PluginRelease[]> => fetchReleasesForRepo(REPO);
