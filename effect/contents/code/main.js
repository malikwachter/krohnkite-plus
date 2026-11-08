/*
    SPDX-License-Identifier: MIT

    Kröhnkite-Plus Smooth - companion desktop effect for the Kröhnkite-Plus script.

    KWin scripts can only move windows instantly. This effect animates every
    size/position change that does not come from the user's mouse: the
    window is drawn sliding and scaling from its old to its new geometry.
    That covers focus grow, windows moving out of the way in the drag
    preview and the dropped window settling into its place.

    Tray layer: windows of "quickview" apps (QuickviewClasses) grow out of
    their tray icon when they appear and shrink back into it when they are
    closed or minimized. The icon's place is where the mouse was on the
    panel when the app was opened; for apps that open on their own the last
    known place is used, or the end of the panel where the tray sits.

    The duration and the quickview apps are written by Krohnkite (its
    "Animation speed" setting and its quickview list).
*/

"use strict";

var krohnkiteSmooth = {
    duration: 150,
    /* running animation per window */
    running: new Map(),
    /* windows whose next geometry change belongs to (un)maximizing */
    skipNext: new Set(),
    /* when a window appeared: its first placement is not animated */
    added: new Map(),
    /* quickview windows growing out of the tray: until when */
    appearing: new Map(),
    /* tray layer: app classes (lower case) and the last tray icon place per app */
    quickview: [],
    tray: {},

    loadConfig: function () {
        var d = Number(effect.readConfig("Duration", 150));
        krohnkiteSmooth.duration = isFinite(d) ? Math.max(0, Math.min(2000, d)) : 150;
        var q = String(effect.readConfig("QuickviewClasses", "") || "");
        krohnkiteSmooth.quickview = q.split(",").map(function (c) { return c.trim().toLowerCase(); })
            .filter(function (c) { return c !== ""; });
    },

    /* ------------------------------------------------------------ tray layer */

    now: function () { return Date.now(); },

    /** "resourceName resourceClass" -> the app key we know it by, or "" */
    quickviewKey: function (w) {
        var self = krohnkiteSmooth;
        if (!w || self.quickview.length === 0) return "";
        if (w.dialog || w.transient || w.modal) return "";
        if (w.normalWindow === false) return "";
        var parts = String(w.windowClass || "").toLowerCase().split(/\s+/);
        for (var i = 0; i < parts.length; i++)
            if (parts[i] !== "" && self.quickview.indexOf(parts[i]) >= 0) return parts[i];
        return "";
    },

    trayDuration: function () {
        var d = krohnkiteSmooth.duration;
        return d <= 0 ? 0 : Math.max(220, Math.round(d * 1.6));
    },

    docks: function () {
        var out = [];
        var stack = effects.stackingOrder || [];
        for (var i = 0; i < stack.length; i++) if (stack[i] && stack[i].dock) out.push(stack[i]);
        return out;
    },

    inside: function (p, g) {
        return p && g && p.x >= g.x && p.x < g.x + g.width && p.y >= g.y && p.y < g.y + g.height;
    },

    /** where the tray icon of this app is (as good as we can tell) */
    trayPoint: function (w, key) {
        var self = krohnkiteSmooth;
        var docks = self.docks();
        var c = effects.cursorPos;
        for (var i = 0; i < docks.length; i++) {
            var dg = docks[i].geometry || docks[i].frameGeometry;
            if (self.inside(c, dg)) {
                self.tray[key] = { x: c.x, y: c.y };
                return self.tray[key];
            }
        }
        if (self.tray[key]) return self.tray[key];
        var wg = w.geometry || w.frameGeometry;
        var center = { x: wg.x + wg.width / 2, y: wg.y + wg.height / 2 };
        var panel = null;
        for (var j = 0; j < docks.length; j++) {
            var g = docks[j].geometry || docks[j].frameGeometry;
            if (!g) continue;
            /* the panel on the same screen: the one closest to the window */
            var dx = Math.max(g.x - center.x, 0, center.x - (g.x + g.width));
            var dy = Math.max(g.y - center.y, 0, center.y - (g.y + g.height));
            var dist = dx * dx + dy * dy;
            if (panel === null || dist < panel.dist) panel = { g: g, dist: dist };
        }
        if (panel !== null) {
            var pg = panel.g;
            /* the system tray sits at the end of the panel, before the clock */
            if (pg.width >= pg.height) return { x: pg.x + pg.width - pg.height * 3, y: pg.y + pg.height / 2 };
            return { x: pg.x + pg.width / 2, y: pg.y + pg.height - pg.width * 3 };
        }
        return { x: wg.x + wg.width, y: wg.y };
    },

    grab: function (w, role) {
        try {
            if (typeof effect.grab === "function" && role !== undefined) effect.grab(w, role);
        } catch (e) { /* older KWin: other effects may animate too */ }
    },

    trayAnimations: function (w, key, out) {
        var self = krohnkiteSmooth;
        var g = w.geometry || w.frameGeometry;
        var p = self.trayPoint(w, key);
        var dx = p.x - (g.x + g.width / 2);
        var dy = p.y - (g.y + g.height / 2);
        var s = Math.max(0.03, Math.min(0.25, 48 / Math.max(1, Math.max(g.width, g.height))));
        var small = { value1: s, value2: s }, full = { value1: 1, value2: 1 };
        var there = { value1: dx, value2: dy }, here = { value1: 0, value2: 0 };
        return [
            { type: Effect.Scale, from: out ? full : small, to: out ? small : full },
            { type: Effect.Translation, from: out ? here : there, to: out ? there : here },
            { type: Effect.Opacity, from: out ? 1 : 0, to: out ? 0 : 1 }
        ];
    },

    /** a quickview appears: grow out of the tray icon */
    appear: function (w) {
        var self = krohnkiteSmooth;
        var key = self.quickviewKey(w);
        if (key === "" || self.trayDuration() <= 0 || !w.visible) return false;
        var g = w.geometry || w.frameGeometry;
        if (!g || g.width <= 0 || g.height <= 0) return false;
        self.stop(w);
        var id = animate({
            window: w,
            duration: self.trayDuration(),
            curve: QEasingCurve.OutCubic,
            animations: self.trayAnimations(w, key, false)
        });
        if (id !== undefined && id !== null) self.running.set(w, id);
        self.appearing.set(w, self.now() + self.trayDuration());
        return true;
    },

    /** a quickview goes: shrink back into the tray icon */
    disappear: function (w, role) {
        var self = krohnkiteSmooth;
        var key = self.quickviewKey(w);
        if (key === "" || self.trayDuration() <= 0) return false;
        var g = w.geometry || w.frameGeometry;
        if (!g || g.width <= 0 || g.height <= 0) return false;
        self.stop(w);
        self.appearing.delete(w);
        self.grab(w, role);
        var id = animate({
            window: w,
            duration: self.trayDuration(),
            curve: QEasingCurve.InCubic,
            animations: self.trayAnimations(w, key, true)
        });
        if (id !== undefined && id !== null) self.running.set(w, id);
        return true;
    },

    onAdded: function (w) {
        var self = krohnkiteSmooth;
        self.added.set(w, self.now());
        if (self.quickviewKey(w) !== "") {
            self.grab(w, Effect.WindowAddedGrabRole);
            self.appear(w);
        }
    },

    /* the same event can arrive per window and globally: handle it once */
    once: function (w, kind) {
        var self = krohnkiteSmooth;
        var k = kind + ":" + (w.internalId !== undefined ? w.internalId : "");
        var t = self.now();
        if (!self.seen) self.seen = new Map();
        var last = self.seen.get(w);
        if (last && last.k === k && t - last.t < 50) return false;
        self.seen.set(w, { k: k, t: t });
        return true;
    },
    onMinimized: function (w) {
        if (krohnkiteSmooth.once(w, "min")) krohnkiteSmooth.disappear(w, Effect.WindowMinimizedGrabRole);
    },
    onUnminimized: function (w) {
        if (krohnkiteSmooth.once(w, "unmin")) {
            krohnkiteSmooth.grab(w, Effect.WindowUnminimizedGrabRole);
            krohnkiteSmooth.appear(w);
        }
    },
    onClosed: function (w) {
        if (krohnkiteSmooth.once(w, "closed")) krohnkiteSmooth.disappear(w, Effect.WindowClosedGrabRole);
    },

    /** windows that should never be animated by us */
    ignored: function (w) {
        if (!w || w.deleted || !w.visible || w.minimized) return true;
        if (w.desktopWindow || w.dock || w.popupWindow || w.outline) return true;
        if (w.fullScreen) return true;
        if (!(w.normalWindow || w.dialog || w.utility)) return true;
        return false;
    },

    onGeometryChanged: function (w, oldGeometry) {
        var self = krohnkiteSmooth;
        if (self.duration <= 0 || !oldGeometry) return;
        // the user is dragging / resizing this window: follow the mouse 1:1
        if (w.move || w.resize) {
            self.stop(w);
            return;
        }
        if (self.skipNext.has(w)) {
            self.skipNext.delete(w);
            return;
        }
        if (self.ignored(w)) return;
        /* a quickview that is still growing out of the tray was moved into
           its place (apps restoring their old place): grow towards the new one */
        var until = self.appearing.get(w);
        if (until !== undefined) {
            if (self.now() < until) {
                self.appear(w);
                return;
            }
            self.appearing.delete(w);
        }
        /* the first placement of a new popup (dialog) is not a movement */
        var addedAt = (w.dialog || w.transient || w.modal) ? self.added.get(w) : undefined;
        if (addedAt !== undefined) {
            if (self.now() - addedAt < 300) return;
            self.added.delete(w);
        }
        var g = w.geometry || w.frameGeometry;
        if (!g || g.width <= 0 || g.height <= 0 || oldGeometry.width <= 0 || oldGeometry.height <= 0) return;
        var dx = (oldGeometry.x + oldGeometry.width / 2) - (g.x + g.width / 2);
        var dy = (oldGeometry.y + oldGeometry.height / 2) - (g.y + g.height / 2);
        var dw = oldGeometry.width - g.width;
        var dh = oldGeometry.height - g.height;
        // tiny corrections (rounding, size hints) are not worth an animation
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(dw) < 2 && Math.abs(dh) < 2) return;
        self.stop(w);
        var id = animate({
            window: w,
            duration: self.duration,
            curve: QEasingCurve.OutCubic,
            animations: [
                {
                    type: Effect.Size,
                    from: { value1: oldGeometry.width, value2: oldGeometry.height },
                    to: { value1: g.width, value2: g.height }
                },
                {
                    type: Effect.Translation,
                    from: { value1: dx, value2: dy },
                    to: { value1: 0, value2: 0 }
                }
            ]
        });
        if (id !== undefined && id !== null) self.running.set(w, id);
        if (self.logged < 3) {
            self.logged++;
            print("Kröhnkite-Plus Smooth: animating " + (w.windowClass || "window") + " (" +
                  Math.round(oldGeometry.width) + "x" + Math.round(oldGeometry.height) + " -> " +
                  Math.round(g.width) + "x" + Math.round(g.height) + ")");
        }
    },

    stop: function (w) {
        var id = krohnkiteSmooth.running.get(w);
        if (id !== undefined) {
            try { cancel(id); } catch (e) { /* already finished */ }
            krohnkiteSmooth.running.delete(w);
        }
    },

    /* connect only to signals this KWin version actually has */
    on: function (obj, name, fn) {
        if (obj && obj[name] && typeof obj[name].connect === "function") {
            obj[name].connect(fn);
            return true;
        }
        return false;
    },

    /* windows whose signals we already listen to */
    managed: new Set(),
    /* a few log lines so it is easy to see that animations happen */
    logged: 0,

    /*
     * Plasma 6 emits the window signals on each window (EffectWindow), not on
     * `effects` any more: connect to every existing and every new window.
     */
    manage: function (w) {
        var self = krohnkiteSmooth;
        if (!w || self.managed.has(w)) return;
        self.managed.add(w);
        self.on(w, "windowFrameGeometryChanged", function (win, oldGeometry) {
            // the signal passes (window, oldGeometry); be tolerant to (oldGeometry)
            if (oldGeometry === undefined && win && win.width !== undefined && win.move === undefined)
                self.onGeometryChanged(w, win);
            else self.onGeometryChanged(win || w, oldGeometry);
        });
        self.on(w, "windowMaximizedStateAboutToChange", function () { self.skipNext.add(w); });
        self.on(w, "windowMaximizedStateChanged", function () { self.stop(w); });
        self.on(w, "windowFullScreenChanged", function () { self.stop(w); });
        self.on(w, "windowStartUserMovedResized", function () { self.stop(w); });
        self.on(w, "windowMinimized", function () { self.onMinimized(w); });
        self.on(w, "windowUnminimized", function () { self.onUnminimized(w); });
    },

    init: function () {
        var self = krohnkiteSmooth;
        self.loadConfig();
        self.on(effect, "configChanged", self.loadConfig);

        // Plasma 6: per-window signals
        var perWindow = self.on(effects, "windowAdded", function (w) {
            self.manage(w);
            self.onAdded(w);
        });
        if (perWindow) {
            var stack = effects.stackingOrder || [];
            for (var i = 0; i < stack.length; i++) self.manage(stack[i]);
        }
        // older KWin: global signals (harmless if they do not exist)
        var global = self.on(effects, "windowFrameGeometryChanged", self.onGeometryChanged);
        self.on(effects, "windowMaximizedStateAboutToChange", function (w) { self.skipNext.add(w); });
        self.on(effects, "windowFullScreenChanged", function (w) { self.stop(w); });

        self.on(effects, "windowMinimized", self.onMinimized);
        self.on(effects, "windowUnminimized", self.onUnminimized);
        self.on(effects, "windowClosed", self.onClosed);

        self.on(effects, "windowDeleted", function (w) {
            self.running.delete(w);
            self.skipNext.delete(w);
            self.managed.delete(w);
            self.added.delete(w);
            self.appearing.delete(w);
            if (self.seen) self.seen.delete(w);
        });
        self.on(effect, "animationEnded", function (w) { self.running.delete(w); });
        print("Kröhnkite-Plus Smooth loaded, duration " + self.duration + " ms, " +
              (perWindow ? "per-window signals (" + self.managed.size + " windows)" : "") +
              (global ? " global signals" : "") +
              (!perWindow && !global ? "NO geometry signal found - nothing will be animated" : ""));
    }
};

krohnkiteSmooth.init();
