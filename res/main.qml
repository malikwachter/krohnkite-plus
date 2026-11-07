/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

import QtQuick 2.15
import org.kde.plasma.core as PlasmaCore;
import org.kde.plasma.components as Plasma;
import org.kde.plasma.plasma5support as Plasma5Support
import org.kde.kwin 3.0;
import org.kde.taskmanager as TaskManager
import "../code/script.js" as K

Item {
    id: scriptRoot

    TaskManager.ActivityInfo {
        id: activityInfo
    }

    Loader {
        id: popupDialog
        source: "popup.qml"

        function showNotification(text, duration) {
            var area = Workspace.clientArea(KWin.FullScreenArea, Workspace.activeScreen, Workspace.currentDesktop);
            this.item.show(text, area, duration);
        }
    }

    Component.onCompleted: {
        console.log("KROHNKITE: starting the script");
        const api = {
            "workspace": Workspace,
            // "options": Options,
            "kwin": KWin,
            "shortcuts": shortcutsLoader.item,
            "dbus": dbusCallLoader.item,
            "shell": shellRunner,
            "preview": function() { return dropPreviewLoader.item; }
        };

        (new K.KWinDriver(api)).main();
    }
    Loader {
        id: shortcutsLoader;

        source: "shortcuts.qml";
    }

    /* runs shell commands for saving/loading state (see persist.ts) */
    Plasma5Support.DataSource {
        id: shellRunner
        engine: "executable"
        connectedSources: []
        property var callbacks: ({})
        property int counter: 0

        onNewData: function(source, data) {
            var cb = callbacks[source];
            delete callbacks[source];
            disconnectSource(source);
            if (cb) cb(data["exit code"], data["stdout"], data["stderr"]);
        }

        function run(cmd, callback) {
            /* a unique suffix keeps two equal commands apart */
            counter += 1;
            var source = cmd + " #" + counter;
            callbacks[source] = callback;
            connectSource(source);
        }
    }

    /* optional: if it fails to load, tiling still works without the preview */
    Loader {
        id: dropPreviewLoader;

        source: "droppreview.qml"
        onStatusChanged: {
            if (status === Loader.Error && source.toString().indexOf("droppreview-window") < 0) {
                console.warn("Krohnkite Smart: droppreview.qml failed, using droppreview-window.qml");
                source = "droppreview-window.qml";
            }
        }
    }

    Loader {
        id: dbusCallLoader;

        source: "dbus.qml"
    }
}
