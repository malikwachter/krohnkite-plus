/*
    SPDX-FileCopyrightText: 2026 Krohnkite contributors

    SPDX-License-Identifier: MIT
*/

/** Owns the replaceable Krohnkite driver for the lifetime of the QML script. */
class KWinRuntime {
  private readonly api: Api;
  private driver: KWinDriver | null = null;
  private config: KWinConfig | null = null;
  private generation: number = 0;
  private reloading: boolean = false;
  private disposed: boolean = false;

  constructor(api: Api) {
    this.api = api;
    KWIN = api.kwin;
  }

  public selectLayout(id: string): boolean {
    if (!this.config || !this.driver) return false;
    if (this.config.layoutOrder.indexOf(id) === -1) return false;
    this.driver.selectLayoutFromOSD(id);
    return true;
  }

  public start(): void {
    if (this.driver !== null || this.disposed) return;
    const config = new KWinConfig();
    this.startDriver(config, false);
  }

  /** Reload only when one of Krohnkite's effective settings changed. */
  public reloadIfChanged(): boolean {
    if (this.disposed || this.reloading || this.config === null) return false;

    const candidate = new KWinConfig();
    if (this.config.equals(candidate)) return false;

    const previousConfig = this.config;
    this.reloading = true;
    try {
      this.stopDriver();
      try {
        this.startDriver(candidate, true);
        return true;
      } catch (error) {
        warning(
          `KWinRuntime: configuration reload failed; restoring the previous runtime. ${String(error)}`,
        );
        try {
          this.startDriver(previousConfig, false);
        } catch (rollbackError) {
          this.config = null;
          warning(
            `KWinRuntime: restoring the previous runtime also failed. ${String(rollbackError)}`,
          );
          throw error;
        }
        return false;
      }
    } finally {
      this.reloading = false;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopDriver();
    this.config = null;
  }

  private startDriver(config: KWinConfig, isReload: boolean): void {
    DefaultGapsCfg.reset();
    DefaultDockCfg.reset();
    let nextDriver: KWinDriver | null = null;
    try {
      nextDriver = new KWinDriver(this.api, config);
      nextDriver.main();
    } catch (error) {
      if (nextDriver !== null) {
        try {
          nextDriver.dispose();
        } catch (disposeError) {
          warning(
            `KWinRuntime: failed to dispose an incomplete runtime. ${String(disposeError)}`,
          );
        }
      }
      KWinTimerPool.instance.dispose();
      throw error;
    }

    this.config = config;
    this.driver = nextDriver;
    this.generation++;
    if (isReload)
      print(`KROHNKITE: configuration reloaded (generation ${this.generation})`);
  }

  private stopDriver(): void {
    if (this.driver !== null) {
      this.driver.dispose();
      this.driver = null;
    }
    KWinTimerPool.instance.dispose();
  }
}
