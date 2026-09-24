// Shared with the server layout, so this module must not import React hooks.
export const THEME_KEY = 'phishguard_theme';

// Runs in <head> before first paint so a saved light theme never flashes dark.
// Kept as a string because it executes before React loads.
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
