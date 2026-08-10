export class BulletSelector {
  topK(bullets: string[], limit = 4) {
    return bullets.sort((a, b) => b.length - a.length).slice(0, limit);
  }
}
