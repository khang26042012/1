export function createAbortableTask(task, timeoutMs, parentSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason || new Error("parent aborted"));
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  let timer;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error("combo task timeout"));
      resolve({ __timeout: true });
    }, timeoutMs);
    Promise.resolve()
      .then(() => task(controller.signal))
      .then((value) => resolve(value))
      .catch((error) => resolve({ __error: error }))
      .finally(() => clearTimeout(timer));
  });

  return {
    promise,
    signal: controller.signal,
    abort(reason = "combo task cancelled") { if (!controller.signal.aborted) controller.abort(new Error(reason)); },
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}
