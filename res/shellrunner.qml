/*
    SPDX-License-Identifier: MIT

    Kröhnkite-Plus: runs shell commands for saving/loading the state
    (persist.ts) and for passing the animation speed to the Kröhnkite-Plus Smooth
    effect. Loaded through a Loader: without Plasma5Support everything else
    keeps working, only these two features are off.
*/

import QtQuick 2.15
import org.kde.plasma.plasma5support as Plasma5Support

Item {
    Plasma5Support.DataSource {
        id: runner
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
    }

    function run(cmd, callback) {
        /* a unique suffix keeps two equal commands apart */
        runner.counter += 1;
        var source = cmd + " #" + runner.counter;
        runner.callbacks[source] = callback;
        runner.connectSource(source);
    }
}
