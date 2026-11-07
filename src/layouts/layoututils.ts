/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class LayoutUtils {
  /**
   * Split a (virtual) line into weighted lines w/ gaps.
   * @param length    The length of the line to be splitted
   * @param weights   The weight of each part
   * @param gap       The size of gap b/w parts
   * @returns An array of parts: [begin, length]
   */
  public static splitWeighted(
    [begin, length]: [number, number],
    weights: number[],
    gap: number
  ): Array<[number, number]> {
    gap = gap !== undefined ? gap : 0;

    const n = weights.length;
    const actualLength = length - (n - 1) * gap;
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

    let weightAcc = 0;
    const parts: [number, number][] = weights.map((weight, i) => {
      const partBegin = (actualLength * weightAcc) / weightSum + i * gap;
      const partLength = (actualLength * weight) / weightSum;
      weightAcc += weight;
      return [begin + Math.floor(partBegin), Math.floor(partLength)];
    });
    let finalLength = parts.reduce((sum, [, length]) => sum + length, 0);
    finalLength += (n - 1) * gap;
    let remainder = length - finalLength;
    if (remainder > 0 && remainder < n) {
      for (let i = 0; i < remainder; i++) {
        parts[n - i - 1][1] += 1;
      }
    }
    return parts;
  }

  /**
   * Split an area into multiple parts based on weight.
   * @param area          The area to be splitted
   * @param weights       The weight of each part
   * @param gap           The size of gaps b/w parts
   * @param horizontal    If true, split horizontally. Otherwise, vertically.
   */
  public static splitAreaWeighted(
    area: Rect,
    weights: number[],
    gap?: number,
    horizontal?: boolean,
    minLengths?: number[]
  ): Rect[] {
    gap = gap !== undefined ? gap : 0;
    horizontal = horizontal !== undefined ? horizontal : false;

    const line: [number, number] = horizontal
      ? [area.x, area.width]
      : [area.y, area.height];
    const parts =
      minLengths !== undefined
        ? LayoutUtils.splitWeightedWithMinimum(line, weights, gap, minLengths)
        : LayoutUtils.splitWeighted(line, weights, gap);

    return parts.map(([begin, length]) =>
      horizontal
        ? new Rect(begin, area.y, length, area.height)
        : new Rect(area.x, begin, area.width, length)
    );
  }

  /**
   * Split a (virtual) line into weighted lines w/ gaps, ensuring that each
   * part is at least as long as its min length. If the minimums do not fit in
   * the line, falls back to a plain weighted split.
   * @param length      The length of the line to be splitted
   * @param weights     The weight of each part
   * @param gap         The size of gap b/w parts
   * @param minLengths  The minimum length of each part
   * @returns An array of parts: [begin, length]
   */
  public static splitWeightedWithMinimum(
    [begin, length]: [number, number],
    weights: number[],
    gap: number,
    minLengths: number[]
  ): Array<[number, number]> {
    gap = gap !== undefined ? gap : 0;

    const n = weights.length;
    const actualLength = length - (n - 1) * gap;
    const totalMin = minLengths.reduce((sum, min) => sum + min, 0);

    if (n === 0 || actualLength <= 0 || totalMin > actualLength) {
      return LayoutUtils.splitWeighted([begin, length], weights, gap);
    }

    const partLengths: number[] = new Array<number>(n).fill(0);
    const fixed: boolean[] = new Array<boolean>(n).fill(false);
    let remaining = actualLength;
    let activeWeightSum = weights.reduce((sum, weight) => sum + weight, 0);

    while (true) {
      if (activeWeightSum <= 0) {
        let activeCount = 0;
        for (let i = 0; i < n; i++) if (!fixed[i]) activeCount++;
        for (let i = 0; i < n; i++) {
          if (!fixed[i]) partLengths[i] = remaining / activeCount;
        }
        break;
      }

      let offender = -1;
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        const size = (remaining * weights[i]) / activeWeightSum;
        if (size < minLengths[i]) {
          offender = i;
          break;
        }
      }

      if (offender === -1) {
        for (let i = 0; i < n; i++) {
          if (!fixed[i])
            partLengths[i] = (remaining * weights[i]) / activeWeightSum;
        }
        break;
      }

      partLengths[offender] = minLengths[offender];
      fixed[offender] = true;
      remaining -= minLengths[offender];
      activeWeightSum -= weights[offender];
    }

    let weightAcc = 0;
    const parts: [number, number][] = partLengths.map((partLength, i) => {
      const partBegin = weightAcc + i * gap;
      weightAcc += partLength;
      return [begin + Math.floor(partBegin), Math.floor(partLength)];
    });

    let finalLength = parts.reduce((sum, [, partLength]) => sum + partLength, 0);
    finalLength += (n - 1) * gap;
    let remainder = length - finalLength;
    if (remainder > 0 && remainder < n) {
      for (let i = 0; i < remainder; i++) {
        parts[n - i - 1][1] += 1;
      }
    }
    return parts;
  }

  /**
   * Split an area into two based on weight.
   * @param area          The area to be splitted
   * @param weight        The weight of the left/upper part.
   * @param gap           The size of gaps b/w parts
   * @param horizontal    If true, split horizontally. Otherwise, vertically.
   */
  public static splitAreaHalfWeighted(
    area: Rect,
    weight: number,
    gap?: number,
    horizontal?: boolean
  ): Rect[] {
    return LayoutUtils.splitAreaWeighted(
      area,
      [weight, 1 - weight],
      gap,
      horizontal
    );
  }

  /**
   * Recalculate the weights of subareas of the line, based on size change.
   * @param line      The line being aplitted
   * @param weights   The weight of each part
   * @param gap       The gap size b/w parts
   * @param target    The index of the part being changed.
   * @param deltaFw   The amount of growth towards the origin.
   * @param deltaBw   The amount of growth towards the infinity.
   */
  public static adjustWeights(
    [begin, length]: [number, number],
    weights: number[],
    gap: number,
    target: number,
    deltaFw: number,
    deltaBw: number
  ): number[] {
    // TODO: configurable min length?
    const minLength = 1;

    const parts = this.splitWeighted([begin, length], weights, gap);
    const [targetBase, targetLength] = parts[target];

    /* apply backward delta */
    if (target > 0 && deltaBw !== 0) {
      const neighbor = target - 1;
      const [neighborBase, neighborLength] = parts[neighbor];

      /* limit delta to prevent squeezing windows */
      const delta = clip(
        deltaBw,
        minLength - targetLength,
        neighborLength - minLength
      );

      parts[target] = [targetBase - delta, targetLength + delta];
      parts[neighbor] = [neighborBase, neighborLength - delta];
    }

    /* apply forward delta */
    if (target < parts.length - 1 && deltaFw !== 0) {
      const neighbor = target + 1;
      const [neighborBase, neighborLength] = parts[neighbor];

      /* limit delta to prevent squeezing windows */
      const delta = clip(
        deltaFw,
        minLength - targetLength,
        neighborLength - minLength
      );

      parts[target] = [targetBase, targetLength + delta];
      parts[neighbor] = [neighborBase + delta, neighborLength - delta];
    }

    return LayoutUtils.calculateWeights(parts);
  }

  /**
   * Recalculate weights of subareas splitting the given area, based on size change.
   * @param area          The area being splitted
   * @param weights       The weight of each part
   * @param gap           The gap size b/w parts
   * @param target        The index of the part being changed.
   * @param delta         The changes in dimension of the target
   * @param horizontal    If true, calculate horizontal weights, instead of vertical.
   */
  public static adjustAreaWeights(
    area: Rect,
    weights: number[],
    gap: number,
    target: number,
    delta: RectDelta,
    horizontal?: boolean
  ): number[] {
    const line: [number, number] = horizontal
      ? [area.x, area.width]
      : [area.y, area.height];
    const [deltaFw, deltaBw] = horizontal
      ? [delta.east, delta.west]
      : [delta.south, delta.north];
    return LayoutUtils.adjustWeights(
      line,
      weights,
      gap,
      target,
      deltaFw,
      deltaBw
    );
  }

  /**
   * Recalculate the weights of subareas based on a size change of the target,
   * spreading the change across every part on the changed side of the target.
   *
   * When the target grows, the parts on that side shrink in proportion to the
   * room they have above their minimum length; the change is capped once those
   * parts reach their minimum. When the target shrinks, the parts on that side
   * grow in proportion to their current size, and the target never shrinks
   * below its own minimum length.
   *
   * @param line        The line being splitted
   * @param weights     The weight of each part
   * @param gap         The gap size b/w parts
   * @param target      The index of the part being changed.
   * @param deltaFw     The amount of growth towards the infinity.
   * @param deltaBw     The amount of growth towards the origin.
   * @param minLengths  The minimum length of each part
   */
  public static adjustWeightsProportional(
    [begin, length]: [number, number],
    weights: number[],
    gap: number,
    target: number,
    deltaFw: number,
    deltaBw: number,
    minLengths?: number[]
  ): number[] {
    const parts = this.splitWeighted([begin, length], weights, gap);
    const sizes = parts.map(([, size]) => size);
    const n = sizes.length;
    const mins = sizes.map((_, i) => minLengths?.[i] ?? 1);

    const shrinkPartners = (indices: number[], amount: number): number => {
      const room = indices.map((i) => Math.max(0, sizes[i] - mins[i]));
      const roomSum = room.reduce((sum, value) => sum + value, 0);
      const moved = Math.min(amount, roomSum);
      if (moved <= 0 || roomSum <= 0) return 0;
      indices.forEach((i, k) => {
        sizes[i] -= (moved * room[k]) / roomSum;
      });
      return moved;
    };

    const growPartners = (indices: number[], amount: number): number => {
      if (amount <= 0 || indices.length === 0) return 0;
      const total = indices.reduce((sum, i) => sum + sizes[i], 0);
      if (total <= 0) {
        indices.forEach((i) => {
          sizes[i] += amount / indices.length;
        });
      } else {
        indices.forEach((i) => {
          sizes[i] += (amount * sizes[i]) / total;
        });
      }
      return amount;
    };

    /* backward delta moves the target towards the origin (index 0) */
    if (target > 0 && deltaBw !== 0) {
      const partners: number[] = [];
      for (let i = 0; i < target; i++) partners.push(i);
      if (deltaBw > 0) {
        sizes[target] += shrinkPartners(partners, deltaBw);
      } else {
        const moved = Math.min(
          -deltaBw,
          Math.max(0, sizes[target] - mins[target])
        );
        growPartners(partners, moved);
        sizes[target] -= moved;
      }
    }

    /* forward delta moves the target towards infinity (index n-1) */
    if (target < n - 1 && deltaFw !== 0) {
      const partners: number[] = [];
      for (let i = target + 1; i < n; i++) partners.push(i);
      if (deltaFw > 0) {
        sizes[target] += shrinkPartners(partners, deltaFw);
      } else {
        const moved = Math.min(
          -deltaFw,
          Math.max(0, sizes[target] - mins[target])
        );
        growPartners(partners, moved);
        sizes[target] -= moved;
      }
    }

    const total = sizes.reduce((sum, size) => sum + size, 0);
    if (total <= 0) return weights;
    return sizes.map((size) => size / total);
  }

  /**
   * Area-level wrapper for adjustWeightsProportional.
   * @param area          The area being splitted
   * @param weights       The weight of each part
   * @param gap           The gap size b/w parts
   * @param target        The index of the part being changed.
   * @param delta         The changes in dimension of the target
   * @param horizontal    If true, calculate horizontal weights, instead of vertical.
   * @param minLengths    The minimum length of each part
   */
  public static adjustAreaWeightsProportional(
    area: Rect,
    weights: number[],
    gap: number,
    target: number,
    delta: RectDelta,
    horizontal?: boolean,
    minLengths?: number[]
  ): number[] {
    const line: [number, number] = horizontal
      ? [area.x, area.width]
      : [area.y, area.height];
    const [deltaFw, deltaBw] = horizontal
      ? [delta.east, delta.west]
      : [delta.south, delta.north];
    return LayoutUtils.adjustWeightsProportional(
      line,
      weights,
      gap,
      target,
      deltaFw,
      deltaBw,
      minLengths
    );
  }

  /**
   * Recalculate weights of two areas splitting the given area, based on size change.
   * @param area          The area being splitted
   * @param weight        The weight of the left/upper part
   * @param gap           The gap size b/w parts
   * @param target        The index of the part being changed.
   * @param delta         The changes in dimension of the target
   * @param horizontal    If true, calculate horizontal weights, instead of vertical.
   * @param minLengths    The minimum length of each part
   */
  public static adjustAreaHalfWeights(
    area: Rect,
    weight: number,
    gap: number,
    target: number,
    delta: RectDelta,
    horizontal?: boolean,
    minLengths?: number[]
  ): number {
    const weights = [weight, 1 - weight];
    const newWeights =
      minLengths !== undefined
        ? LayoutUtils.adjustAreaWeightsProportional(
            area,
            weights,
            gap,
            target,
            delta,
            horizontal,
            minLengths
          )
        : LayoutUtils.adjustAreaWeights(
            area,
            weights,
            gap,
            target,
            delta,
            horizontal
          );
    return newWeights[0];
  }

  /**
   * Calculates the weights of all parts, splitting a line.
   */
  public static calculateWeights(parts: Array<[number, number]>): number[] {
    const totalLength = parts.reduce((acc, [base, length]) => acc + length, 0);
    return parts.map(([base, length]) => length / totalLength);
  }

  /**
   * Calculates the weights of all parts, splitting an area.
   */
  public static calculateAreaWeights(
    area: Rect,
    geometries: Rect[],
    gap?: number,
    horizontal?: boolean
  ): number[] {
    gap = gap !== undefined ? gap : 0;
    horizontal = horizontal !== undefined ? horizontal : false;

    const line = horizontal ? area.width : area.height;
    const parts: Array<[number, number]> = horizontal
      ? geometries.map((geometry) => [geometry.x, geometry.width])
      : geometries.map((geometry) => [geometry.y, geometry.height]);
    return LayoutUtils.calculateWeights(parts);
  }
}
