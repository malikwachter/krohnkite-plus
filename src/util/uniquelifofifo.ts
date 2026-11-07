/*
    SPDX-FileCopyrightText: 2026 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class UniqueLifoFifo<T> {
  private map = new Map<T, T>();

  push(item: T): boolean {
    if (this.map.has(item)) return false;
    this.map.set(item, item);
    return true;
  }
  //Map (insertion-order guaranteed in ES6+)
  pop(): T | undefined {
    let last: T | undefined;
    for (const k of this.map.keys()) last = k;
    if (last === undefined) return undefined;
    this.map.delete(last);
    return last;
  }
  shift(): T | undefined {
    const [key] = this.map.keys();
    if (key === undefined) return undefined;
    this.map.delete(key);
    return key;
  }
  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
