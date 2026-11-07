/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

interface ISurfaceCfg {
  capacity: number;
  isOvercapacityCandidate: boolean;
}
class KWinSurfaceStore implements ISurfaceStore {
  private _store: { [id: string]: KWinSurface };
  private _userSurfacesCfg: SurfaceCfg<ISurfaceCfg>[];
  private _vDesktopsIds: Set<string>;
  /* Capacity overrides (set at runtime via the Raise/Lower Surface
   * Capacity shortcuts) of surfaces evicted by removeOutdatedSurfaces,
   * keyed by surface id, so a temporary unplug/resume doesn't reset them.
   * Ids are stable across replug cycles (derived from the output name). */
  private _evictedCapacities: { [id: string]: number | null };
  private _definedSurfaces: { [label: string]: IDefinedSurface };
  private workspace: Workspace;
  private _liveOutputNames: Set<string>;

  constructor(workspace: Workspace) {
    this._store = {};
    this.workspace = workspace;
    this._vDesktopsIds = new Set<string>();
    this._evictedCapacities = {};
    this._definedSurfaces = {};
    this._applyUsrDefSurfaces(CONFIG.srfDefineCfg);
    this._userSurfacesCfg = this.getSurfacesUserCfg();
    this._liveOutputNames = this._getLiveOutputNames();
  }

