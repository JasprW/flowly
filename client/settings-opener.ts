import { createContext, useContext } from "react";
import type { SettingsSection } from "./summary-settings";

/** Opens the board's Settings at a section, e.g. Connections from the drawer's + menu (CONNECTORS-SPEC §8.1). */
export const SettingsOpenerContext = createContext<((section: SettingsSection) => void) | null>(null);
export const useSettingsOpener = () => useContext(SettingsOpenerContext);
