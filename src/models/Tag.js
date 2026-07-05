import { listTags, getOrCreateTag, deleteTag as repoDeleteTag, getTagByName } from '../repositories/collectionRepo.js';

/**
 * Tag entity. Tags are global (shared across items); `type` is per-link (itemTag).
 * The plural form exposes simple listing/deletion helpers.
 */
export class Tag {
  constructor({ id, name, itemCount = 0 } = {}) {
    this.id = id;
    this.name = name;
    this.itemCount = itemCount;
  }

  toJSON() {
    return { id: this.id, name: this.name, itemCount: this.itemCount };
  }

  static list() {
    return listTags().map(r => new Tag(r));
  }

  static getOrCreate(name) {
    return getOrCreateTag(name);
  }

  static findByName(name) {
    const row = getTagByName(name);
    return row ? new Tag({ id: row.tagID, name: row.name }) : null;
  }

  static delete(id) {
    repoDeleteTag(id);
  }
}