  public checkVirtualDesktops() {
    let desktops = new Set<string>();
    this.workspace.desktops.forEach((desktop) => {
      desktops.add(desktop.id);
    });
    let removeIds = [...this._vDesktopsIds].filter((x) => !desktops.has(x));
    for (let id of removeIds) {
      LOG?.send(
        LogModules.surfaceChanged,
        "checkVirtualDesktops",
        `The Virtual Desktop with id:${id} was deleted.`,
      );
      this._removeById(id, "vDesktopId");
      this._vDesktopsIds.delete(id);
    }
  }
  public getSurface(
    output: Output,
    activity: string,
    vDesktop: VirtualDesktop,
  ): ISurface {
    const id = KWinSurface.generateId(output, activity, vDesktop);
    if (!(id in this._store)) {
      let surfaceCfg = this._surfaceCfg(output, activity, vDesktop);
      this._store[id] = new KWinSurface(
        output,
        activity,
        vDesktop,
        this.workspace,
        surfaceCfg,
        this,
      );
      if (id in this._evictedCapacities) {
        this._store[id].capacity = this._evictedCapacities[id];
        delete this._evictedCapacities[id];
      }
      this._vDesktopsIds.has(vDesktop.id) ||
        this._vDesktopsIds.add(vDesktop.id);
    } else {
      /* Same id means same (output name, activity, desktop). Refresh the
       * reference unconditionally: the stored output may be a destroyed
       * QObject wrapper (hotplug, resume from sleep), and even reading its
       * properties to check can throw. */
      this._store[id].output = output;
    }
    return this._store[id];
  }
  public isFit(surface: ISurface, label: string): boolean {
    return this._surfaceMatchesLabel(
      surface.output.name,
      surface.activity,
      surface.vDesktop.name,
      label,
    );
  }
  public removeByActivity(id: string) {
    this._removeById(id, "activityId");
  }
  public onOutputsChanged() {
    this._liveOutputNames = this._getLiveOutputNames();
    this._removeOutdatedSurfaces();
  }
  /* Drop surfaces whose output is gone. KWin destroys Output QObjects on
   * hotplug/resume; a surface kept past that holds a dangling wrapper, and
   * feeding it back into KWin API calls (workspace.clientArea etc.) can
   * crash KWin. Surfaces are cheap to recreate -- getSurface rebuilds them
   * with the same ids when the output comes back, layouts live in
   * LayoutStore keyed by output name, and runtime capacity overrides are
   * stashed here and restored on recreation, so no state is lost. */
  private _removeOutdatedSurfaces() {
    this._getLiveOutputNames();
    const removeIds = Object.keys(this._store).filter(
      (id) => !this._liveOutputNames.has(this._store[id].outputName),
    );
    if (removeIds.length === 0) return;
    LOG?.send(
      LogModules.surfaceChanged,
      "removeOutdatedSurfaces",
      `outputs removed; dropping surfaces: ${removeIds
        .map((id) => this._store[id].toString())
        .join("#")}`,
    );
    removeIds.forEach((id) => {
      this._evictedCapacities[id] = this._store[id].capacity;
      delete this._store[id];
    });
  }
  private _getLiveOutputNames(): Set<string> {
    const liveNames = new Set<string>();
    this.workspace.screens.forEach((output) => {
      if (outputIsAlive(output)) liveNames.add(output.name);
    });
    return liveNames;
  }
  private _surfaceCfg(
    output: Output,
    activity: string,
    vDesktop: VirtualDesktop,
  ): ISurfaceCfg | null {
    for (let i = 0; i < this._userSurfacesCfg.length; i++) {
      let userCfg = this._userSurfacesCfg[i];
      if (
        this._surfaceMatchesLabel(
          output.name,
          activity,
          vDesktop.name,
          userCfg.userLabel,
        )
      )
        return userCfg.cfg;
    }
    return null;
  }
  private _surfaceMatchesLabel(
    outputName: string,
    activity: string,
    vDesktopName: string,
    label: string,
  ): boolean {
    const defined = this._definedSurfaces[label];
    if (defined === undefined) return false;
    if (defined.outputNames.length !== 0) {
      let foundIdx = defined.outputNames.indexOf(outputName);
      if (foundIdx === -1) return false;
      if (defined.outputNames.length > 1 && foundIdx !== 0) {
        for (let i = 0; i < foundIdx; i++) {
          if (this._liveOutputNames!.has(defined.outputNames[i])) return false;
        }
      }
    }
    if (
      (defined.activityId === "" || defined.activityId === activity) &&
      (defined.virtualDesktopNames.length === 0 ||
        defined.virtualDesktopNames.indexOf(vDesktopName) !== -1)
    )
      return true;
    return false;
  }
  private _removeById(sourceId: string, byType: "vDesktopId" | "activityId") {
    let removeIds: string[] = [];
    for (let id of Object.keys(this._store)) {
      if (
        (byType === "vDesktopId" && this._store[id].vDesktop.id === sourceId) ||
        (byType === "activityId" && this._store[id].activity === sourceId)
      )
        removeIds.push(id);
    }
    LOG?.send(
      LogModules.surfaceChanged,
      "removeById",
      `remove from surface store by ${byType} next surfaces: ${removeIds.map((id) => this._store[id].toString()).join("#")}`,
    );
    removeIds.forEach((id) => {
      delete this._store[id];
    });
  }
  private _applyUsrDefSurfaces(userConfig: string[]): void {
    for (const line of userConfig) {
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) {
        warning(
          `Invalid defined surface: "${line}" — missing "=" (expected: label=Surface)`,
        );
        continue;
      }
      const label = line.slice(0, eqIdx).trim();
      if (label.length === 0) {
        warning(`Invalid defined surface: "${line}" — label is empty`);
        continue;
      }

      const surface = line.slice(eqIdx + 1).trim();
      const parts = surface.split(":").map((p) => p.trim());

      if (parts.length > 3) {
        warning(
          `Invalid defined surface: "${line}" — too many colons (expected: outputs[:vDesktops[:activity]])`,
        );
        continue;
      }

      const outputStr = parts[0];
      const outputNames = outputStr
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0);

      const virtualDesktopNames =
        parts.length >= 2
          ? parts[1]
              .split(",")
              .map((d) => d.trim())
              .filter((d) => d.length > 0)
          : [];
      const activityId = parts.length >= 3 ? parts[2] : "";

      const entries: IDefinedSurface = {
        label,
        outputNames,
        virtualDesktopNames,
        activityId,
      };

