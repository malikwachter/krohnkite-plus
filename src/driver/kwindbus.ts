/*
    SPDX-FileCopyrightText: 2025 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class DBusManager implements IDBus {
  private _isConnected: boolean = false;
  private _dBusConnectAttempts: number;
  private _existsCall: DBusCall;
  private _dBusMoveMouseToFocus: DBusCall;
  private _dBusMoveMouseToCenter: DBusCall;
  private _dBusMoveMouseToScreenCenter: DBusCall;
  private _vkVisibleCall: DBusCall;
  private _vkCallbacks: Array<(isVisible: boolean) => void> = [];
  private _vkCallInFlight: boolean = false;
  private _entered: boolean = false;
  private _disposed: boolean = false;
  private _connections: Array<{ signal: Signal<any>; callback: any }> = [];

  constructor(dBusQml: IDBusQml) {
    try {
      this._dBusMoveMouseToFocus = dBusQml.getDBusMoveMouseToFocus();
      this._dBusMoveMouseToCenter = dBusQml.getDBusMoveMouseToCenter();
      this._dBusMoveMouseToScreenCenter =
        dBusQml.getDBusMoveMouseToScreenCenter();
      this._connect(
        this._dBusMoveMouseToCenter.finished,
        this.moveMouseToFocusCallback.bind(this),
      );
      this._connect(this._dBusMoveMouseToFocus.failed, () => {
        LOG?.send(LogModules.dbus, "callFailed", " 'MoveMouseToFocus' failed");
      });
      this._connect(this._dBusMoveMouseToCenter.failed, () => {
        LOG?.send(LogModules.dbus, "callFailed", " 'MoveMouseToCenter' failed");
      });
      this._dBusConnectAttempts = 40;
      this._existsCall = dBusQml.getDBusExists();
      this._connect(this._existsCall.finished, this._dBusIsOn.bind(this));
      this._connect(this._existsCall.failed, this._checkDBusConn.bind(this));
      this._existsCall.call();

      this._vkVisibleCall = dBusQml.getDBusVirtualKeyboardVisible();
      this._connect(this._vkVisibleCall.finished, this._onVKResult.bind(this));
      this._connect(this._vkVisibleCall.failed, this._onVKFailed.bind(this));
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private _dBusIsOn() {
    this._isConnected = true;
    info("DBus: connected");
  }
  private _checkDBusConn() {
    if (this._dBusConnectAttempts-- > 0)
      this.setTimeout(this._existsCall.call, 500);
    else warning("DBus failed");
  }
  public moveMouseToCenter(timeout?: number) {
    if (!this._isConnected) return;
    if (timeout !== undefined)
      this.setTimeout(this._dBusMoveMouseToCenter.call, timeout);
    else this._dBusMoveMouseToCenter.call();
  }

  public moveMouseToScreenCenter(timeout?: number) {
    if (!this._isConnected) return;
    if (timeout !== undefined)
      this.setTimeout(this._dBusMoveMouseToScreenCenter.call, timeout);
    else this._dBusMoveMouseToScreenCenter.call();
  }

  public moveMouseToFocus(timeout?: number) {
    if (!this._isConnected) return;
    if (timeout !== undefined)
      this.setTimeout(this._dBusMoveMouseToFocus.call, timeout);
    else this._dBusMoveMouseToFocus.call();
  }

  public moveMouseToFocusCallback() {
    this.moveMouseToFocus();
  }

  private _onVKResult(result: any[]) {
    const isVisible = !!result[0];
    this._vkCallInFlight = false;
    const cbs = this._vkCallbacks.splice(0);
    for (const cb of cbs) cb(isVisible);
  }

  private _onVKFailed() {
    this._vkCallInFlight = false;
    const cbs = this._vkCallbacks.splice(0);
    for (const cb of cbs) cb(false);
  }

  public checkVirtualKeyboardVisible(
    callback: (isVisible: boolean) => void,
  ): void {
    if (this._disposed) return;
    if (!this._isConnected) {
      callback(false);
      return;
    }
    this._vkCallbacks.push(callback);
    if (!this._vkCallInFlight) {
      this._vkCallInFlight = true;
      this._vkVisibleCall.call();
    }
  }

  private _enter(callback: () => void) {
    if (this._entered || this._disposed) return;

    this._entered = true;
    try {
      callback();
    } catch (e: any) {
      warning(
        `DBusProtectFunc: Error raised line: ${e.lineNumber}. Error: ${e}`,
      );
    } finally {
      this._entered = false;
    }
  }

  private setTimeout(func: () => void, timeout: number) {
    KWinSetTimeout(() => this._enter(func), timeout);
  }

  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._vkCallbacks = [];
    this._vkCallInFlight = false;
    for (const { signal, callback } of this._connections.splice(0)) {
      try {
        signal.disconnect(callback);
      } catch (_) {
        /* QML objects can disappear before the script's destruction hook. */
      }
    }
  }

  private _connect(signal: Signal<any>, callback: any): void {
    signal.connect(callback);
    this._connections.push({ signal, callback });
  }
}
