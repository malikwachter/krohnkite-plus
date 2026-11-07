/*
    SPDX-FileCopyrightText: 2018 Eon S. Jeon <esjeon@hyunmu.am>
    SPDX-FileCopyrightText: 2024 Vjatcheslav V. Kolchkov <akl334@protonmail.ch>

    SPDX-License-Identifier: MIT
*/

class WrapperMap<F, T> {
  private items: { [key: string]: T };
  private objects: { [key: string]: F };

  constructor(
    public readonly hasher: (item: F) => string,
    public readonly wrapper: (item: F) => T,
  ) {
    this.items = {};
    this.objects = {};
  }

  public add(item: F): T {
    const key = this.hasher(item);
    if (this.has(item)) return this.items[key];
    const wrapped = this.wrapper(item);
    this.items[key] = wrapped;
    this.objects[key] = item;
    return wrapped;
  }

  public has(item: F): boolean {
    return this.items[this.hasher(item)] !== undefined;
  }

  public get(item: F): T | null {
    const key = this.hasher(item);
    return this.items[key] || null;
  }

  public getByKey(key: string): T | null {
    return this.items[key] || null;
  }

  public getKeyObject(key: string): F | null {
    return this.objects[key] || null;
  }

  public remove(item: F): boolean {
    const key = this.hasher(item);
    delete this.objects[key];
    return delete this.items[key];
  }

  public clear(): void {
    this.items = {};
    this.objects = {};
  }

  public length(): number {
    return Object.keys(this.items).length;
  }

  public entries(): Array<[F, T]> {
    return Object.keys(this.items).map((k) => [this.objects[k], this.items[k]]);
  }

  public [Symbol.iterator](): Iterator<T> {
    const keys = Object.keys(this.items);
    const self = this;
    let index = 0;
    return {
      next(): IteratorResult<T> {
        if (index < keys.length) {
          return { value: self.items[keys[index++]], done: false };
        }
        return { value: undefined as any, done: true };
      },
    };
  }
}