      if (this._definedSurfaces[label] !== undefined) {
        warning(`Duplicate label "${label}" — overwriting previous definition`);
      }
      this._definedSurfaces[label] = entries;
    }
  }
  private getSurfacesUserCfg(): SurfaceCfg<ISurfaceCfg>[] {
    let userCfg: SurfaceCfg<ISurfaceCfg>[] = [];
    for (const line of CONFIG.srfDefaultConfig) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) {
        warning(
          `Invalid surface config: "${line}" — missing ":" (expected: label:param=value,...)`,
        );
        continue;
      }
      const label = line.slice(0, colonIdx).trim();
      if (label.length === 0) {
        warning(`Invalid surface config: "${line}" — label is empty`);
        continue;
      }

      const paramsStr = line.slice(colonIdx + 1).trim();
      const rawCfg =
        paramsStr.length > 0
          ? paramsStr
              .split(",")
              .map((p) => p.trim())
              .filter((p) => p.length > 0)
          : [];
      const validatedCfg = KWinSurfaceStore.validateUserCfg(rawCfg);

      const defined = this._definedSurfaces[label];
      if (defined === undefined) {
        warning(
          `Surface config label "${label}" not found in defined surfaces`,
        );
        continue;
      }
      userCfg.push(new SurfaceCfg<ISurfaceCfg>(label, validatedCfg));
    }
    return userCfg;
  }
  private static validateUserCfg(rawCfg: string[]): ISurfaceCfg {
    let errors: string[] = [];
    const cfgFields = ["cp", "capacity", "oc", "overcapacity"];
    const cfgPossibleValues = "cp=6,oc=false";
    let surfaceCfg: ISurfaceCfg = {
      capacity: 99,
      isOvercapacityCandidate: true,
    };
    rawCfg.forEach((part) => {
      let splittedPart = part.split("=").map((p) => p.trim().toLowerCase());
      if (splittedPart.length !== 2) {
        errors.push(`"${part}" have to has the one equal sign`);
        return;
      }
      const [userCfgField, userValue] = splittedPart;

      if (userCfgField.length === 0 || userValue.length === 0) {
        errors.push(`"${part}" can not have empty field or value`);
        return;
      }
      if (cfgFields.indexOf(userCfgField) < 0) {
        errors.push(
          `"${userCfgField}" has unknown parameter. Possible parameters: ${cfgFields.join(
            ",",
          )}.Possible values: ${cfgPossibleValues}`,
        );
        return;
      }
      switch (userCfgField) {
        case "cp":
        case "capacity":
          const value = validateNumber(userValue, 1, 99);
          if (value instanceof Err) {
            errors.push(`splittedPart[0]: ${value}`);
            break;
          }
          surfaceCfg["capacity"] = value;
          break;
        case "oc":
        case "overcapacity":
          surfaceCfg["isOvercapacityCandidate"] =
            userValue === "false" || userValue === "disable" ? false : true;
          break;
        default:
          errors.push(
            `"${part}" has unknown parameter. Possible parameters: ${cfgFields.join(
              ",",
            )}`,
          );
          return;
      }
    });
    if (errors.length > 0) {
      warning(errors.join("\n"));
    }
    return surfaceCfg;
  }
}
class KWinSurface implements ISurface {
  private static getHash(s: string): string {
    let hash = 0;
    if (s.length == 0) return `0`;
    for (let i = 0; i < s.length; i++) {
      let charCode = s.charCodeAt(i);
      hash = (hash << 5) - hash + charCode;
      hash = hash & hash;
    }
    return `${hash}`;
  }

  public get isOvercapacityCandidate(): boolean {
    return this._isOvercapacityCandidate;
  }

  public static generateId(
    output: Output,
    activity: string,
    vDesktop: VirtualDesktop,
    isLayoutId: boolean = false,
  ): string {
    let path = output.name;
    if (isLayoutId) {
      if (KWINCONFIG.layoutPerActivity) path += "@" + activity;
      if (KWINCONFIG.layoutPerDesktop) path += "#" + vDesktop.id;
    } else {
      path += "@" + activity;
      path += "#" + vDesktop.id;
    }
    return KWinSurface.getHash(path);
  }

