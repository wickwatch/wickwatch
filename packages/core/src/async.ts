/** The value of `promise`, or undefined if it fails or takes longer than `ms`. */
export async function settle<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          resolve(undefined);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
