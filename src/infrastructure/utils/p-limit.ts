export default function pLimit(concurrency: number) {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    activeCount -= 1;
    if (queue.length > 0) {
      const run = queue.shift()!;
      run();
    }
  };

  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        activeCount += 1;
        Promise.resolve()
          .then(fn)
          .then((value) => {
            resolve(value);
            next();
          })
          .catch((err) => {
            reject(err);
            next();
          });
      };

      if (activeCount < limit) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}
