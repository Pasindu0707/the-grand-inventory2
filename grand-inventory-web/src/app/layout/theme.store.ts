/**
 * Light or dark, remembered per device.
 *
 * Per device rather than per person on purpose: the tablet by the walk-in is
 * read in a dim corridor and the office machine sits under a window, and the
 * same storekeeper signs in at both.
 */
import { Injectable, signal } from '@angular/core';

const KEY = 'grand-console-theme';

@Injectable({ providedIn: 'root' })
export class ThemeStore {
    readonly dark = signal(false);

    constructor() {
        let stored: string | null = null;
        try {
            stored = localStorage.getItem(KEY);
        } catch {
            /* private browsing; fall through to the system preference */
        }
        const prefersDark =
            typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
        this.apply(stored ? stored === 'dark' : prefersDark);
    }

    toggle(): void {
        this.apply(!this.dark());
    }

    private apply(dark: boolean): void {
        this.dark.set(dark);
        document.documentElement.classList.toggle('app-dark', dark);
        try {
            localStorage.setItem(KEY, dark ? 'dark' : 'light');
        } catch {
            /* ignore */
        }
    }
}
