/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class KWinTimerPool {
  public static readonly instance = new KWinTimerPool();

  private timers: QTimer[];
  private activeTimers: Array<{ timer: QTimer; callback: () => void }>;
  private generation: number;
  public numTimers: number;

  constructor() {
    this.timers = [];
    this.activeTimers = [];
    this.generation = 0;
    this.numTimers = 0;
  }

  public setTimeout(func: () => void, timeout: number) {
    if (this.timers.length === 0) {
      this.numTimers++;
      LOG?.send(
        LogModules.setTimeout,
        "setTimeout/newTimer",
        `numTimers: ${this.numTimers}`
      );
    }

    const timer: QTimer =
      this.timers.pop() ||
      Qt.createQmlObject("import QtQuick 2.0; Timer {}", scriptRoot);

    const generation = this.generation;
    const callback = () => {
      try {
        timer.triggered.disconnect(callback);
      } catch (e) {
        /* ignore */
      }
      try {
        func();
      } catch (e) {
        /* ignore */
      }
      this.removeActive(timer, callback);
      if (generation === this.generation) this.timers.push(timer);
    };

    timer.interval = timeout;
    timer.repeat = false;
    timer.triggered.connect(callback);
    this.activeTimers.push({ timer, callback });
    timer.start();
  }

  /** Stop every pending callback and release all dynamically-created timers. */
  public dispose() {
    this.generation++;
    for (const entry of this.activeTimers.splice(0)) {
      try {
        entry.timer.stop();
        entry.timer.triggered.disconnect(entry.callback);
        entry.timer.destroy();
      } catch (_) {
        /* The QML object may already be gone during script destruction. */
      }
    }
    for (const timer of this.timers.splice(0)) {
      try {
        timer.stop();
        timer.destroy();
      } catch (_) {
        /* The QML object may already be gone during script destruction. */
      }
    }
    this.numTimers = 0;
  }

  private removeActive(timer: QTimer, callback: () => void) {
    const idx = this.activeTimers.findIndex(
      (entry) => entry.timer === timer && entry.callback === callback,
    );
    if (idx >= 0) this.activeTimers.splice(idx, 1);
  }
}

function KWinSetTimeout(func: () => void, timeout: number) {
  KWinTimerPool.instance.setTimeout(func, timeout);
}
