/*
    SPDX-License-Identifier: MIT

    Drop preview while a tiled window is dragged: a soft, translucent
    silhouette in the (unfocused, darker) accent color, exactly where and
    as big as the window will be after the drop.

    One transparent overlay per monitor covers the whole screen and is
    positioned only while hidden; moving overlay windows while they are
    shown is not reliable. Only the box inside moves, relative to the
    overlay's real position, so it is exact even if KWin shifts the overlay.

    Built from PlasmaCore.Dialog like popup.qml (outputOnly = transparent for
    input). If this file fails to load, main.qml falls back to
    droppreview-window.qml (same thing with a QtQuick Window).
*/

import QtQuick 2.15
import org.kde.plasma.core as PlasmaCore

Item {
    id: manager

    /* output name -> overlay */
    property var overlays: ({})

    SystemPalette {
        id: palette
        colorGroup: SystemPalette.Inactive
    }

    readonly property color tint: Qt.darker(palette.highlight, 1.35)

    Component {
        id: overlayComponent

        PlasmaCore.Dialog {
            id: ov
            type: PlasmaCore.Dialog.OnScreenDisplay
            flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus
            location: PlasmaCore.Types.Floating
            backgroundHints: PlasmaCore.Dialog.NoBackground
            outputOnly: true
            visible: false

            property real areaX: -1
            property real areaY: -1
            property real areaW: -1
            property real areaH: -1
            property real boxX: 0
            property real boxY: 0
            property real boxW: 0
            property real boxH: 0
            property bool swap: true

            mainItem: Item {
                id: canvas
                width: 100
                height: 100

                Rectangle {
                    x: ov.boxX - ov.x
                    y: ov.boxY - ov.y
                    width: ov.boxW
                    height: ov.boxH
                    radius: 6
                    color: Qt.rgba(manager.tint.r, manager.tint.g, manager.tint.b, ov.swap ? 0.38 : 0.26)
                    border.width: 2
                    border.color: Qt.rgba(manager.tint.r, manager.tint.g, manager.tint.b, 0.75)
                }
            }

            function setArea(x, y, w, h) {
                canvas.width = w;
                canvas.height = h;
                ov.x = x;
                ov.y = y;
            }
        }
    }

    /* PlasmaCore.Dialog: `visible` is what popup.qml uses, too */
    function setShown(ov, shown) {
        ov.visible = shown;
    }

    function overlayFor(key) {
        var ov = overlays[key];
        if (!ov) {
            ov = overlayComponent.createObject(manager);
            overlays[key] = ov;
        }
        return ov;
    }

    /* (ox, oy, ow, oh): the monitor; (x, y, w, h): the silhouette */
    function show(key, ox, oy, ow, oh, x, y, w, h, swap) {
        for (var k in overlays)
            if (k !== key && overlays[k].visible) setShown(overlays[k], false);
        var ov = overlayFor(key);
        if (ov.areaX !== ox || ov.areaY !== oy || ov.areaW !== ow || ov.areaH !== oh) {
            if (ov.visible) setShown(ov, false);
            ov.setArea(ox, oy, ow, oh);
            ov.areaX = ox;
            ov.areaY = oy;
            ov.areaW = ow;
            ov.areaH = oh;
        }
        ov.swap = swap;
        ov.boxX = x;
        ov.boxY = y;
        ov.boxW = Math.max(1, w);
        ov.boxH = Math.max(1, h);
        if (!ov.visible) setShown(ov, true);
    }

    function hide() {
        for (var k in overlays)
            if (overlays[k].visible) setShown(overlays[k], false);
    }
}
