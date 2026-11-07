/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class Rect {
  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}

  public get maxX(): number {
    return this.x + this.width;
  }
  public get maxY(): number {
    return this.y + this.height;
  }

  public get center(): QPoint {
    return {
      x: this.x + Math.floor(this.width / 2),
      y: this.y + Math.floor(this.height / 2),
    };
  }
  public get activationPoint(): QPoint {
    return { x: this.x + Math.floor(this.width / 2), y: this.y + 10 };
  }

  public clone(): Rect {
    return new Rect(this.x, this.y, this.width, this.height);
  }

  public equals(other: Rect): boolean {
    return (
      this.x === other.x &&
      this.y === other.y &&
      this.width === other.width &&
      this.height === other.height
    );
  }

  public gap(left: number, right: number, top: number, bottom: number): Rect {
    return new Rect(
      this.x + left,
      this.y + top,
      this.width - (left + right),
      this.height - (top + bottom),
    );
  }

  public gap_mut(
    left: number,
    right: number,
    top: number,
    bottom: number,
  ): this {
    this.x += left;
    this.y += top;
    this.width -= left + right;
    this.height -= top + bottom;
    return this;
  }

  public includes(other: Rect): boolean {
    return (
      this.x <= other.x &&
      this.y <= other.y &&
      other.maxX < this.maxX &&
      other.maxY < this.maxY
    );
  }

  public includesPoint(
    point: QPoint,
    part: RectParts = RectParts.Whole,
  ): boolean {
    const { x, y } = point;
    if (part === RectParts.Top)
      return (
        this.x <= x &&
        x <= this.maxX &&
        this.y <= y &&
        y <= this.y + this.height / 2
      );
    else if (part === RectParts.Bottom)
      return (
        this.x <= x &&
        x <= this.maxX &&
        y > this.y + this.height / 2 &&
        y <= this.maxY
      );
    else if (part === RectParts.Left) {
      return (
        this.y <= y &&
        y <= this.maxY &&
        this.x <= x &&
        x <= this.x + this.height / 2
      );
    } else if (part === RectParts.Right) {
      return (
        this.y <= y &&
        y <= this.maxY &&
        x > this.x + this.width / 2 &&
        x <= this.maxX
      );
    } else {
      return this.x <= x && x <= this.maxX && this.y <= y && y <= this.maxY;
    }
  }

  public isTopZone(
    point: QPoint,
    activeZone: number = 10,
    unit: "percents" | "pixels" = "percents",
    mirror: boolean = false,
  ): boolean {
    const { x, y } = point;
    let height =
      unit === "percents" ? (this.height * activeZone) / 100 : activeZone;
    const topEdge = mirror ? this.y - height : this.y;
    if (mirror) height = height * 2;
    return (
      topEdge <= y && y <= topEdge + height && this.x <= x && x <= this.maxX
    );
  }

  public isBottomZone(
    point: QPoint,
    activeZone: number = 10,
    unit: "percents" | "pixels" = "percents",
    mirror: boolean = false,
  ): boolean {
    const { x, y } = point;
    let height =
      unit === "percents" ? (this.height * activeZone) / 100 : activeZone;
    const bottomEdge = mirror ? this.maxY + height : this.maxY;
    if (mirror) height = height * 2;
    return (
      y >= bottomEdge - height &&
      y <= bottomEdge &&
      this.x <= x &&
      x <= this.maxX
    );
  }

  public isLeftZone(
    point: QPoint,
    activeZone: number = 10,
    unit: "percents" | "pixels" = "percents",
    mirror: boolean = false,
  ): boolean {
    const { x, y } = point;
    let wide =
      unit === "percents" ? (this.width * activeZone) / 100 : activeZone;
    const leftEdge = mirror ? this.x - wide : this.x;
    if (mirror) wide = wide * 2;
    return (
      leftEdge <= x && x <= leftEdge + wide && this.y <= y && y <= this.maxY
    );
  }

  public isRightZone(
    point: QPoint,
    activeZone: number = 10,
    unit: "percents" | "pixels" = "percents",
    mirror: boolean = false,
  ): boolean {
    const { x, y } = point;
    let wide =
      unit === "percents" ? (this.width * activeZone) / 100 : activeZone;
    const rightEdge = mirror ? this.maxX + wide : this.maxX;
    if (mirror) wide = wide * 2;
    return (
      x >= rightEdge - wide && x <= rightEdge && this.y <= y && y <= this.maxY
    );
  }

  public subtract(other: Rect): Rect {
    return new Rect(
      this.x - other.x,
      this.y - other.y,
      this.width - other.width,
      this.height - other.height,
    );
  }

  public intersection(other: Rect, coordinate: "x" | "y"): number {
    if (coordinate === "x") {
      return Math.max(
        0,
        Math.min(this.maxX, other.maxX) - Math.max(this.x, other.x),
      );
    } else {
      return Math.max(
        0,
        Math.min(this.maxY, other.maxY) - Math.max(this.y, other.y),
      );
    }
  }

  public distance(other: Rect): number {
    return Math.sqrt(
      (this.center.x - other.center.x) ** 2 +
        (this.center.y - other.center.y) ** 2,
    );
  }

  public overallDimension(other: Rect, direction: Direction): number {
    switch (direction) {
      case "left":
        return Math.abs(this.x - other.x);
      case "right":
        return Math.abs(this.maxX - other.maxX);
      case "up":
        return Math.abs(this.y - other.y);
      case "down":
        return Math.abs(this.maxY - other.maxY);
    }
  }

  public toString(): string {
    return "Rect(" + [this.x, this.y, this.width, this.height].join(", ") + ")";
  }
}
