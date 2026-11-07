/*
    SPDX-License-Identifier: MIT

    Drop preview while a tiled window is dragged: a soft, translucent
    silhouette in the (unfocused, darker) accent color, exactly where and
    as big as the window will be after the drop.

    One transparent overlay per monitor covers the whole screen and is
    positioned only while hidden; moving overlay windows while they are
    shown is not reliable. Only the box inside moves, relative to the
    overlay's real position, so it is exact even if KWin shifts the overlay.

    Fallback for droppreview.qml, using a QtQuick Window.
*/

import QtQuick 2.15
import QtQuick.Window 2.15

Item {
    id: manager

    /* output name -> overlay */
    property var overlays: ({})

    SystemPalette {
        id: palette
        colorGroup: SystemPalette.Inactive
    }

    readonly property color tint: Qt.darker(palette.highlight, 1.2)

    function shade(alpha) {
        return Qt.rgba(tint.r, tint.g, tint.b, alpha);
    }

    Component {
        id: overlayComponent

        Window {
            id: ov
            title: "krohnkite-preview"
            flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus
                 | Qt.WindowTransparentForInput | Qt.Tool
            color: "transparent"
            transientParent: null
            visible: false
            width: 100
            height: 100

            property real areaX: -1
            property real areaY: -1
            property real areaW: -1
            property real areaH: -1
            property real boxX: 0
            property real boxY: 0
            property real boxW: 0
            property real boxH: 0
            property bool swap: true
            /* where the box is growing to */
            property real targetX: 0
            property real targetY: 0
            property real targetW: 0
            property real targetH: 0
            property int duration: 150

            ParallelAnimation {
                id: grow
                NumberAnimation { target: ov; property: "boxX"; to: ov.targetX; duration: ov.duration; easing.type: Easing.OutCubic }
                NumberAnimation { target: ov; property: "boxY"; to: ov.targetY; duration: ov.duration; easing.type: Easing.OutCubic }
                NumberAnimation { target: ov; property: "boxW"; to: ov.targetW; duration: ov.duration; easing.type: Easing.OutCubic }
                NumberAnimation { target: ov; property: "boxH"; to: ov.targetH; duration: ov.duration; easing.type: Easing.OutCubic }
            }

            /*
             * A new drop place: the box grows out of the middle of the space
             * that is just being freed, in sync with the windows moving away
             * (same duration and curve as the Kröhnkite-Plus Smooth effect).
             */
            function moveBox(x, y, w, h, ms) {
                if (x === targetX && y === targetY && w === targetW && h === targetH) return;
                grow.stop();
                targetX = x;
                targetY = y;
                targetW = w;
                targetH = h;
                duration = ms;
                if (ms <= 0) {
                    boxX = x;
                    boxY = y;
                    boxW = w;
                    boxH = h;
                    return;
                }
                boxX = x + w / 2;
                boxY = y + h / 2;
                boxW = 0;
                boxH = 0;
                grow.start();
            }

            Item {
                id: canvas
                anchors.fill: parent

                /*
                 * The silhouette: almost clear in the middle, getting smoothly
                 * more opaque towards every edge (about 80 % at the edge).
                 * Two soft gradients, one per direction, laid over each other.
                 */
                Item {
                    id: box
                    x: ov.boxX - ov.x
                    y: ov.boxY - ov.y
                    width: ov.boxW
                    height: ov.boxH

                    /* how far the glow reaches into the box */
                    readonly property real reach: Math.min(0.42, 160 / Math.max(1, Math.min(width, height)))

                    Rectangle {
                        anchors.fill: parent
                        radius: 8
                        color: manager.shade(ov.swap ? 0.07 : 0.05)
                    }
                    Rectangle {
                        anchors.fill: parent
                        radius: 8
                        gradient: Gradient {
                            orientation: Gradient.Horizontal
                            GradientStop { position: 0.0; color: manager.shade(0.80) }
                            GradientStop { position: box.reach * 0.25; color: manager.shade(0.42) }
                            GradientStop { position: box.reach * 0.6; color: manager.shade(0.12) }
                            GradientStop { position: box.reach; color: manager.shade(0.0) }
                            GradientStop { position: 1.0 - box.reach; color: manager.shade(0.0) }
                            GradientStop { position: 1.0 - box.reach * 0.6; color: manager.shade(0.12) }
                            GradientStop { position: 1.0 - box.reach * 0.25; color: manager.shade(0.42) }
                            GradientStop { position: 1.0; color: manager.shade(0.80) }
                        }
                    }
                    Rectangle {
                        anchors.fill: parent
                        radius: 8
                        gradient: Gradient {
                            orientation: Gradient.Vertical
                            GradientStop { position: 0.0; color: manager.shade(0.80) }
                            GradientStop { position: box.reach * 0.25; color: manager.shade(0.42) }
                            GradientStop { position: box.reach * 0.6; color: manager.shade(0.12) }
                            GradientStop { position: box.reach; color: manager.shade(0.0) }
                            GradientStop { position: 1.0 - box.reach; color: manager.shade(0.0) }
                            GradientStop { position: 1.0 - box.reach * 0.6; color: manager.shade(0.12) }
                            GradientStop { position: 1.0 - box.reach * 0.25; color: manager.shade(0.42) }
                            GradientStop { position: 1.0; color: manager.shade(0.80) }
                        }
                    }
                    /* thin crisp edge so the exact size stays readable */
                    Rectangle {
                        anchors.fill: parent
                        radius: 8
                        color: "transparent"
                        border.width: 1
                        border.color: manager.shade(0.9)
                    }
                }
            }

            function setArea(x, y, w, h) {
                ov.width = w;
                ov.height = h;
                ov.x = x;
                ov.y = y;
            }
        }
    }

    /* QtQuick Windows under an item without a window ignore `visible = true`
     * (they wait for a "transient parent"); show()/hide() always work */
    function setShown(ov, shown) {
        if (shown) ov.show();
        else ov.hide();
    }

    function overlayFor(key) {
        var ov = overlays[key];
        if (!ov) {
            ov = overlayComponent.createObject(manager);
            overlays[key] = ov;
        }
        return ov;
    }

    /* (ox, oy, ow, oh): the monitor; (x, y, w, h): the silhouette;
       ms: grow animation duration (0 = none) */
    function show(key, ox, oy, ow, oh, x, y, w, h, swap, ms) {
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
        var wasVisible = ov.visible;
        if (!wasVisible) {
            ov.targetW = -1; // force a fresh grow when (re)appearing
        }
        ov.moveBox(x, y, Math.max(1, w), Math.max(1, h), ms === undefined ? 0 : ms);
        if (!wasVisible) setShown(ov, true);
    }

    function hide() {
        for (var k in overlays)
            if (overlays[k].visible) setShown(overlays[k], false);
    }
}
