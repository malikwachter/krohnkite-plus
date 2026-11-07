/*
    SPDX-License-Identifier: MIT

    Drop preview: while a tiled window is dragged, highlights where it will
    land (the tile it swaps with) in the theme's accent color.
    Transparent for input, so it never gets in the way of the drop.
    Fallback for droppreview.qml (QtQuick Window instead of PlasmaCore.Dialog).
*/

import QtQuick 2.15
import QtQuick.Window 2.15

Window {
    id: preview
    title: "krohnkite-preview"
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus
         | Qt.WindowTransparentForInput | Qt.Tool
    color: "transparent"
    visible: false
    width: 100
    height: 100

    /* true: swap with the highlighted tile, false: window goes back here */
    property bool swap: true

    SystemPalette {
        id: palette
        colorGroup: SystemPalette.Active
    }

    Rectangle {
        anchors.fill: parent
        anchors.margins: 2
        radius: 8
        color: Qt.rgba(palette.highlight.r, palette.highlight.g, palette.highlight.b,
                       preview.swap ? 0.22 : 0.08)
        border.width: preview.swap ? 3 : 2
        border.color: Qt.rgba(palette.highlight.r, palette.highlight.g, palette.highlight.b,
                              preview.swap ? 0.95 : 0.55)
    }

    function show(x, y, w, h, swap) {
        preview.swap = swap;
        preview.x = x;
        preview.y = y;
        preview.width = Math.max(1, w);
        preview.height = Math.max(1, h);
        preview.visible = true;
    }

    function hide() {
        preview.visible = false;
    }
}
