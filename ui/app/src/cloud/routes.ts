import { type Handler } from "./http";
import { HOME_ROUTES } from "./home";
import { TOOL_ROUTES } from "./tools";
import { AI_APP_ROUTES } from "./aiApp";
import { SYSTEM_SETTINGS_ROUTES } from "./systemSettings";
import { CREDIT_ROUTES } from "./credits";
import { BROWSER_LINK_ROUTES } from "./browserLinks";
import { ACTIVITY_ROUTES } from "./activity";

/**
 * The admin API's routes the browser answers itself, over Wysebee Cloud's own: Home and the
 * agents (home.ts), their tools and skills, the AI app, Wysebee's settings, the account's usage, paired
 * devices and Activity. Tasks (2026-11-16) and workspaces are Wysebee Cloud's own paths, sent
 * straight up (forward.ts).
 */
export type KindRoute = [method: string, path: string, handler: Handler];

export const KIND_ROUTES: KindRoute[] = [...HOME_ROUTES, ...TOOL_ROUTES, ...AI_APP_ROUTES, ...SYSTEM_SETTINGS_ROUTES, ...CREDIT_ROUTES, ...BROWSER_LINK_ROUTES, ...ACTIVITY_ROUTES];
