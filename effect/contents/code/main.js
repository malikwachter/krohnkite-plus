/*
    SPDX-License-Identifier: MIT

    Krohnkite Smooth - companion desktop effect for the Krohnkite (Smart) script.

    KWin scripts can only move windows instantly. This effect animates every
    size/position change that does not come from the user's mouse: the
    window is drawn sliding and scaling from its old to its new geometry.
    That covers focus grow, windows moving out of the way in the drag
    preview and the dropped window settling into its place.

    The duration is written by Krohnkite (its "Animation speed" setting).
*/

"use strict";

var krohnkiteSmooth = {
    duration: 150,
    /* running animation per window */
    running: new Map(),
    /* windows whose next geometry change belongs to (un)maximizing */
    skipNext: new Set(),

    loadConfig: function () {
        var d = Number(effect.readConfig("Duration", 150));
        krohnkiteSmooth.duration = isFinite(d) ? Math.max(0, Math.min(2000, d)) : 150;
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
            print("Krohnkite Smooth: animating " + (w.windowClass || "window") + " (" +
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
    },

    init: function () {
        var self = krohnkiteSmooth;
        self.loadConfig();
        self.on(effect, "configChanged", self.loadConfig);

        // Plasma 6: per-window signals
        var perWindow = self.on(effects, "windowAdded", self.manage);
        if (perWindow) {
            var stack = effects.stackingOrder || [];
            for (var i = 0; i < stack.length; i++) self.manage(stack[i]);
        }
        // older KWin: global signals (harmless if they do not exist)
        var global = self.on(effects, "windowFrameGeometryChanged", self.onGeometryChanged);
        self.on(effects, "windowMaximizedStateAboutToChange", function (w) { self.skipNext.add(w); });
        self.on(effects, "windowFullScreenChanged", function (w) { self.stop(w); });

        self.on(effects, "windowDeleted", function (w) {
            self.running.delete(w);
            self.skipNext.delete(w);
            self.managed.delete(w);
        });
        self.on(effect, "animationEnded", function (w) { self.running.delete(w); });
        print("Krohnkite Smooth loaded, duration " + self.duration + " ms, " +
              (perWindow ? "per-window signals (" + self.managed.size + " windows)" : "") +
              (global ? " global signals" : "") +
              (!perWindow && !global ? "NO geometry signal found - nothing will be animated" : ""));
    }
};

krohnkiteSmooth.init();