  public get workingArea(): Rect {
    const output = this.output;
    if (outputIsAlive(output)) {
      try {
        const area = this._workspace.clientArea(
          ClientAreaOption.PlacementArea,
          output,
          this.vDesktop,
        );
        this._lastWorkingArea = toRect(area);
        return this._lastWorkingArea;
      } catch (e) {
        /* fall through to the cached value */
      }
    }
    /* The output vanished (hotplug/resume) and hasn't come back yet.
     * Never hand a dead output to workspace.clientArea -- that can crash
     * KWin. The last known area keeps layout math sane until the next
     * arrange happens against live outputs. */
    LOG?.send(
      LogModules.surfaceChanged,
      "workingArea",
      `output ${this.outputName} is gone; using cached workingArea`,
    );
    return this._lastWorkingArea !== null
      ? this._lastWorkingArea
      : new Rect(0, 0, 0, 0);
  }

  public get capacity(): number | null {
    return this._capacity;
  }

  public set capacity(capacity: number | null) {
    this._capacity = capacity;
  }

  /* Outputs are recreated by KWin on hotplug/resume; the name survives,
   * the QObject doesn't. Cache the name at construction so the surface's
   * identity never requires touching a possibly-destroyed wrapper, and
   * re-resolve the live Output by name whenever the stored one has died. */
  public readonly outputName: string;

  public get output(): Output {
    if (!outputIsAlive(this._output)) {
      const live = findOutputByName(this._workspace, this.outputName);
      if (live !== null) this._output = live;
    }
    return this._output;
  }

  public set output(value: Output) {
    this._output = value;
  }

  public readonly id: string;
  public readonly layoutId: string;
  public readonly ignore: boolean;
  public readonly activity: string;
  public readonly vDesktop: VirtualDesktop;

  private readonly _workspace: Workspace;
  private readonly _surfaceStore: KWinSurfaceStore;
  private _output: Output;
  private _capacity: number | null;
  private _lastWorkingArea: Rect | null;
  private _isOvercapacityCandidate: boolean;

  constructor(
    output: Output,
    activity: string,
    vDesktop: VirtualDesktop,
    workspace: Workspace,
    surfaceConfig: ISurfaceCfg | null,
    surfaceStore: KWinSurfaceStore,
  ) {
    this.id = KWinSurface.generateId(output, activity, vDesktop);
    this.layoutId = KWinSurface.generateId(output, activity, vDesktop, true);
    this.ignore =
      KWINCONFIG.ignoreActivity.indexOf(activity) >= 0 ||
      KWINCONFIG.ignoreScreen.indexOf(output.name) >= 0 ||
      KWINCONFIG.ignoreVDesktop.indexOf(vDesktop.name) >= 0;

    this.outputName = output.name;
    this._output = output;
    this.activity = activity;
    this.vDesktop = vDesktop;
    this._workspace = workspace;
    this._surfaceStore = surfaceStore;
    this._capacity =
      typeof surfaceConfig?.capacity === "number"
        ? surfaceConfig.capacity
        : null;
    this._isOvercapacityCandidate =
      typeof surfaceConfig?.isOvercapacityCandidate === "boolean"
        ? surfaceConfig.isOvercapacityCandidate
        : true;
    this._lastWorkingArea = null;
  }

  public isFit(label: string): boolean {
    return this._surfaceStore.isFit(this, label);
  }

  public getParams(): [string, string, string] {
    return [this.outputName, this.activity, this.vDesktop.name];
  }

  public next(): ISurface | null {
    // TODO: ... thinking about this function
    return null;
    // old: workspace.desktops => int number of virtual desktops. now all desktops objects where window is on and empty list if window on all desktops.
    //if (this.desktop === workspace.desktops)
    /* this is the last virtual desktop */
    /* TODO: option to create additional desktop */
    // return null;

    //return new KWinSurface(this.output, this.activity, this.desktop + 1);
  }

  public toString(): string {
    return (
      "KWinSurface(" +
      [this.outputName, this.activity, this.vDesktop.name].join(", ") +
      ")"
    );
  }
}
