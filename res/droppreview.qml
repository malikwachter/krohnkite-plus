/*
    SPDX-License-Identifier: MIT

    Drop preview: while a tiled window is dragged, highlights where it will
    land (the tile it swaps with) in the theme's accent color.

    Built like popup.qml (PlasmaCore.Dialog, outputOnly = transparent for
    input). If this file fails to load, main.qml falls back to
    droppreview-window.qml.
*/

import QtQuick 2.15
import org.kde.plasma.core as PlasmaCore

PlasmaCore.Dialog {
    id: preview
    type: PlasmaCore.Dialog.OnScreenDisplay
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus
    location: PlasmaCore.Types.Floating
    backgroundHints: PlasmaCore.Dialog.NoBackground
    outputOnly: true
    visible: false

    /* true: swap with the highlighted tile, false: window goes back here */
    property bool swap: true

    SystemPalette {
        id: palette
        colorGroup: SystemPalette.Active
    }

    mainItem: Item {
        id: content
        width: 100
        height: 100

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
    }

    function show(x, y, w, h, swap) {
        preview.swap = swap;
        content.width = Math.max(1, w);
        content.height = Math.max(1, h);
        preview.x = x;
        preview.y = y;
        preview.visible = true;
    }

    function hide() {
        preview.visible = false;
    }
}
